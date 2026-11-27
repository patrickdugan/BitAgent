//! The GDK agent: one goose-agent `StateMachine` per run, over a conversation the app keeps.
//!
//! Steps, in priority order:
//! 1. `TextToolCalls` turns `<tool_call>` text into tool requests (text-mode servers, and native
//!    replies the server left unparsed).
//! 2. `ToolApprovalOperation` with [`Approval`]: read-only BitAgent tools run; any other tool needs
//!    the person's Allow in the window (headless runs deny it unless `--approve all`).
//! 3. `ToolOperation` dispatches approved calls to BitAgent's MCP server.
//! 4. `UnhandledToolCallsOperation` answers calls nothing handled.
//! 5. `MaxTurnsOperation` caps model turns per user message.
//! 6. `BitAgentPrompt` contributes the desktop and server instructions.
//! 7. `InferenceRunner` calls the local model through `goose-providers`' OpenAI-compatible client.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::Result;
use async_trait::async_trait;
use goose_agent::inference::{IdentityInferenceRequestPreparer, InferenceEffect, InferenceRequestPreparer, InferenceRunner};
use goose_agent::machine::{EffectHandler, MachineSession, SessionLoader, StateMachine, Step};
use goose_agent::max_turns::MaxTurnsOperation;
use goose_agent::operation::{ConversationEffect, Emitter, MachineEffect, Operation};
use goose_agent::tool::ToolOperation;
use goose_agent::tool_approval::{confirmation_response_message, ApprovalDecision, ToolApproval, ToolApprovalOperation};
use goose_agent::unhandled_tool_calls::UnhandledToolCallsOperation;
use goose_provider_types::conversation::message::{ActionRequiredData, Message, MessageContent, ToolRequest};
use goose_provider_types::conversation::token_usage::ProviderUsage;
use goose_provider_types::conversation::{effective_role, Conversation, EffectiveRole};
use goose_provider_types::model::ModelConfig;
use goose_provider_types::permission::Permission;
use goose_providers::api_client::{ApiClient, AuthMethod};
use goose_providers::openai_compatible::OpenAiCompatibleProvider;
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::config::{ModelSpec, ToolMode};
use crate::mcp::BitAgentTools;
use crate::text_tools::{result_text, TextToolCalls, TextToolPreparer};

pub const GDK: &str = "goose-agent 0.1.0-alpha.14";

const DESKTOP_INSTRUCTIONS: &str = "You are BitAgent Desktop, running on the person's own computer with a local model. \
BitAgent is a self-custodial Bitcoin onboarding agent at a testnet/scripted stage, with three intents: deposit Bitcoin, \
put part of it in the starter TradeLayer strategy, and withdraw it. You produce candidates only: you explain, plan and \
rehearse with the BitAgent tools, and the person approves anything on their own wallet. Never ask for or accept a seed \
phrase, private key, password or API key. Never say a deposit, order, approval or withdrawal happened unless a tool \
result says so. Call a tool when the answer depends on BitAgent's rules or state; otherwise answer briefly.";

// ---- session, effects, runtime ----

#[derive(Clone)]
pub struct Session {
    pub id: String,
    pub conversation: Conversation,
}

impl MachineSession for Session {
    fn id(&self) -> &str {
        &self.id
    }
    fn conversation(&self) -> Option<&Conversation> {
        Some(&self.conversation)
    }
}

pub enum Effect {
    Conversation(ConversationEffect),
    Usage(ProviderUsage),
}

impl MachineEffect for Effect {
    fn ensure_message_ids(&mut self) {
        if let Effect::Conversation(effect) = self {
            effect.ensure_message_ids();
        }
    }
}

impl From<Message> for Effect {
    fn from(message: Message) -> Self {
        Effect::Conversation(ConversationEffect::AppendMessage(message))
    }
}

impl From<ConversationEffect> for Effect {
    fn from(effect: ConversationEffect) -> Self {
        Effect::Conversation(effect)
    }
}

impl InferenceEffect for Effect {
    fn record_usage(usage: ProviderUsage) -> Self {
        Effect::Usage(usage)
    }
}

fn apply_conversation_effect(conversation: &mut Conversation, effect: &ConversationEffect) {
    match effect {
        ConversationEffect::AppendMessage(message) => conversation.push(message.clone()),
        ConversationEffect::ReplaceConversation(replacement) => *conversation = replacement.clone(),
        ConversationEffect::PatchToolRequestMeta { tool_call_id, patch } => {
            for message in conversation.messages_mut().iter_mut() {
                for content in message.content.iter_mut() {
                    if let MessageContent::ToolRequest(request) = content {
                        if &request.id == tool_call_id {
                            let meta = request.tool_meta.get_or_insert_with(|| json!({}));
                            if let (Some(meta), Some(patch)) = (meta.as_object_mut(), patch.as_object()) {
                                for (key, value) in patch {
                                    meta.insert(key.clone(), value.clone());
                                }
                            }
                        }
                    }
                }
            }
        }
        ConversationEffect::SetMessageOperationNote { message_id, operation, key, value } => {
            if let Some(message) = conversation.messages_mut().iter_mut().find(|m| m.id.as_deref() == Some(message_id)) {
                message.metadata.set_operation_note(operation, key, value.clone());
            }
        }
        ConversationEffect::SetMessageVisibility { message_id, user_visible, agent_visible } => {
            if let Some(message) = conversation.messages_mut().iter_mut().find(|m| m.id.as_deref() == Some(message_id)) {
                message.metadata.user_visible = *user_visible;
                message.metadata.agent_visible = *agent_visible;
            }
        }
    }
}

pub struct Runtime {
    pub session: Mutex<Session>,
    pub usage: Mutex<Vec<ProviderUsage>>,
}

impl Runtime {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            session: Mutex::new(Session { id: "bitagent".into(), conversation: Conversation::empty() }),
            usage: Mutex::new(Vec::new()),
        })
    }

    pub fn conversation(&self) -> Conversation {
        self.session.lock().unwrap().conversation.clone()
    }
}

#[async_trait]
impl SessionLoader<Session> for Runtime {
    async fn load(&self, _session_id: &str) -> Result<Session> {
        Ok(self.session.lock().unwrap().clone())
    }
}

#[async_trait]
impl EffectHandler<Session, Effect> for Runtime {
    async fn apply_effects(&self, _session: &Session, effects: &mut [Effect], _emit: &Emitter) -> Result<()> {
        for effect in effects.iter() {
            match effect {
                Effect::Conversation(effect) => apply_conversation_effect(&mut self.session.lock().unwrap().conversation, effect),
                Effect::Usage(usage) => self.usage.lock().unwrap().push(usage.clone()),
            }
        }
        Ok(())
    }
}

// ---- operations ----

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApprovePolicy {
    /// Read-only tools run; every other tool asks (headless: is denied).
    ReadOnly,
    /// Every tool asks.
    Ask,
    /// Every BitAgent tool runs.
    All,
}

impl ApprovePolicy {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "read-only" => Some(Self::ReadOnly),
            "ask" => Some(Self::Ask),
            "all" => Some(Self::All),
            _ => None,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ReadOnly => "read-only",
            Self::Ask => "ask",
            Self::All => "all",
        }
    }
}

pub struct Approval {
    pub tools: Arc<BitAgentTools>,
    pub policy: ApprovePolicy,
    pub headless: bool,
}

#[async_trait]
impl ToolApproval<Session> for Approval {
    async fn check(&self, _session: &Session, _conversation: &Conversation, requests: &[&ToolRequest]) -> Result<Vec<ApprovalDecision>> {
        let names = self.tools.names();
        Ok(requests
            .iter()
            .map(|request| {
                let name = request.tool_call.as_ref().map(|call| call.name.to_string()).unwrap_or_default();
                if !names.contains(&name) {
                    return ApprovalDecision::Deny { reason: format!("{name} is not a BitAgent tool.") };
                }
                let read_only = self.tools.read_only.contains(&name);
                if self.policy == ApprovePolicy::All || (read_only && self.policy == ApprovePolicy::ReadOnly) {
                    return ApprovalDecision::Allow;
                }
                if self.headless {
                    return ApprovalDecision::Deny {
                        reason: format!(
                            "{name} needs the person's approval, and this run has no one to ask (bitagent-cli --approve {}).",
                            self.policy.as_str()
                        ),
                    };
                }
                ApprovalDecision::Ask {
                    prompt: Some(format!(
                        "{}{}. BitAgent tools are candidate-only: they cannot sign, broadcast or move funds.",
                        self.tools.title(&name),
                        if read_only { "" } else { " records practice state" }
                    )),
                }
            })
            .collect())
    }
}

struct BitAgentPrompt {
    server_instructions: String,
}

#[async_trait]
impl Operation<Session, Effect> for BitAgentPrompt {
    fn name(&self) -> &'static str {
        "bitagent_prompt"
    }

    async fn prompt_parts(&self, _session: &Session, _conversation: &Conversation) -> Result<Vec<(String, String)>> {
        let mut parts = vec![("bitagent_desktop".to_string(), DESKTOP_INSTRUCTIONS.to_string())];
        if !self.server_instructions.is_empty() {
            parts.push(("bitagent_server".to_string(), self.server_instructions.clone()));
        }
        Ok(parts)
    }
}

// ---- agent ----

pub struct AgentSetup {
    pub model: ModelSpec,
    pub tool_mode: ToolMode,
    pub context_tokens: usize,
    pub max_tokens: i32,
    pub max_turns: u32,
    pub policy: ApprovePolicy,
    pub headless: bool,
    pub timeout: Duration,
}

pub struct Agent {
    pub runtime: Arc<Runtime>,
    pub tools: Arc<BitAgentTools>,
    pub setup: AgentSetup,
    provider: Arc<OpenAiCompatibleProvider>,
}

#[derive(Debug, Clone)]
pub struct PendingApproval {
    pub id: String,
    pub tool: String,
    pub arguments: Value,
    pub prompt: Option<String>,
}

impl Agent {
    /// A new agent over `runtime`, which may carry an earlier conversation (switching models keeps it).
    pub fn new(setup: AgentSetup, tools: Arc<BitAgentTools>, runtime: Arc<Runtime>) -> Result<Self> {
        let api = ApiClient::with_timeout_and_tls(setup.model.base_url(), AuthMethod::NoAuth, setup.timeout, None)?;
        let provider = Arc::new(OpenAiCompatibleProvider::new("local".into(), api, String::new()).with_supports_streaming(false));
        Ok(Self { runtime, tools, setup, provider })
    }

    pub fn push_user(&self, text: &str) {
        self.runtime.session.lock().unwrap().conversation.push(Message::user().with_text(text).with_generated_id_if_missing());
    }

    /// Answer an approval card; the next [`Agent::run`] dispatches or declines the call.
    pub fn answer(&self, request_id: &str, allow: bool) {
        let permission = if allow { Permission::AllowOnce } else { Permission::DenyOnce };
        self.runtime.session.lock().unwrap().conversation.push(confirmation_response_message(request_id, permission));
    }

    /// Run the machine until it yields: a final answer, an approval card, the turn cap, or `cancel`.
    pub async fn run(&self, cancel: CancellationToken) -> Result<()> {
        let names: HashSet<String> = self.tools.names();
        let model = ModelConfig::new(&self.setup.model.served_model)
            .with_max_tokens(Some(self.setup.max_tokens))
            .with_temperature(Some(0.2))
            .with_context_limit(Some(self.setup.context_tokens));
        let preparer: Arc<dyn InferenceRequestPreparer<Session>> = match self.setup.tool_mode {
            ToolMode::Native => Arc::new(IdentityInferenceRequestPreparer),
            ToolMode::Text => Arc::new(TextToolPreparer),
        };
        let approval = Arc::new(Approval { tools: self.tools.clone(), policy: self.setup.policy, headless: self.setup.headless });
        let machine: StateMachine<'_, Session, Effect> = StateMachine::new(
            vec![
                Step::Operation(Arc::new(TextToolCalls { names })),
                Step::Operation(Arc::new(ToolApprovalOperation::new(approval))),
                Step::Operation(Arc::new(ToolOperation::new().with_provider(self.tools.clone()))),
                Step::Operation(Arc::new(UnhandledToolCallsOperation::new())),
                Step::Operation(Arc::new(MaxTurnsOperation::new(self.setup.max_turns))),
                Step::Operation(Arc::new(BitAgentPrompt { server_instructions: self.tools.instructions.clone() })),
                Step::Inference(Arc::new(
                    InferenceRunner::new(self.provider.clone(), model).with_request_preparer(preparer),
                )),
            ],
            cancel.clone(),
        );
        let (tx, mut rx) = mpsc::unbounded_channel();
        let emit = Emitter::new(tx, cancel);
        tokio::spawn(async move { while rx.recv().await.is_some() {} });
        machine.run(&*self.runtime, "bitagent", &emit).await?;
        Ok(())
    }

    pub fn pending_approvals(&self) -> Vec<PendingApproval> {
        pending_approvals(&self.runtime.conversation())
    }

    /// One JSON receipt for a headless run: the answer, every tool call and its outcome, usage.
    pub fn receipt(&self, prompt: &str, started: Instant, error: Option<String>) -> Value {
        let conversation = self.runtime.conversation();
        let mut calls = Vec::new();
        for message in conversation.iter() {
            for content in &message.content {
                if let MessageContent::ToolRequest(request) = content {
                    let (name, arguments) = match &request.tool_call {
                        Ok(call) => (call.name.to_string(), json!(call.arguments.clone().unwrap_or_default())),
                        Err(error) => (String::new(), json!({"error": error.message})),
                    };
                    let response = conversation.iter().flat_map(|m| m.content.iter()).find_map(|c| match c {
                        MessageContent::ToolResponse(response) if response.id == request.id => Some(response),
                        _ => None,
                    });
                    let ok = response.map(|r| matches!(&r.tool_result, Ok(result) if result.is_error != Some(true)));
                    calls.push(json!({"id": request.id, "name": name, "arguments": arguments, "ok": ok,
                                      "result": response.map(result_text)}));
                }
            }
        }
        let answer = conversation
            .iter()
            .filter(|m| effective_role(m) == EffectiveRole::Assistant && m.is_user_visible())
            .map(|m| m.as_concat_text())
            .filter(|text| !text.trim().is_empty())
            .last()
            .unwrap_or_default();
        let usage = self.runtime.usage.lock().unwrap().clone();
        json!({
            "app": "bitagent-desktop", "version": env!("CARGO_PKG_VERSION"), "gdk": GDK,
            "model": self.setup.model.id, "servedModel": self.setup.model.served_model,
            "baseUrl": self.setup.model.base_url(), "toolMode": self.setup.tool_mode.as_str(),
            "approve": self.setup.policy.as_str(), "prompt": prompt, "answer": answer, "toolCalls": calls,
            "pendingApprovals": self.pending_approvals().iter().map(|p| json!({"id": p.id, "tool": p.tool})).collect::<Vec<_>>(),
            "inferenceCalls": usage.len(),
            "inputTokens": usage.iter().filter_map(|u| u.usage.input_tokens).sum::<i64>(),
            "outputTokens": usage.iter().filter_map(|u| u.usage.output_tokens).sum::<i64>(),
            "seconds": started.elapsed().as_secs_f64(), "error": error,
        })
    }
}

pub fn pending_approvals(conversation: &Conversation) -> Vec<PendingApproval> {
    let mut asked = Vec::new();
    let mut answered = HashSet::new();
    for content in conversation.iter().flat_map(|message| message.content.iter()) {
        match content {
            MessageContent::ActionRequired(action) => match &action.data {
                ActionRequiredData::ToolConfirmation { id, tool_name, arguments, prompt } => asked.push(PendingApproval {
                    id: id.clone(),
                    tool: tool_name.clone(),
                    arguments: Value::Object(arguments.clone()),
                    prompt: prompt.clone(),
                }),
                ActionRequiredData::ToolConfirmationResponse { id, .. } => {
                    answered.insert(id.clone());
                }
                _ => {}
            },
            MessageContent::ToolResponse(response) => {
                answered.insert(response.id.clone());
            }
            _ => {}
        }
    }
    asked.into_iter().filter(|pending| !answered.contains(&pending.id)).collect()
}
