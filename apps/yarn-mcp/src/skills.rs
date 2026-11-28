//! GDK skills: `SKILL.md` directories found with `goose_agent::skills::discover_skills`.
//!
//! A skill reaches the model two ways: the `/name args` slash command (GDK `SlashCommandOperation`)
//! appends the loaded skill to the conversation, and the `load_skill` tool returns a skill or one of
//! its supporting files (`name/relative/path`), the convention goose uses for skill files.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, bail, Result};
use async_trait::async_trait;
use goose_agent::command::{Command, CommandCall};
use goose_agent::operation::{applied, Emitter, Operation};
use goose_agent::skills::{discover_skills, loaded_skill_context, skill_content_with_args, SkillRoot};
use goose_agent::tool::ToolProvider;
use goose_provider_types::conversation::message::Message;
use goose_sdk_types::custom_requests::SourceEntry;
use rmcp::model::{CallToolRequestParams, CallToolResult, ContentBlock, ErrorData, JsonObject, Tool};
use serde_json::json;

use crate::agent::{Effect, Session};

/// Largest supporting file `load_skill` returns, in bytes.
const MAX_FILE_BYTES: u64 = 96 * 1024;

pub struct SkillSet {
    pub entries: Vec<SourceEntry>,
}

impl SkillSet {
    /// Skills under `roots`, earlier roots winning on a name clash.
    pub fn discover(roots: &[PathBuf]) -> Self {
        let entries = discover_skills(roots.iter().map(|path| SkillRoot {
            path: path.clone(),
            global: false,
            writable: false,
            preserve_path: false,
        }));
        Self { entries }
    }

    pub fn names(&self) -> Vec<String> {
        self.entries.iter().map(|skill| skill.name.clone()).collect()
    }

    fn find(&self, name: &str) -> Option<&SourceEntry> {
        self.entries.iter().find(|skill| skill.name == name)
    }

    /// The prompt part listing every skill, so the model knows what it can load.
    pub fn index_prompt(&self) -> String {
        if self.entries.is_empty() {
            return String::new();
        }
        let mut text = String::from(
            "# Skills\n\nLoad a skill with the load_skill tool before acting on it; its supporting files load as \
             load_skill(name: \"<skill>/<file>\").\n",
        );
        for skill in &self.entries {
            text.push_str(&format!("\n- {}: {}", skill.name, skill.description));
        }
        text
    }

    /// `load_skill`: a whole skill by name, or one supporting file as `<skill>/<relative path>`.
    pub fn load(&self, name: &str) -> Result<String> {
        if let Some(skill) = self.find(name) {
            return Ok(loaded_skill_context(skill, &skill_content_with_args(skill, None)?));
        }
        let (skill_name, relative) = name.split_once('/').ok_or_else(|| anyhow!("no skill named {name}"))?;
        let skill = self.find(skill_name).ok_or_else(|| anyhow!("no skill named {skill_name}"))?;
        let skill_dir = Path::new(&skill.path);
        // Compare relative paths with '/' separators: discovery returns canonical (on Windows,
        // verbatim `\\?\`) paths, where a joined "lanes/x.md" would not split into components.
        let wanted = relative.replace('\\', "/");
        let file = skill
            .supporting_files
            .iter()
            .map(PathBuf::from)
            .find(|file| {
                file.strip_prefix(skill_dir)
                    .map(|rel| rel.to_string_lossy().replace('\\', "/") == wanted)
                    .unwrap_or(false)
            })
            .ok_or_else(|| anyhow!("{skill_name} has no supporting file {relative}"))?;
        let size = std::fs::metadata(&file)?.len();
        if size > MAX_FILE_BYTES {
            bail!("{relative} is {size} bytes; load_skill returns files up to {MAX_FILE_BYTES} bytes");
        }
        Ok(format!("# {skill_name}/{relative}\n\n{}", std::fs::read_to_string(&file)?))
    }

    /// The message a `/name args` slash command appends.
    pub fn invocation(&self, name: &str, arguments: &str) -> Result<String> {
        let skill = self.find(name).ok_or_else(|| anyhow!("no skill named {name}"))?;
        let mut text = loaded_skill_context(skill, &skill_content_with_args(skill, Some(arguments))?);
        let arguments = arguments.trim();
        text.push_str(&format!(
            "\n## Invocation\n\n/{name}{}\n\nFollow this skill now, using the tools.",
            if arguments.is_empty() { String::new() } else { format!(" {arguments}") }
        ));
        Ok(text)
    }
}

/// Supplies the slash commands for the GDK `SlashCommandOperation`.
pub struct SkillCommands {
    pub skills: Arc<SkillSet>,
}

#[async_trait]
impl Operation<Session, Effect> for SkillCommands {
    fn name(&self) -> &'static str {
        "skill_commands"
    }

    async fn commands(&self, _session: &Session) -> Result<Vec<Command<'_, Session, Effect>>> {
        Ok(self
            .skills
            .entries
            .iter()
            .map(|skill| {
                let name = skill.name.clone();
                let skills = self.skills.clone();
                Command::new(skill.name.to_lowercase(), skill.description.clone(), move |call: CommandCall<'_, '_, Session>| {
                    let text = skills.invocation(&name, call.arguments);
                    // Agent-only, so the user's `/name` message stays the kickoff and the command runs once.
                    Box::pin(async move {
                        applied([Effect::from(Message::user().with_text(text?).agent_only().with_generated_id_if_missing())])
                    })
                })
            })
            .collect())
    }
}

/// The `load_skill` tool.
pub struct SkillTools {
    pub skills: Arc<SkillSet>,
    tool: Tool,
}

pub const LOAD_SKILL: &str = "load_skill";

impl SkillTools {
    pub fn new(skills: Arc<SkillSet>) -> Self {
        let schema: JsonObject = serde_json::from_value(json!({
            "type": "object",
            "properties": {"name": {"type": "string", "description": "A skill name, or <skill>/<supporting file>."}},
            "required": ["name"],
            "additionalProperties": false
        }))
        .expect("static schema");
        let tool = Tool::new(
            LOAD_SKILL,
            format!("Load a skill's instructions or one of its supporting files. Skills: {}", skills.names().join(", ")),
            Arc::new(schema),
        );
        Self { skills, tool }
    }
}

#[async_trait]
impl<S: Send + Sync + 'static> ToolProvider<S> for SkillTools {
    async fn tools(&self, _session: &S) -> Result<Vec<Tool>> {
        Ok(if self.skills.entries.is_empty() { Vec::new() } else { vec![self.tool.clone()] })
    }

    async fn call(&self, _session: &S, _request_id: &str, call: CallToolRequestParams, _emit: &Emitter) -> Result<CallToolResult, ErrorData> {
        let name = call
            .arguments
            .as_ref()
            .and_then(|arguments| arguments.get("name"))
            .and_then(|value| value.as_str())
            .ok_or_else(|| ErrorData::invalid_params("load_skill needs a name", None))?;
        match self.skills.load(name) {
            Ok(text) => Ok(CallToolResult::success(vec![ContentBlock::text(text)])),
            Err(error) => Ok(CallToolResult::error(vec![ContentBlock::text(format!("skill_error: {error:#}"))])),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set() -> SkillSet {
        SkillSet::discover(&[PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("skills")])
    }

    #[test]
    fn discovers_both_skills() {
        let skills = set();
        let mut names = skills.names();
        names.sort();
        assert_eq!(names, vec!["yarn-distill".to_string(), "yarn-explore".to_string()]);
        assert!(skills.index_prompt().contains("- yarn-explore: Answer a question about the person's own chat archive"));
    }

    #[test]
    fn loads_skills_and_supporting_files() {
        let skills = set();
        let text = skills.load("yarn-explore").unwrap();
        assert!(text.starts_with("# Loaded Skill: yarn-explore"));
        assert!(text.contains("load_skill(name: \"yarn-explore/questions.md\")"));
        assert!(skills.load("yarn-explore/questions.md").unwrap().contains("## connections"));
        assert!(skills.load("yarn-distill").unwrap().contains("native_ctx x max_yarn_factor - reserve_tokens"));
        assert!(skills.load("yarn-explore/missing.md").is_err());
        assert!(skills.load("yarn-explore/../Cargo.toml").is_err());
        assert!(skills.load("nope").is_err());
    }

    #[test]
    fn invocation_names_the_arguments() {
        let text = set().invocation("yarn-distill", " thread R02 ").unwrap();
        assert!(text.contains("## Invocation

/yarn-distill thread R02
"));
        assert!(text.ends_with("Follow this skill now, using the tools."));
    }
}
