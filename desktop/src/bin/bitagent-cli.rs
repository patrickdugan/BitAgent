//! bitagent-cli: the BitAgent Desktop agent without the window, for Goose-harness runs and CI.
//!
//!   bitagent-cli --list-models
//!   bitagent-cli --once "What is BitAgent?" [--model ID] [--start-server [--cpu]] [--approve read-only|ask|all]
//!   bitagent-cli --download ID
//!
//! `--once` prints one JSON receipt (and appends it to `--out` when given).

use std::io::Write;
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Result};
use bitagent_desktop::agent::{Agent, AgentSetup, ApprovePolicy, Runtime};
use bitagent_desktop::config::{Catalog, ToolMode};
use bitagent_desktop::mcp::BitAgentTools;
use bitagent_desktop::models;
use serde_json::json;
use tokio_util::sync::CancellationToken;

const USAGE: &str = "usage: bitagent-cli (--list-models | --once PROMPT | --download ID) [--config FILE] [--model ID] \
[--base-url URL] [--served-model NAME] [--tool-mode native|text] [--approve read-only|ask|all] [--start-server [--cpu]] \
[--max-tokens N] [--max-turns N] [--timeout-secs N] [--node PATH] [--kernel-dir DIR] [--out FILE]";

#[derive(Default)]
struct Args {
    list: bool,
    once: Option<String>,
    download: Option<String>,
    config: Option<String>,
    model: Option<String>,
    base_url: Option<String>,
    served_model: Option<String>,
    tool_mode: Option<ToolMode>,
    approve: Option<ApprovePolicy>,
    start_server: bool,
    cpu: bool,
    max_tokens: Option<i32>,
    max_turns: Option<u32>,
    timeout_secs: Option<u64>,
    node: Option<String>,
    kernel_dir: Option<String>,
    out: Option<String>,
}

fn parse_args() -> Result<Args> {
    let mut args = Args::default();
    let mut it = std::env::args().skip(1);
    while let Some(flag) = it.next() {
        let mut value = || it.next().ok_or_else(|| anyhow!("{flag} needs a value"));
        match flag.as_str() {
            "--list-models" => args.list = true,
            "--once" => args.once = Some(value()?),
            "--download" => args.download = Some(value()?),
            "--config" => args.config = Some(value()?),
            "--model" => args.model = Some(value()?),
            "--base-url" => args.base_url = Some(value()?),
            "--served-model" => args.served_model = Some(value()?),
            "--tool-mode" => {
                args.tool_mode = Some(match value()?.as_str() {
                    "native" => ToolMode::Native,
                    "text" => ToolMode::Text,
                    other => bail!("--tool-mode {other}: native or text"),
                })
            }
            "--approve" => {
                let raw = value()?;
                args.approve = Some(ApprovePolicy::parse(&raw).ok_or_else(|| anyhow!("--approve {raw}: read-only, ask or all"))?);
            }
            "--start-server" => args.start_server = true,
            "--cpu" => args.cpu = true,
            "--max-tokens" => args.max_tokens = Some(value()?.parse()?),
            "--max-turns" => args.max_turns = Some(value()?.parse()?),
            "--timeout-secs" => args.timeout_secs = Some(value()?.parse()?),
            "--node" => args.node = Some(value()?),
            "--kernel-dir" => args.kernel_dir = Some(value()?),
            "--out" => args.out = Some(value()?),
            "--help" | "-h" => bail!("{USAGE}"),
            other => bail!("unknown flag {other}\n{USAGE}"),
        }
    }
    if !args.list && args.once.is_none() && args.download.is_none() {
        bail!("{USAGE}");
    }
    Ok(args)
}

async fn list_models(catalog: &Catalog) -> Result<()> {
    for model in &catalog.models {
        let health = models::health(catalog, model).await;
        let row = json!({
            "id": model.id, "label": model.label, "family": model.family, "runtime": format!("{:?}", model.runtime),
            "baseUrl": model.base_url(), "servedModel": model.served_model, "toolMode": model.tools.as_str(),
            "health": health.word(), "missing": match &health { models::Health::Missing(paths) => json!(paths), _ => json!([]) },
            "downloadBytes": model.download.iter().map(|f| f.bytes).sum::<u64>(),
            "default": model.id == catalog.default_model,
        });
        println!("{row}");
    }
    Ok(())
}

async fn once(mut catalog: Catalog, args: &Args, prompt: &str) -> Result<i32> {
    if let Some(node) = &args.node {
        catalog.bitagent.node = node.clone();
    }
    if let Some(dir) = &args.kernel_dir {
        catalog.bitagent.kernel_dir = dir.clone();
    }
    let id = args.model.clone().unwrap_or_else(|| catalog.default_model.clone());
    let mut model = catalog.model(&id).cloned().ok_or_else(|| anyhow!("unknown model {id}"))?;
    if let Some(url) = &args.base_url {
        model.base_url = Some(url.clone());
    }
    if let Some(name) = &args.served_model {
        model.served_model = name.clone();
    }
    let started = Instant::now();
    let mut server = None;
    if args.start_server && !models::probe(&model).await {
        let mut process = models::start(&catalog, &model, args.cpu)?;
        eprintln!("[bitagent-cli] starting {} (log {})", model.id, process.log.display());
        if let Err(error) = models::wait_ready(&model, &mut process, Duration::from_secs(20 * 60)).await {
            models::stop(&catalog, &model, Some(process))?;
            return Err(error);
        }
        server = Some(process);
    }
    let tools = BitAgentTools::connect(&catalog).await?;
    let setup = AgentSetup {
        tool_mode: args.tool_mode.unwrap_or(model.tools),
        context_tokens: catalog.context_tokens(&model),
        max_tokens: args.max_tokens.unwrap_or(catalog.max_tokens(&model)),
        max_turns: args.max_turns.unwrap_or(catalog.max_turns),
        policy: args.approve.unwrap_or(ApprovePolicy::ReadOnly),
        headless: true,
        timeout: Duration::from_secs(args.timeout_secs.unwrap_or(600)),
        model: model.clone(),
    };
    let agent = Agent::new(setup, tools, Runtime::new())?;
    agent.push_user(prompt);
    let error = agent.run(CancellationToken::new()).await.err().map(|e| format!("agent_error: {e:#}"));
    let receipt = agent.receipt(prompt, started, error.clone());
    println!("{receipt}");
    if let Some(path) = &args.out {
        let mut file = std::fs::OpenOptions::new().create(true).append(true).open(path)?;
        writeln!(file, "{receipt}")?;
    }
    if server.is_some() {
        models::stop(&catalog, &model, server)?;
    }
    Ok(if error.is_some() { 1 } else { 0 })
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = parse_args()?;
    let catalog = Catalog::load(args.config.as_deref())?;
    if args.list {
        return list_models(&catalog).await;
    }
    if let Some(id) = &args.download {
        let model = catalog.model(id).cloned().ok_or_else(|| anyhow!("unknown model {id}"))?;
        let last = std::sync::Mutex::new(Instant::now());
        models::download(&catalog, &model, |path, done, total| {
            let mut last = last.lock().unwrap();
            if done == total || last.elapsed() > Duration::from_secs(5) {
                eprintln!("[download] {path}: {done}/{total} bytes");
                *last = Instant::now();
            }
        })
        .await?;
        println!("{}", json!({"downloaded": id, "files": model.download.iter().map(|f| &f.path).collect::<Vec<_>>()}));
        return Ok(());
    }
    let prompt = args.once.clone().unwrap_or_default();
    let code = once(catalog, &args, &prompt).await?;
    std::process::exit(code);
}
