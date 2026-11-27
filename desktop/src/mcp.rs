//! BitAgent's MCP server (`scripts/chatgpt-plugin-server.ts --stdio`) as a goose-agent tool provider.
//!
//! The client speaks newline-delimited JSON-RPC 2.0 over the server's stdio, like the goblin GDK
//! apps' client (HybridTRMLDT `MCP/goose_gdk_app/src/mcp.rs`). Every tool on that server is
//! candidate-only: none can sign, broadcast, approve or move funds.

use std::collections::HashSet;
use std::path::Path;
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

use crate::config::{state_dir, Catalog};

pub struct McpClient {
    _child: Child,
    stdin: ChildStdin,
    stdout: Lines<BufReader<ChildStdout>>,
    next_id: i64,
    pub instructions: String,
    pub server_name: String,
}

impl McpClient {
    /// Start `program args` in `cwd` and complete the initialize handshake. The server's stderr goes
    /// to `log`; its stdin is a pipe, never the parent's.
    pub async fn spawn(program: &Path, args: &[String], cwd: &Path, log: &Path) -> Result<Self> {
        let stderr = std::fs::File::create(log).with_context(|| format!("creating {}", log.display()))?;
        let mut command = Command::new(program);
        command
            .args(args)
            .current_dir(cwd)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(stderr)
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        let mut child = command
            .spawn()
            .with_context(|| format!("mcp_start_error: spawning {} in {}", program.display(), cwd.display()))?;
        let stdin = child.stdin.take().ok_or_else(|| anyhow!("MCP server has no stdin"))?;
        let stdout = BufReader::new(child.stdout.take().ok_or_else(|| anyhow!("MCP server has no stdout"))?).lines();
        let mut client = Self { _child: child, stdin, stdout, next_id: 0, instructions: String::new(), server_name: String::new() };
        let init = client
            .request(
                "initialize",
                json!({"protocolVersion": "2025-06-18", "capabilities": {},
                       "clientInfo": {"name": "bitagent-desktop", "version": env!("CARGO_PKG_VERSION")}}),
            )
            .await
            .context("mcp_start_error: initialize")?;
        client.instructions = init["instructions"].as_str().unwrap_or_default().to_string();
        client.server_name = init["serverInfo"]["name"].as_str().unwrap_or("bitagent").to_string();
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

/// The BitAgent tools, listed once at connect time.
pub struct BitAgentTools {
    client: Mutex<McpClient>,
    pub tools: Vec<Tool>,
    /// Tools the server marks `readOnlyHint: true`.
    pub read_only: HashSet<String>,
    pub instructions: String,
}

impl BitAgentTools {
    pub async fn connect(catalog: &Catalog) -> Result<Arc<Self>> {
        let wiring = &catalog.bitagent;
        let cwd = catalog.expand(&wiring.kernel_dir);
        if !cwd.join("node_modules").is_dir() {
            bail!("mcp_start_error: {} has no node_modules; run `npm ci` there", cwd.display());
        }
        let node = catalog.program(&wiring.node);
        let log = state_dir().join("logs").join("bitagent-mcp.log");
        let mut client = McpClient::spawn(&node, &wiring.mcp_args, &cwd, &log).await.with_context(|| {
            format!("is Node at `{}`? Set bitagent.node in models.json or BITAGENT_NODE", node.display())
        })?;
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

    pub fn title(&self, name: &str) -> String {
        self.tools
            .iter()
            .find(|tool| tool.name == name)
            .and_then(|tool| tool.annotations.as_ref().and_then(|a| a.title.clone()))
            .unwrap_or_else(|| name.to_string())
    }
}

#[async_trait]
impl<S: Send + Sync + 'static> ToolProvider<S> for BitAgentTools {
    async fn tools(&self, _session: &S) -> Result<Vec<Tool>> {
        Ok(self.tools.clone())
    }

    async fn call(
        &self,
        _session: &S,
        _request_id: &str,
        call: CallToolRequestParams,
        _emit: &Emitter,
    ) -> Result<CallToolResult, ErrorData> {
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
