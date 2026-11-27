//! The model catalog and BitAgent wiring, read from `models.json`.
//!
//! Lookup order: `--config PATH`, `BITAGENT_DESKTOP_CONFIG`, `models.json` beside the executable,
//! in the working directory, then in this crate's directory. Relative paths in the file resolve
//! against the file's own directory and `~/` against the user's home directory.

use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;

/// How the model is offered BitAgent's tools.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ToolMode {
    /// OpenAI `tools` in the request and `tool_calls` in the reply (llama-server `--jinja`, squid5090).
    Native,
    /// Tools listed in the system prompt, calls written as `<tool_call>{json}</tool_call>`
    /// (for servers without OpenAI tool calling).
    Text,
}

impl ToolMode {
    pub fn as_str(self) -> &'static str {
        match self {
            ToolMode::Native => "native",
            ToolMode::Text => "text",
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Runtime {
    /// Inkling 2 Mini on the squid5090 engine in WSL, started by `programs.squidServe`.
    Squid5080,
    /// A GGUF served by `programs.llamaServer`, queued through vramorama when it is configured.
    Llama,
    /// Any OpenAI-compatible server the app does not start itself.
    External,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadFile {
    pub url: String,
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSpec {
    pub id: String,
    pub label: String,
    pub family: String,
    pub runtime: Runtime,
    pub port: u16,
    #[serde(default)]
    pub base_url: Option<String>,
    pub served_model: String,
    pub tools: ToolMode,
    #[serde(default)]
    pub gguf: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default, rename = "vramMiB")]
    pub vram_mib: Option<u64>,
    #[serde(default)]
    pub context_tokens: Option<usize>,
    #[serde(default)]
    pub max_tokens: Option<i32>,
    #[serde(default)]
    pub download: Vec<DownloadFile>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

impl ModelSpec {
    /// The OpenAI-compatible base URL, ending in `/`.
    pub fn base_url(&self) -> String {
        let mut url = self.base_url.clone().unwrap_or_else(|| format!("http://127.0.0.1:{}/v1/", self.port));
        if !url.ends_with('/') {
            url.push('/');
        }
        url
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitAgentWiring {
    /// `apps/bitagent-launch-kernel`, holding `node_modules` and the MCP server script.
    pub kernel_dir: String,
    pub node: String,
    pub mcp_args: Vec<String>,
    pub web_url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Programs {
    pub llama_server: String,
    pub bash: String,
    pub squid_serve: String,
    pub squid_stop: String,
    #[serde(default)]
    pub vramorama: Option<String>,
    #[serde(default = "default_owner")]
    pub gpu_owner: String,
}

fn default_owner() -> String {
    "bitagent-desktop".into()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub default_model: String,
    pub context_tokens: usize,
    pub max_tokens: i32,
    pub max_turns: u32,
    pub bitagent: BitAgentWiring,
    pub programs: Programs,
    pub models: Vec<ModelSpec>,
    #[serde(skip)]
    pub source_path: PathBuf,
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

impl Catalog {
    pub fn load(explicit: Option<&str>) -> Result<Self> {
        let path = Self::locate(explicit)?;
        let text = std::fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;
        let mut catalog: Catalog =
            serde_json::from_str(&text).with_context(|| format!("parsing {}", path.display()))?;
        catalog.source_path = path;
        if let Ok(node) = std::env::var("BITAGENT_NODE") {
            catalog.bitagent.node = node;
        }
        if let Ok(dir) = std::env::var("BITAGENT_KERNEL_DIR") {
            catalog.bitagent.kernel_dir = dir;
        }
        if catalog.model(&catalog.default_model).is_none() {
            return Err(anyhow!("defaultModel {} is not in the catalog", catalog.default_model));
        }
        Ok(catalog)
    }

    fn locate(explicit: Option<&str>) -> Result<PathBuf> {
        if let Some(path) = explicit {
            return Ok(PathBuf::from(path));
        }
        if let Ok(path) = std::env::var("BITAGENT_DESKTOP_CONFIG") {
            return Ok(PathBuf::from(path));
        }
        let mut candidates = Vec::new();
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                candidates.push(dir.join("models.json"));
            }
        }
        candidates.push(PathBuf::from("models.json"));
        candidates.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("models.json"));
        candidates
            .into_iter()
            .find(|path| path.is_file())
            .ok_or_else(|| anyhow!("models.json not found; pass --config or set BITAGENT_DESKTOP_CONFIG"))
    }

    pub fn model(&self, id: &str) -> Option<&ModelSpec> {
        self.models.iter().find(|model| model.id == id)
    }

    /// Resolve a configured path: `~/` from home, relative paths from the catalog's directory.
    pub fn expand(&self, raw: &str) -> PathBuf {
        #[cfg(windows)]
        let raw = &raw.replace('/', "\\");
        if let Some(rest) = raw.strip_prefix("~/").or_else(|| raw.strip_prefix("~\\")) {
            if let Some(home) = home_dir() {
                return home.join(rest);
            }
        }
        let path = PathBuf::from(raw);
        if path.is_absolute() {
            return path;
        }
        self.source_path.parent().map(|dir| dir.join(&path)).unwrap_or(path)
    }

    /// A bare program name (`node`, `bash`) stays as is so the OS looks it up on PATH.
    pub fn program(&self, raw: &str) -> PathBuf {
        if raw.contains('/') || raw.contains('\\') {
            self.expand(raw)
        } else {
            PathBuf::from(raw)
        }
    }

    pub fn context_tokens(&self, model: &ModelSpec) -> usize {
        model.context_tokens.unwrap_or(self.context_tokens)
    }

    pub fn max_tokens(&self, model: &ModelSpec) -> i32 {
        model.max_tokens.unwrap_or(self.max_tokens)
    }
}

/// Where logs and runtime state go: `%LOCALAPPDATA%\BitAgentDesktop` (or `~/.local/state/bitagent-desktop`).
pub fn state_dir() -> PathBuf {
    let dir = std::env::var_os("LOCALAPPDATA")
        .map(|base| PathBuf::from(base).join("BitAgentDesktop"))
        .or_else(|| home_dir().map(|home| home.join(".local").join("state").join("bitagent-desktop")))
        .unwrap_or_else(|| PathBuf::from(".bitagent-desktop"));
    let _ = std::fs::create_dir_all(dir.join("logs"));
    dir
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn shipped_catalog_is_complete() {
        let catalog = Catalog::load(Some(concat!(env!("CARGO_MANIFEST_DIR"), "/models.json"))).unwrap();
        let mut ports = HashSet::new();
        for model in &catalog.models {
            assert!(ports.insert(model.port), "{} reuses port {}", model.id, model.port);
            if model.runtime != Runtime::External {
                assert!(model.vram_mib.is_some(), "{} has no vramMiB", model.id);
            }
            if model.runtime == Runtime::Llama {
                let gguf = model.gguf.as_deref().expect("llama models name a gguf");
                assert!(model.download.iter().any(|file| file.path == gguf), "{} cannot download its gguf", model.id);
            }
            for file in &model.download {
                assert!(file.url.starts_with("https://huggingface.co/") && file.url.contains("/resolve/"));
                assert_eq!(file.sha256.len(), 64);
                assert!(file.bytes > 0);
            }
        }
        assert_eq!(catalog.model("bonsai-8b").and_then(|m| m.vram_mib), Some(3500));
        assert_eq!(catalog.model("inkling-2-mini").map(|m| m.runtime), Some(Runtime::Squid5080));
    }
}
