//! The GDK agent: one goose-agent `StateMachine` per run, over a conversation the app keeps.
//!
//! Steps, in priority order:
//! 1. `SlashCommandOperation` with [`SkillCommands`]: `/yarn-distill thread R02` appends the loaded
//!    skill to the conversation.
//! 2. `TextToolCalls` turns `<tool_call>` text into tool requests (text-mode servers, and native
//!    replies the server left unparsed).
//! 3. `ToolApprovalOperation` with [`Approval`]: read-only tools and `load_skill` run; `distill_yarn`
//!    needs `--approve packets` (the default); `ingest_export` needs `--approve all`; a call identical
//!    to one that already failed twice is refused with the last error.
//! 4. `ToolOperation` dispatches approved calls to the YaRN-MCP server and the skill provider.
//! 5. `UnhandledToolCallsOperation` answers calls nothing handled.
//! 6. `MaxTurnsOperation` caps model turns per run.
//! 7. `YarnPrompt` contributes the app, skill index and server instructions.
//! 8. `InferenceRunner` calls the local model through `goose-providers`.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::Result;
use async_trait::async_trait;
use goose_agent::inference::{IdentityInferenceRequestPreparer, InferenceEffect, InferenceRequestPreparer, InferenceRunner};
use goose_agent::machine::{EffectHandler, MachineSession, SessionLoader, StateMachine, Step};
use goose_agent::max_turns::MaxTurnsOperation;
use goose_agent::operation::{ConversationEffect, Emitter, MachineEffect, Operation};
use goose_agent::slash_command::SlashCommandOperation;
use goose_agent::tool::ToolOperation;
use goose_agent::tool_approval::{ApprovalDecision, ToolApproval, ToolApprovalOperation};
use goose_agent::unhandled_tool_calls::UnhandledToolCallsOperation;
use goose_provider_types::conversation::message::{Message, MessageContent, ToolRequest};
use goose_provider_types::conversation::token_usage::ProviderUsage;
use goose_provider_types::conversation::{effective_role, Conversation, EffectiveRole};
use goose_provider_types::model::ModelConfig;
use goose_providers::api_client::{ApiClient, AuthMethod};
use goose_providers::openai_compatible::OpenAiCompatibleProvider;
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::mcp::YarnTools;
use crate::skills::{SkillCommands, SkillSet, SkillTools, LOAD_SKILL};
use crate::text_tools::{result_text, TextToolCalls, TextToolPreparer};

pub const GDK: &str = "goose-agent 0.1.0-alpha.14";

const APP_INSTRUCTIONS: &str = "You are YaRN-MCP, a research assistant over the operator's own exported chat \
history, running on their computer with a local model. The YaRN-MCP tools index that history: themes, research \
threads (lines of inquiry picked up again on different days), interconnections between conversations, full-text \
search, and distill_yarn, which writes a long-context packet under a token limit and returns the YaRN plan for \
serving it. Everything you say about the archive must come from a tool result; cite conversations exactly as the \
tools return them, like [c:1f2e3d4c]. Never invent a theme, date, quote or packet number. When a tool refuses a \
call, read its error code and fix the call; do not repeat a refused call unchanged. Answer briefly and concretely.";

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
            session: Mutex::new(Session { id: "yarn-mcp".into(), conversation: Conversation::empty() }),
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

// ---- approval ----

/// What a headless run may do. Each level includes the ones before it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ApprovePolicy {
    /// Search and read the archive only.
    ReadOnly,
    /// Also write distilled packets under the archive home.
    Packets,
    /// Also index new exports (`ingest_export`).
    All,
}

impl ApprovePolicy {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "read-only" => Some(Self::ReadOnly),
            "packets" => Some(Self::Packets),
            "all" => Some(Self::All),
            _ => None,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ReadOnly => "read-only",
            Self::Packets => "packets",
            Self::All => "all",
        }
    }
}

pub struct Approval {
    pub tools: Arc<YarnTools>,
    pub policy: ApprovePolicy,
}

impl Approval {
    pub fn decide(&self, name: &str, _arguments: &Value) -> ApprovalDecision {
        if name == LOAD_SKILL || self.tools.read_only.contains(name) {
            return ApprovalDecision::Allow;
        }
        if !self.tools.names().contains(name) {
            return ApprovalDecision::Deny { reason: format!("{name} is not a YaRN-MCP tool in this session.") };
        }
        let needed = if name == "ingest_export" { ApprovePolicy::All } else { ApprovePolicy::Packets };
        if self.policy < needed {
            return ApprovalDecision::Deny {
                reason: format!(
                    "{name} writes to the archive home; this run allows {} (yarn-mcp --approve {}).",
                    self.policy.as_str(),
                    needed.as_str()
                ),
            };
        }
        ApprovalDecision::Allow
    }
}

/// How many times an identical call (name and arguments) may fail before the app refuses to send it.
pub const MAX_IDENTICAL_FAILURES: usize = 2;

fn call_key(name: &str, arguments: &Value) -> String {
    format!("{name} {arguments}")
}

/// Failed calls so far in the conversation, by name and arguments: (count, last error text).
pub fn failed_calls(conversation: &Conversation) -> HashMap<String, (usize, String)> {
    let mut keys = HashMap::new();
    for content in conversation.iter().flat_map(|message| message.content.iter()) {
        if let MessageContent::ToolRequest(request) = content {
            if let Ok(call) = &request.tool_call {
                keys.insert(request.id.clone(), call_key(&call.name, &json!(call.arguments.clone().unwrap_or_default())));
            }
        }
    }
    let mut failures: HashMap<String, (usize, String)> = HashMap::new();
    for content in conversation.iter().flat_map(|message| message.content.iter()) {
        if let MessageContent::ToolResponse(response) = content {
            let failed = !matches!(&response.tool_result, Ok(result) if result.is_error != Some(true));
            if let (true, Some(key)) = (failed, keys.get(&response.id)) {
                let entry = failures.entry(key.clone()).or_insert((0, String::new()));
                entry.0 += 1;
                entry.1 = result_text(response).chars().take(400).collect();
            }
        }
    }
    failures
}

#[async_trait]
impl ToolApproval<Session> for Approval {
    async fn check(&self, _session: &Session, conversation: &Conversation, requests: &[&ToolRequest]) -> Result<Vec<ApprovalDecision>> {
        let failures = failed_calls(conversation);
        Ok(requests
            .iter()
            .map(|request| match &request.tool_call {
                Ok(call) => {
                    let arguments = json!(call.arguments.clone().unwrap_or_default());
                    match failures.get(&call_key(&call.name, &arguments)) {
                        Some((count, error)) if *count >= MAX_IDENTICAL_FAILURES => ApprovalDecision::Deny {
                            reason: format!(
                                "This exact {} call has already failed {count} times ({error}). Do not send it again: \
                                 change the arguments the error names or use another tool.",
                                call.name
                            ),
                        },
                        _ => self.decide(&call.name, &arguments),
                    }
                }
                Err(error) => ApprovalDecision::Deny { reason: format!("unreadable tool call: {}", error.message) },
            })
            .collect())
    }
}

// ---- prompt ----

struct YarnPrompt {
    parts: Vec<(String, String)>,
}

#[async_trait]
impl Operation<Session, Effect> for YarnPrompt {
    fn name(&self) -> &'static str {
        "yarn_prompt"
    }

    async fn prompt_parts(&self, _session: &Session, _conversation: &Conversation) -> Result<Vec<(String, String)>> {
        Ok(self.parts.clone())
    }
}

// ---- agent ----

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolMode {
    Native,
    Text,
}

impl ToolMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Native => "native",
            Self::Text => "text",
        }
    }
}

pub struct AgentSetup {
    pub base_url: String,
    pub served_model: String,
    pub tool_mode: ToolMode,
    pub context_tokens: usize,
    pub max_tokens: i32,
    pub max_turns: u32,
    pub temperature: f32,
    pub policy: ApprovePolicy,
    pub timeout: Duration,
}

pub struct Agent {
    pub runtime: Arc<Runtime>,
    pub tools: Arc<YarnTools>,
    pub skills: Arc<SkillSet>,
    pub setup: AgentSetup,
    provider: Arc<OpenAiCompatibleProvider>,
}

impl Agent {
    pub fn new(setup: AgentSetup, tools: Arc<YarnTools>, skills: Arc<SkillSet>) -> Result<Self> {
        let api = ApiClient::with_timeout_and_tls(setup.base_url.clone(), AuthMethod::NoAuth, setup.timeout, None)?;
        let provider = Arc::new(OpenAiCompatibleProvider::new("local".into(), api, String::new()).with_supports_streaming(false));
        Ok(Self { runtime: Runtime::new(), tools, skills, setup, provider })
    }

    pub fn push_user(&self, text: &str) {
        self.runtime.session.lock().unwrap().conversation.push(Message::user().with_text(text).with_generated_id_if_missing());
    }

    fn prompt_parts(&self) -> Vec<(String, String)> {
        let mut parts = vec![("yarn_mcp_gdk".to_string(), APP_INSTRUCTIONS.to_string())];
        let index = self.skills.index_prompt();
        if !index.is_empty() {
            parts.push(("yarn_mcp_skills".to_string(), index));
        }
        if !self.tools.instructions.is_empty() {
            parts.push(("yarn_mcp_server".to_string(), self.tools.instructions.clone()));
        }
        parts
    }

    /// The system prompt the parts form, as recorded in receipts.
    pub fn system_prompt(&self) -> String {
        self.prompt_parts().into_iter().map(|(_, part)| part).collect::<Vec<_>>().join("\n\n")
    }

    /// Run the machine until it yields: a final answer, the turn cap, or `cancel`.
    pub async fn run(&self, cancel: CancellationToken) -> Result<()> {
        let mut names: HashSet<String> = self.tools.names();
        names.insert(LOAD_SKILL.to_string());
        let model = ModelConfig::new(&self.setup.served_model)
            .with_max_tokens(Some(self.setup.max_tokens))
            .with_temperature(Some(self.setup.temperature))
            .with_context_limit(Some(self.setup.context_tokens));
        let preparer: Arc<dyn InferenceRequestPreparer<Session>> = match self.setup.tool_mode {
            ToolMode::Native => Arc::new(IdentityInferenceRequestPreparer),
            ToolMode::Text => Arc::new(TextToolPreparer),
        };
        let approval = Arc::new(Approval { tools: self.tools.clone(), policy: self.setup.policy });
        let commands: Vec<Arc<dyn Operation<Session, Effect>>> = vec![Arc::new(SkillCommands { skills: self.skills.clone() })];
        let machine: StateMachine<'_, Session, Effect> = StateMachine::new(
            vec![
                Step::Operation(Arc::new(SlashCommandOperation::new(commands))),
                Step::Operation(Arc::new(TextToolCalls { names })),
                Step::Operation(Arc::new(ToolApprovalOperation::new(approval))),
                Step::Operation(Arc::new(
                    ToolOperation::new()
                        .with_provider(self.tools.clone())
                        .with_provider(Arc::new(SkillTools::new(self.skills.clone()))),
                )),
                Step::Operation(Arc::new(UnhandledToolCallsOperation::new())),
                Step::Operation(Arc::new(MaxTurnsOperation::new(self.setup.max_turns))),
                Step::Operation(Arc::new(YarnPrompt { parts: self.prompt_parts() })),
                Step::Inference(Arc::new(InferenceRunner::new(self.provider.clone(), model).with_request_preparer(preparer))),
            ],
            cancel.clone(),
        );
        let (tx, mut rx) = mpsc::unbounded_channel();
        let emit = Emitter::new(tx, cancel);
        tokio::spawn(async move { while rx.recv().await.is_some() {} });
        machine.run(&*self.runtime, "yarn-mcp", &emit).await?;
        Ok(())
    }

    /// One JSON receipt for a run: answer, every tool call and its outcome, packets written, citations in
    /// the answer, usage, and an OpenAI-style transcript.
    pub fn receipt(&self, prompt: &str, started: Instant, error: Option<String>) -> Value {
        let conversation = self.runtime.conversation();
        let mut calls = Vec::new();
        let mut packets = Vec::new();
        let mut skills_loaded = BTreeSet::new();
        for message in conversation.iter() {
            for content in &message.content {
                let MessageContent::ToolRequest(request) = content else { continue };
                let (name, arguments) = match &request.tool_call {
                    Ok(call) => (call.name.to_string(), json!(call.arguments.clone().unwrap_or_default())),
                    Err(error) => (String::new(), json!({"error": error.message})),
                };
                let response = conversation.iter().flat_map(|m| m.content.iter()).find_map(|c| match c {
                    MessageContent::ToolResponse(response) if response.id == request.id => Some(response),
                    _ => None,
                });
                let ok = response.map(|r| matches!(&r.tool_result, Ok(result) if result.is_error != Some(true)));
                let structured = response.and_then(|r| r.tool_result.as_ref().ok()).and_then(|r| r.structured_content.clone());
                if name == "distill_yarn" && ok == Some(true) {
                    if let Some(s) = &structured {
                        packets.push(json!({"path": s["packet_path"], "tokens": s["packet_tokens"],
                                            "tokenLimit": s["token_limit"], "clamped": s["clamped"],
                                            "conversations": s["conversations_included"],
                                            "yarnFactor": s["yarn"]["factor"], "context": s["yarn"]["context"]}));
                    }
                }
                if name == LOAD_SKILL {
                    if let Some(skill) = arguments.get("name").and_then(Value::as_str) {
                        skills_loaded.insert(skill.to_string());
                    }
                }
                calls.push(json!({"id": request.id, "name": name, "arguments": arguments, "ok": ok,
                                  "result": response.map(result_text)}));
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
            "app": "yarn-mcp", "version": env!("CARGO_PKG_VERSION"), "gdk": GDK,
            "servedModel": self.setup.served_model, "baseUrl": self.setup.base_url,
            "toolMode": self.setup.tool_mode.as_str(), "approve": self.setup.policy.as_str(),
            "prompt": prompt, "answer": answer, "citations": citations(&answer), "toolCalls": calls,
            "packets": packets, "skillsLoaded": skills_loaded,
            "inferenceCalls": usage.len(),
            "inputTokens": usage.iter().filter_map(|u| u.usage.input_tokens).sum::<i64>(),
            "outputTokens": usage.iter().filter_map(|u| u.usage.output_tokens).sum::<i64>(),
            "seconds": started.elapsed().as_secs_f64(), "error": error,
            "transcript": transcript(&self.system_prompt(), &conversation),
        })
    }
}

/// `[c:<id>]` citations in a text.
pub fn citations(text: &str) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    let mut rest = text;
    while let Some(start) = rest.find("[c:") {
        let tail = &rest[start + 3..];
        if let Some(end) = tail.find(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':' | '.'))) {
            if end > 0 && tail[end..].starts_with(']') {
                out.insert(format!("c:{}", &tail[..end]));
            }
        }
        rest = tail;
    }
    out
}

/// The conversation as OpenAI-style chat messages, the shape adapter trainers read.
pub fn transcript(system: &str, conversation: &Conversation) -> Vec<Value> {
    let mut out = vec![json!({"role": "system", "content": system})];
    for message in conversation.iter() {
        if !message.is_agent_visible() {
            continue;
        }
        let mut text = String::new();
        let mut calls = Vec::new();
        let mut responses = Vec::new();
        for content in &message.content {
            match content {
                MessageContent::ToolRequest(request) => {
                    if let Ok(call) = &request.tool_call {
                        let arguments = serde_json::to_string(&call.arguments.clone().unwrap_or_default()).unwrap_or_default();
                        calls.push(json!({"id": request.id, "type": "function",
                                          "function": {"name": call.name, "arguments": arguments}}));
                    }
                }
                MessageContent::ToolResponse(response) => {
                    responses.push(json!({"role": "tool", "tool_call_id": response.id, "content": result_text(response)}));
                }
                other => {
                    if let Some(chunk) = other.as_text() {
                        text.push_str(chunk);
                    }
                }
            }
        }
        if !responses.is_empty() {
            out.extend(responses);
            continue;
        }
        if text.trim().is_empty() && calls.is_empty() {
            continue;
        }
        let role = if effective_role(message) == EffectiveRole::Assistant { "assistant" } else { "user" };
        let mut entry = json!({"role": role, "content": text});
        if !calls.is_empty() {
            entry["tool_calls"] = json!(calls);
        }
        out.push(entry);
    }
    out
}
