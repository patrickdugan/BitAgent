//! yarn-mcp: the YaRN-MCP GDK app.
//!
//!   yarn-mcp run (--prompt TEXT | --skill NAME [--args TEXT]) [options]   agent run, prints a receipt
//!   yarn-mcp "QUESTION" [options]                                         same as run --prompt
//!   yarn-mcp ingest PATH [--include-reasoning] [--include-do-not-remember]
//!   yarn-mcp distill [--query Q | --theme T | --thread R] [--token-limit N] [--preset qwen3] [--user-only]
//!   yarn-mcp status | tools | skills | call TOOL [JSON]
//!   yarn-mcp serve      the stdio MCP server itself, for goose or any MCP client
//!
//! The archive lives in --home, else $YARN_MCP_HOME, else ~/.yarn-mcp. Agent runs append their receipt
//! to `<home>/receipts.jsonl` (or --receipts).

use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Result};
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;
use yarn_mcp_gdk::agent::{Agent, AgentSetup, ApprovePolicy, ToolMode};
use yarn_mcp_gdk::mcp::{PacketSettings, ServerSpec, YarnTools};
use yarn_mcp_gdk::skills::SkillSet;

const COMMANDS: [&str; 9] = ["run", "ingest", "distill", "status", "tools", "skills", "call", "serve", "help"];

const USAGE: &str = "usage: yarn-mcp (run (--prompt TEXT | --skill NAME [--args TEXT]) | \"QUESTION\" | ingest PATH \
| distill [--query Q] [--theme T] [--thread R] [--preset qwen3|qwen2.5] [--user-only] [--label TEXT] | status | tools \
| skills | call TOOL [JSON] | serve)\n  [--root DIR] [--python PY] [--home DIR] [--base-url URL] [--model ID] \
[--tool-mode native|text] [--approve read-only|packets|all] [--max-turns N] [--max-tokens N] [--context N] \
[--temperature F] [--timeout-secs N] [--receipts FILE] [--skills-dir DIR]...\n  packet options: [--token-limit N] \
[--max-packet-tokens N] [--native-ctx N] [--max-yarn-factor F] [--reserve-tokens N] [--tokenize-url URL] [--no-redact]";

struct Args {
    command: String,
    positional: Vec<String>,
    root: PathBuf,
    python: String,
    home: Option<PathBuf>,
    base_url: String,
    model: String,
    tool_mode: ToolMode,
    approve: ApprovePolicy,
    max_turns: u32,
    max_tokens: i32,
    context: usize,
    temperature: f32,
    timeout_secs: u64,
    receipts: Option<PathBuf>,
    skills_dirs: Vec<PathBuf>,
    prompt: Option<String>,
    skill: Option<String>,
    skill_args: String,
    packets: PacketSettings,
    distill: serde_json::Map<String, Value>,
    include_reasoning: bool,
    include_dnr: bool,
}

fn env_or(name: &str, default: &str) -> String {
    std::env::var(name).ok().filter(|v| !v.is_empty()).unwrap_or_else(|| default.to_string())
}

fn loopback(url: &str) -> bool {
    ["http://127.0.0.1:", "http://localhost:", "http://[::1]:"].iter().any(|prefix| url.starts_with(prefix))
}

fn parse_args() -> Result<Args> {
    let mut raw = std::env::args().skip(1).peekable();
    let command = match raw.peek().map(String::as_str) {
        Some("--help" | "-h" | "help") | None => bail!("{USAGE}"),
        Some(first) if COMMANDS.contains(&first) => raw.next().unwrap(),
        Some(first) if !first.starts_with('-') => "ask".to_string(),
        Some(_) => "run".to_string(),
    };
    let mut args = Args {
        command,
        positional: Vec::new(),
        root: PathBuf::from(env_or("YARN_MCP_ROOT", env!("CARGO_MANIFEST_DIR"))),
        python: env_or("YARN_MCP_PYTHON", "python"),
        home: std::env::var("YARN_MCP_HOME").ok().filter(|v| !v.is_empty()).map(PathBuf::from),
        base_url: env_or("YARN_MCP_BASE_URL", "http://127.0.0.1:18090/v1"),
        model: env_or("YARN_MCP_MODEL", "inkling-2-mini"),
        tool_mode: ToolMode::Native,
        approve: ApprovePolicy::Packets,
        max_turns: 24,
        max_tokens: 2048,
        context: 32768,
        temperature: 0.2,
        timeout_secs: 900,
        receipts: None,
        skills_dirs: Vec::new(),
        prompt: None,
        skill: None,
        skill_args: String::new(),
        packets: PacketSettings {
            token_limit: 32000,
            max_packet_tokens: 131072,
            native_ctx: 32768,
            max_yarn_factor: 4.0,
            reserve_tokens: 4096,
            tokenize_url: None,
            redact: true,
        },
        distill: serde_json::Map::new(),
        include_reasoning: false,
        include_dnr: false,
    };
    while let Some(flag) = raw.next() {
        if !flag.starts_with("--") {
            args.positional.push(flag);
            continue;
        }
        let mut value = || raw.next().ok_or_else(|| anyhow!("{flag} needs a value"));
        match flag.as_str() {
            "--root" => args.root = PathBuf::from(value()?),
            "--python" => args.python = value()?,
            "--home" => args.home = Some(PathBuf::from(value()?)),
            "--base-url" => args.base_url = value()?,
            "--model" => args.model = value()?,
            "--tool-mode" => {
                args.tool_mode = match value()?.as_str() {
                    "native" => ToolMode::Native,
                    "text" => ToolMode::Text,
                    other => bail!("--tool-mode {other}: native or text"),
                }
            }
            "--approve" => {
                let raw = value()?;
                args.approve = ApprovePolicy::parse(&raw).ok_or_else(|| anyhow!("--approve {raw}: read-only, packets or all"))?;
            }
            "--max-turns" => args.max_turns = value()?.parse()?,
            "--max-tokens" => args.max_tokens = value()?.parse()?,
            "--context" => args.context = value()?.parse()?,
            "--temperature" => args.temperature = value()?.parse()?,
            "--timeout-secs" => args.timeout_secs = value()?.parse()?,
            "--receipts" => args.receipts = Some(PathBuf::from(value()?)),
            "--skills-dir" => args.skills_dirs.push(PathBuf::from(value()?)),
            "--prompt" => args.prompt = Some(value()?),
            "--skill" => args.skill = Some(value()?),
            "--args" => args.skill_args = value()?,
            "--token-limit" => {
                args.packets.token_limit = value()?.parse()?;
                args.distill.insert("token_limit".into(), json!(args.packets.token_limit));
            }
            "--max-packet-tokens" => args.packets.max_packet_tokens = value()?.parse()?,
            "--native-ctx" => args.packets.native_ctx = value()?.parse()?,
            "--max-yarn-factor" => args.packets.max_yarn_factor = value()?.parse()?,
            "--reserve-tokens" => args.packets.reserve_tokens = value()?.parse()?,
            "--tokenize-url" => {
                let url = value()?;
                if !loopback(&url) {
                    bail!("--tokenize-url {url}: a local server only (http://127.0.0.1:PORT/tokenize)");
                }
                args.packets.tokenize_url = Some(url);
            }
            "--no-redact" => args.packets.redact = false,
            "--query" | "--theme" | "--thread" | "--label" => {
                let key = flag.trim_start_matches("--").to_string();
                args.distill.insert(key, json!(value()?));
            }
            "--preset" => {
                args.distill.insert("model".into(), json!(value()?));
            }
            "--user-only" => {
                args.distill.insert("include_assistant".into(), json!(false));
            }
            "--include-reasoning" => args.include_reasoning = true,
            "--include-do-not-remember" => args.include_dnr = true,
            "--help" | "-h" => bail!("{USAGE}"),
            other => bail!("unknown flag {other}\n{USAGE}"),
        }
    }
    args.root = std::fs::canonicalize(&args.root).map_err(|e| anyhow!("--root {}: {e}", args.root.display()))?;
    if args.skills_dirs.is_empty() {
        args.skills_dirs.push(args.root.join("skills"));
    }
    if !loopback(&args.base_url) {
        bail!("{}: YaRN-MCP talks to local model servers only (http://127.0.0.1:PORT/v1); the archive stays on this machine", args.base_url);
    }
    if !args.base_url.ends_with('/') {
        args.base_url.push('/');
    }
    if args.command == "ask" {
        args.prompt = Some(args.positional.join(" "));
        args.command = "run".into();
    }
    if args.command == "run" && args.prompt.is_none() && args.skill.is_none() {
        bail!("run needs --prompt or --skill\n{USAGE}");
    }
    Ok(args)
}

fn home(args: &Args) -> PathBuf {
    args.home.clone().unwrap_or_else(|| {
        let base = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_else(|_| ".".into());
        PathBuf::from(base).join(".yarn-mcp")
    })
}

fn spec(args: &Args) -> ServerSpec {
    ServerSpec {
        python: args.python.clone(),
        root: args.root.clone(),
        home: Some(home(args)),
        read_only: args.approve == ApprovePolicy::ReadOnly && matches!(args.command.as_str(), "run" | "serve"),
        allow_ingest: args.approve == ApprovePolicy::All || args.command == "ingest",
        packets: args.packets.clone(),
    }
}

fn setup(args: &Args) -> AgentSetup {
    AgentSetup {
        base_url: args.base_url.clone(),
        served_model: args.model.clone(),
        tool_mode: args.tool_mode,
        context_tokens: args.context,
        max_tokens: args.max_tokens,
        max_turns: args.max_turns,
        temperature: args.temperature,
        policy: args.approve,
        timeout: Duration::from_secs(args.timeout_secs),
    }
}

fn append_receipt(args: &Args, receipt: &Value) -> Result<()> {
    let path = args.receipts.clone().unwrap_or_else(|| home(args).join("receipts.jsonl"));
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut file = std::fs::OpenOptions::new().create(true).append(true).open(&path)?;
    writeln!(file, "{receipt}")?;
    Ok(())
}

/// `serve`: the Python stdio server with this process's stdio, for goose and other MCP clients.
fn serve(args: &Args) -> Result<i32> {
    let spec = spec(args);
    let (server_args, env) = spec.command()?;
    let status = std::process::Command::new(&spec.python)
        .args(&server_args)
        .current_dir(&spec.root)
        .envs(env)
        .status()
        .map_err(|e| anyhow!("mcp_start_error: spawning {}: {e}", spec.python))?;
    Ok(status.code().unwrap_or(1))
}

async fn direct(args: &Args, tools: &YarnTools) -> Result<i32> {
    let (name, arguments) = match args.command.as_str() {
        "status" => ("archive_status".to_string(), json!({})),
        "ingest" => {
            let path = args.positional.first().ok_or_else(|| anyhow!("ingest needs PATH\n{USAGE}"))?;
            let path = std::fs::canonicalize(path).map_err(|e| anyhow!("{path}: {e}"))?;
            (
                "ingest_export".to_string(),
                json!({"path": path.display().to_string(), "include_reasoning": args.include_reasoning,
                       "include_do_not_remember": args.include_dnr}),
            )
        }
        "distill" => ("distill_yarn".to_string(), Value::Object(args.distill.clone())),
        "call" => {
            let name = args.positional.first().ok_or_else(|| anyhow!("call needs TOOL\n{USAGE}"))?.clone();
            let arguments = match args.positional.get(1) {
                Some(text) => serde_json::from_str(text).map_err(|e| anyhow!("call {name}: arguments are not JSON: {e}"))?,
                None => json!({}),
            };
            (name, arguments)
        }
        other => bail!("unknown command {other}"),
    };
    match tools.call_json(&name, arguments).await {
        Ok(result) => {
            println!("{}", serde_json::to_string_pretty(&result)?);
            Ok(0)
        }
        Err(error) => {
            eprintln!("{error:#}");
            Ok(2)
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = parse_args()?;
    let skills = Arc::new(SkillSet::discover(&args.skills_dirs));
    if args.command == "skills" {
        for skill in &skills.entries {
            println!(
                "{}",
                json!({"name": skill.name, "description": skill.description, "path": skill.path,
                       "supportingFiles": skill.supporting_files.len()})
            );
        }
        return Ok(());
    }
    if args.command == "serve" {
        std::process::exit(serve(&args)?);
    }
    let tools = YarnTools::connect(&spec(&args)).await?;
    let code = match args.command.as_str() {
        "tools" => {
            let mut names: Vec<String> = tools.names().into_iter().collect();
            names.sort();
            let mut read_only: Vec<&String> = tools.read_only.iter().collect();
            read_only.sort();
            println!(
                "{}",
                json!({"tools": names, "readOnly": read_only, "skills": skills.names(), "approve": args.approve.as_str(),
                       "home": home(&args), "packets": args.packets.args(), "instructions": tools.instructions})
            );
            0
        }
        "run" => {
            let prompt = match (&args.prompt, &args.skill) {
                (Some(prompt), _) => prompt.clone(),
                (None, Some(skill)) => format!("/{skill} {}", args.skill_args).trim_end().to_string(),
                (None, None) => unreachable!(),
            };
            let started = Instant::now();
            let agent = Agent::new(setup(&args), tools.clone(), skills.clone())?;
            agent.push_user(&prompt);
            let error = agent.run(CancellationToken::new()).await.err().map(|e| format!("agent_error: {e:#}"));
            let receipt = agent.receipt(&prompt, started, error);
            append_receipt(&args, &receipt)?;
            println!("{receipt}");
            i32::from(receipt["error"].is_string())
        }
        _ => direct(&args, &tools).await?,
    };
    std::process::exit(code);
}
