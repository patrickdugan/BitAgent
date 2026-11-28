//! The text tool protocol, for OpenAI-compatible servers without tool calling
//! (`yarn-mcp --tool-mode text`). Same module as BitAgent Desktop's `desktop/src/text_tools.rs`.
//!
//! The request preparer lists the tools in the system prompt, sends no `tools` field, and shows the
//! model earlier calls and results as `<tool_call>` / `<tool_response>` text. `TextToolCalls` turns a
//! `<tool_call>{"name": ..., "arguments": {...}}</tool_call>` in the model's reply into a real goose
//! tool request, so approval and dispatch are the same in both modes. In native mode it is a
//! fallback for a reply whose call the server left unparsed.

use std::collections::HashSet;

use anyhow::Result;
use async_trait::async_trait;
use goose_agent::inference::{InferenceRequestPreparer, PreparedInferenceRequest};
use goose_agent::operation::{applied, not_applicable, ConversationEffect, Emitter, InferenceInput, Operation, OperationResult};
use goose_provider_types::conversation::message::{Message, MessageContent, ToolResponse};
use goose_provider_types::conversation::{effective_role, Conversation, EffectiveRole};
use rmcp::model::{CallToolRequestParams, JsonObject, Tool};
use serde_json::{json, Value};

use crate::agent::{Effect, Session};

/// Longest tool result shown to the model, in characters.
pub const RESULT_CHARS: usize = 6000;

pub fn protocol_prompt(tools: &[Tool]) -> String {
    let mut text = String::from(
        "# Tools\n\nYou can call these YaRN-MCP tools. To call one, reply with exactly one block:\n\n\
         <tool_call>\n{\"name\": \"TOOL_NAME\", \"arguments\": {...}}\n</tool_call>\n\n\
         and nothing after it. The result comes back as <tool_response>...</tool_response>. \
         When no tool is needed, answer in plain text.\n",
    );
    for tool in tools {
        let schema = serde_json::to_string(&*tool.input_schema).unwrap_or_else(|_| "{}".into());
        text.push_str(&format!(
            "\n- {}: {}\n  arguments schema: {}",
            tool.name,
            tool.description.as_deref().unwrap_or(""),
            schema
        ));
    }
    text
}

/// The text a tool result contributes: structured content when present, else the text blocks.
pub fn result_text(response: &ToolResponse) -> String {
    let text = match &response.tool_result {
        Err(error) => format!("error: {}", error.message),
        Ok(result) => {
            let value = serde_json::to_value(result).unwrap_or(Value::Null);
            let body = match value.get("structuredContent") {
                Some(structured) if !structured.is_null() => structured.to_string(),
                _ => value["content"]
                    .as_array()
                    .map(|blocks| blocks.iter().filter_map(|b| b["text"].as_str()).collect::<Vec<_>>().join("\n"))
                    .unwrap_or_default(),
            };
            if value["isError"].as_bool() == Some(true) {
                format!("error: {body}")
            } else {
                body
            }
        }
    };
    truncate(&text, RESULT_CHARS)
}

pub fn truncate(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_string();
    }
    let cut: String = text.chars().take(limit).collect();
    format!("{cut}... [truncated]")
}

fn call_json(name: &str, arguments: &Option<JsonObject>) -> String {
    json!({"name": name, "arguments": arguments.clone().unwrap_or_default()}).to_string()
}

/// The conversation with tool requests and responses rewritten as protocol text.
pub fn render_as_text(conversation: &Conversation) -> Conversation {
    let messages = conversation.messages().iter().map(|message| {
        let mut message = message.clone();
        message.content = message
            .content
            .into_iter()
            .map(|content| match content {
                MessageContent::ToolRequest(request) => {
                    let call = match &request.tool_call {
                        Ok(call) => call_json(&call.name, &call.arguments),
                        Err(error) => format!("{{\"error\": {}}}", json!(error.message)),
                    };
                    MessageContent::text(format!("<tool_call>\n{call}\n</tool_call>"))
                }
                MessageContent::ToolResponse(response) => {
                    MessageContent::text(format!("<tool_response>\n{}\n</tool_response>", result_text(&response)))
                }
                other => other,
            })
            .collect();
        message
    });
    Conversation::new_unvalidated(messages.collect::<Vec<_>>())
}

fn strip_fence(text: &str) -> &str {
    let text = text.trim();
    let text = text.strip_prefix("```json").or_else(|| text.strip_prefix("```")).unwrap_or(text);
    text.strip_suffix("```").unwrap_or(text).trim()
}

fn parse_call(body: &str, names: &HashSet<String>) -> Option<(String, JsonObject)> {
    let value: Value = serde_json::from_str(strip_fence(body)).ok()?;
    let name = value.get("name").or_else(|| value.get("tool"))?.as_str()?.to_string();
    if !names.contains(&name) {
        return None;
    }
    let arguments = match value.get("arguments").or_else(|| value.get("parameters")).or_else(|| value.get("args")) {
        Some(Value::Object(map)) => map.clone(),
        Some(Value::String(raw)) => serde_json::from_str::<JsonObject>(raw).ok()?,
        _ => JsonObject::new(),
    };
    Some((name, arguments))
}

/// Split a reply into its prose and the tool calls it writes for known tools.
pub fn parse_text_calls(text: &str, names: &HashSet<String>) -> (String, Vec<(String, JsonObject)>) {
    const OPEN: &str = "<tool_call>";
    const CLOSE: &str = "</tool_call>";
    let mut prose = String::new();
    let mut calls = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find(OPEN) {
        prose.push_str(&rest[..start]);
        let after = &rest[start + OPEN.len()..];
        let (body, consumed, next) = match after.find(CLOSE) {
            Some(end) => (&after[..end], OPEN.len() + end + CLOSE.len(), &after[end + CLOSE.len()..]),
            None => (after, OPEN.len() + after.len(), ""),
        };
        match parse_call(body, names) {
            Some(call) => calls.push(call),
            None => prose.push_str(&rest[start..start + consumed]),
        }
        rest = next;
    }
    prose.push_str(rest);
    if calls.is_empty() {
        if let Some(call) = parse_call(text, names) {
            return (String::new(), vec![call]);
        }
    }
    (prose.trim().to_string(), calls)
}

pub struct TextToolPreparer;

#[async_trait]
impl InferenceRequestPreparer<Session> for TextToolPreparer {
    async fn prepare_session(&self, session: &Session) -> Result<Option<Session>> {
        Ok(Some(Session { id: session.id.clone(), conversation: render_as_text(&session.conversation) }))
    }

    async fn prepare(&self, _session: &Session, _conversation: &Conversation, input: InferenceInput) -> Result<PreparedInferenceRequest> {
        let mut parts: Vec<String> = input.prompt_parts.into_iter().map(|(_, part)| part).collect();
        parts.push(protocol_prompt(&input.tools));
        Ok(PreparedInferenceRequest { system_prompt: parts.join("\n\n"), tools: Vec::new(), additional_messages: Vec::new() })
    }
}

/// Turns `<tool_call>` text in the latest assistant reply into goose tool requests.
pub struct TextToolCalls {
    pub names: HashSet<String>,
}

#[async_trait]
impl Operation<Session, Effect> for TextToolCalls {
    fn name(&self) -> &'static str {
        "text_tool_calls"
    }

    async fn run(&self, _session: &Session, conversation: &Conversation, _emit: &Emitter) -> Result<OperationResult<Effect>> {
        let Some(last) = conversation.last() else { return not_applicable() };
        if effective_role(last) != EffectiveRole::Assistant || last.is_tool_call() || last.error_kind().is_some() {
            return not_applicable();
        }
        let (prose, calls) = parse_text_calls(&last.as_concat_text(), &self.names);
        if calls.is_empty() {
            return not_applicable();
        }
        let mut rebuilt: Message = last.clone();
        rebuilt.content.retain(|content| !matches!(content, MessageContent::Text(_)));
        if !prose.is_empty() {
            rebuilt.content.push(MessageContent::text(prose));
        }
        for (name, arguments) in calls {
            let id = format!("call_{}", uuid::Uuid::new_v4().simple());
            rebuilt
                .content
                .push(MessageContent::tool_request(id, Ok(CallToolRequestParams::new(name).with_arguments(arguments))));
        }
        let mut messages = conversation.messages().clone();
        if let Some(slot) = messages.last_mut() {
            *slot = rebuilt;
        }
        applied([Effect::Conversation(ConversationEffect::ReplaceConversation(Conversation::new_unvalidated(messages)))])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names() -> HashSet<String> {
        ["suite_status", "propose_move"].iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn tagged_call_is_parsed_and_removed_from_prose() {
        let (prose, calls) = parse_text_calls(
            "Let me check.\n<tool_call>\n{\"name\": \"propose_move\", \"arguments\": {\"lane\": \"curation\"}}\n</tool_call>",
            &names(),
        );
        assert_eq!(prose, "Let me check.");
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "propose_move");
        assert_eq!(calls[0].1["lane"], "curation");
    }

    #[test]
    fn bare_json_reply_and_string_arguments() {
        let (_, calls) = parse_text_calls("```json\n{\"name\": \"suite_status\", \"arguments\": \"{}\"}\n```", &names());
        assert_eq!(calls.len(), 1);
        assert!(calls[0].1.is_empty());
    }

    #[test]
    fn unknown_tool_stays_prose() {
        let text = "<tool_call>{\"name\": \"sign_transaction\", \"arguments\": {}}</tool_call>";
        let (prose, calls) = parse_text_calls(text, &names());
        assert!(calls.is_empty());
        assert!(prose.contains("sign_transaction"));
    }

    #[test]
    fn unclosed_tag_still_parses() {
        let (_, calls) = parse_text_calls("<tool_call>{\"name\": \"suite_status\"}", &names());
        assert_eq!(calls.len(), 1);
    }
}
