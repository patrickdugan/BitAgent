//! The YaRN-MCP server (`python -m yarn_mcp serve`) as a goose-agent tool provider. The client speaks
//! newline-delimited JSON-RPC 2.0 over the server's stdio, like the goblin GDK apps in HybridTRMLDT
//! `MCP/goose_gdk_app`, BitAgent `desktop/` and DataGoblin `gdk/`.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, bail, Context, Result};
use async_trait::async_trait;
use goose_agent::operation::Emitter;
use goose_agent::tool::ToolProvider;
use rmcp::model::{CallToolRequestParams, CallToolResult, ErrorData, Tool};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

pub struct McpClient {
    _child: Child,
    stdin: ChildStdin,
    stdout: Lines<BufReader<ChildStdout>>,
    next_id: i64,
    pub instructions: String,
}

impl McpClient {
    /// Start the server and complete the initialize handshake. Its stdin is a pipe, never ours.
    pub async fn spawn(program: &str, args: &[String], cwd: &Path, env: &[(String, String)]) -> Result<Self> {
        let mut command = Command::new(program);
        command
            .args(args)
            .current_dir(cwd)
            .envs(env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .kill_on_drop(true);
        let mut child = command
            .spawn()
            .with_context(|| format!("mcp_start_error: spawning {program} in {}", cwd.display()))?;
        let stdin = child.stdin.take().ok_or_else(|| anyhow!("MCP server has no stdin"))?;
        let stdout = BufReader::new(child.stdout.take().ok_or_else(|| anyhow!("MCP server has no stdout"))?).lines();
        let mut client = Self { _child: child, stdin, stdout, next_id: 0, instructions: String::new() };
        let init = client
            .request(
                "initialize",
                json!({"protocolVersion": "2025-06-18", "capabilities": {},
                       "clientInfo": {"name": "yarn-mcp", "version": env!("CARGO_PKG_VERSION")}}),
            )
            .await
            .context("mcp_start_error: initialize (is yarn_mcp importable by this Python 3.10+?)")?;
        client.instructions = init["instructions"].as_str().unwrap_or_default().to_string();
        client.send(json!({"jsonrpc": "2.0", "method": "notifications/initialized"})).await?;
        Ok(client)
    }

    async fn send(&mut self, message: Value) -> Result<()> {
        let mut line = serde_json::to_vec(&message)?;
        line.push(b'\n');
        self.stdin.write_all(&line).await?;
        self.stdin.flush().await?;
        Ok(())
    }

    pub async fn request(&mut self, method: &str, params: Value) -> Result<Value> {
        self.next_id += 1;
        let id = self.next_id;
        self.send(json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params})).await?;
        while let Some(line) = self.stdout.next_line().await? {
            let Ok(message) = serde_json::from_str::<Value>(&line) else { continue };
            if message.get("id").and_then(Value::as_i64) == Some(id) {
                if let Some(error) = message.get("error") {
                    bail!("MCP error from {method}: {error}");
                }
                return Ok(message["result"].clone());
            }
        }
        bail!("MCP server closed its output")
    }
}

/// Packet settings the server takes on its command line (`python -m yarn_mcp --help`).
#[derive(Clone, Debug)]
pub struct PacketSettings {
    pub token_limit: u64,
    pub max_packet_tokens: u64,
    pub native_ctx: u64,
    pub max_yarn_factor: f64,
    pub reserve_tokens: u64,
    pub tokenize_url: Option<String>,
    pub redact: bool,
}

impl PacketSettings {
    pub fn args(&self) -> Vec<String> {
        let mut args = vec![
            "--token-limit".to_string(),
            self.token_limit.to_string(),
            "--max-packet-tokens".to_string(),
            self.max_packet_tokens.to_string(),
            "--native-ctx".to_string(),
            self.native_ctx.to_string(),
            "--max-yarn-factor".to_string(),
            self.max_yarn_factor.to_string(),
            "--reserve-tokens".to_string(),
            self.reserve_tokens.to_string(),
        ];
        if let Some(url) = &self.tokenize_url {
            args.extend(["--tokenize-url".to_string(), url.clone()]);
        }
        if !self.redact {
            args.push("--no-redact".to_string());
        }
        args
    }
}

/// How to start the server.
pub struct ServerSpec {
    pub python: String,
    /// The app directory: holds `python/yarn_mcp`.
    pub root: PathBuf,
    pub home: Option<PathBuf>,
    pub read_only: bool,
    pub allow_ingest: bool,
    pub packets: PacketSettings,
}

impl ServerSpec {
    /// `python -m yarn_mcp serve ...` arguments and environment.
    pub fn command(&self) -> Result<(Vec<String>, Vec<(String, String)>)> {
        let package = self.root.join("python").join("yarn_mcp");
        if !package.join("server.py").is_file() {
            bail!("mcp_start_error: {} has no python/yarn_mcp (pass --root apps/yarn-mcp)", self.root.display());
        }
        let mut args = vec!["-m".to_string(), "yarn_mcp".to_string(), "serve".to_string()];
        if let Some(home) = &self.home {
            args.extend(["--home".to_string(), home.display().to_string()]);
        }
        if self.read_only {
            args.push("--read-only".to_string());
        }
        if self.allow_ingest {
            args.push("--allow-ingest".to_string());
        }
        args.extend(self.packets.args());
        let separator = if cfg!(windows) { ";" } else { ":" };
        let mut python_path = self.root.join("python").display().to_string();
        if let Ok(existing) = std::env::var("PYTHONPATH") {
            if !existing.is_empty() {
                python_path = format!("{python_path}{separator}{existing}");
            }
        }
        let env = vec![("PYTHONPATH".to_string(), python_path), ("PYTHONIOENCODING".to_string(), "utf-8".to_string())];
        Ok((args, env))
    }
}

/// The YaRN-MCP tools, listed once at connect time.
pub struct YarnTools {
    client: Mutex<McpClient>,
    pub tools: Vec<Tool>,
    pub read_only: HashSet<String>,
    pub instructions: String,
}

impl YarnTools {
    pub async fn connect(spec: &ServerSpec) -> Result<Arc<Self>> {
        let (args, env) = spec.command()?;
        let mut client = McpClient::spawn(&spec.python, &args, &spec.root, &env).await?;
        let listed = client.request("tools/list", json!({})).await.context("mcp_start_error: tools/list")?;
        let raw = listed["tools"].as_array().cloned().unwrap_or_default();
        let read_only = raw
            .iter()
            .filter(|tool| tool["annotations"]["readOnlyHint"].as_bool() == Some(true))
            .filter_map(|tool| tool["name"].as_str().map(str::to_string))
            .collect();
        let tools: Vec<Tool> = serde_json::from_value(Value::Array(raw)).context("mcp_start_error: tool list")?;
        let instructions = client.instructions.clone();
        Ok(Arc::new(Self { client: Mutex::new(client), tools, read_only, instructions }))
    }

    pub fn names(&self) -> HashSet<String> {
        self.tools.iter().map(|tool| tool.name.to_string()).collect()
    }

    /// Call a tool directly (outside the agent loop) and return its structured content.
    pub async fn call_json(&self, name: &str, arguments: Value) -> Result<Value> {
        let raw = self.client.lock().await.request("tools/call", json!({"name": name, "arguments": arguments})).await?;
        if raw["isError"].as_bool() == Some(true) {
            bail!("{name} failed: {}", raw["structuredContent"]);
        }
        Ok(raw["structuredContent"].clone())
    }
}

#[async_trait]
impl<S: Send + Sync + 'static> ToolProvider<S> for YarnTools {
    async fn tools(&self, _session: &S) -> Result<Vec<Tool>> {
        Ok(self.tools.clone())
    }

    async fn call(&self, _session: &S, _request_id: &str, call: CallToolRequestParams, _emit: &Emitter) -> Result<CallToolResult, ErrorData> {
        let arguments = call.arguments.map(Value::Object).unwrap_or_else(|| json!({}));
        let raw = self
            .client
            .lock()
            .await
            .request("tools/call", json!({"name": call.name, "arguments": arguments}))
            .await
            .map_err(|error| ErrorData::internal_error(format!("tool_call_error: {error:#}"), None))?;
        serde_json::from_value(raw)
            .map_err(|error| ErrorData::internal_error(format!("tool_call_error: unreadable result: {error}"), None))
    }
}
