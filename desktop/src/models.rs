//! Local model servers: health probes, start/stop, and pinned downloads.
//!
//! `llama` models run PrismML's llama.cpp `llama-server`, queued behind a vramorama lease when
//! `programs.vramorama` exists (the GPU is shared). `squid5080` runs the squid5080 launcher, which
//! takes its own 15 GB lease. `external` servers are only probed.

use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Context, Result};
use futures_util::StreamExt;
use sha2::{Digest, Sha256};

use crate::config::{state_dir, Catalog, ModelSpec, Runtime};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Health {
    /// Files or programs the model needs are not on disk.
    Missing(Vec<String>),
    /// Nothing answers on the model's port.
    Down,
    /// `GET /v1/models` answers.
    Ready,
}

impl Health {
    pub fn word(&self) -> &'static str {
        match self {
            Health::Missing(_) => "missing",
            Health::Down => "stopped",
            Health::Ready => "ready",
        }
    }
}

/// Paths the model needs that do not exist.
pub fn missing(catalog: &Catalog, model: &ModelSpec) -> Vec<String> {
    let mut needed: Vec<PathBuf> = Vec::new();
    match model.runtime {
        Runtime::Llama => {
            needed.push(catalog.program(&catalog.programs.llama_server));
            if let Some(gguf) = &model.gguf {
                needed.push(catalog.expand(gguf));
            }
        }
        Runtime::Squid5080 => {
            needed.push(catalog.program(&catalog.programs.bash));
            needed.push(catalog.expand(&catalog.programs.squid_serve));
        }
        Runtime::External => {}
    }
    needed
        .into_iter()
        .filter(|path| path.components().count() > 1 && !path.exists())
        .map(|path| path.display().to_string())
        .collect()
}

/// True when the port answers `GET /v1/models` with an OpenAI model list (not, say, a web app's
/// sign-in redirect).
pub async fn probe(model: &ModelSpec) -> bool {
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_millis(1500))
        .redirect(reqwest::redirect::Policy::none())
        .build()
    else {
        return false;
    };
    let Ok(response) = client.get(format!("{}models", model.base_url())).send().await else { return false };
    if !response.status().is_success() {
        return false;
    }
    let Ok(body) = response.bytes().await else { return false };
    serde_json::from_slice::<serde_json::Value>(&body)
        .map(|value| value.get("data").is_some_and(serde_json::Value::is_array))
        .unwrap_or(false)
}

pub async fn health(catalog: &Catalog, model: &ModelSpec) -> Health {
    if probe(model).await {
        return Health::Ready;
    }
    let missing = missing(catalog, model);
    if missing.is_empty() {
        Health::Down
    } else {
        Health::Missing(missing)
    }
}

/// A server process this app started.
pub struct ServerProcess {
    pub model_id: String,
    pub child: Child,
    pub log: PathBuf,
    pub started: Instant,
}

fn hidden(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    command
}

/// The command line that serves `model`.
pub fn server_command(catalog: &Catalog, model: &ModelSpec) -> Result<Vec<String>> {
    let programs = &catalog.programs;
    match model.runtime {
        Runtime::External => bail!("{} is an external server; start it yourself", model.id),
        Runtime::Squid5080 => Ok(vec![
            catalog.program(&programs.bash).display().to_string(),
            catalog.expand(&programs.squid_serve).display().to_string(),
            model.port.to_string(),
        ]),
        Runtime::Llama => {
            let gguf = model.gguf.as_ref().ok_or_else(|| anyhow!("{} has no gguf", model.id))?;
            let mut command = Vec::new();
            if let Some(vramorama) = programs.vramorama.as_ref().map(|v| catalog.program(v)).filter(|v| v.exists()) {
                command.extend([
                    vramorama.display().to_string(),
                    "run".into(),
                    "--vram".into(),
                    format!("{}M", model.vram_mib.unwrap_or(8000)),
                    "--owner".into(),
                    format!("{}-{}", programs.gpu_owner, model.id),
                    "--".into(),
                ]);
            }
            command.extend([
                catalog.program(&programs.llama_server).display().to_string(),
                "-m".into(),
                catalog.expand(gguf).display().to_string(),
                "--host".into(),
                "127.0.0.1".into(),
                "--port".into(),
                model.port.to_string(),
                "-c".into(),
                catalog.context_tokens(model).to_string(),
                "-ngl".into(),
                "99".into(),
                "-np".into(),
                "1".into(),
                "--jinja".into(),
                "--alias".into(),
                model.served_model.clone(),
            ]);
            command.extend(model.args.iter().cloned());
            Ok(command)
        }
    }
}

pub fn start(catalog: &Catalog, model: &ModelSpec) -> Result<ServerProcess> {
    let missing = missing(catalog, model);
    if !missing.is_empty() {
        bail!("model_missing: {} needs {}", model.id, missing.join(", "));
    }
    let argv = server_command(catalog, model)?;
    let log = state_dir().join("logs").join(format!("{}.log", model.id));
    let mut file = std::fs::File::create(&log).with_context(|| format!("creating {}", log.display()))?;
    writeln!(file, "$ {}", argv.join(" "))?;
    let stderr = file.try_clone()?;
    let mut command = Command::new(&argv[0]);
    command.args(&argv[1..]).stdin(Stdio::null()).stdout(file).stderr(stderr);
    if model.runtime == Runtime::Squid5080 {
        command.env("MSYS_NO_PATHCONV", "1");
    }
    let child = hidden(&mut command).spawn().with_context(|| format!("server_start_error: spawning {}", argv[0]))?;
    Ok(ServerProcess { model_id: model.id.clone(), child, log, started: Instant::now() })
}

/// Stop a model's server: squid through its stop script, a started process by killing its tree.
pub fn stop(catalog: &Catalog, model: &ModelSpec, process: Option<ServerProcess>) -> Result<()> {
    if model.runtime == Runtime::Squid5080 {
        let mut command = Command::new(catalog.program(&catalog.programs.bash));
        command.arg(catalog.expand(&catalog.programs.squid_stop)).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        hidden(&mut command).status().context("running the squid5080 stop script")?;
    }
    if let Some(mut process) = process {
        kill_tree(&mut process.child);
    }
    Ok(())
}

fn kill_tree(child: &mut Child) {
    #[cfg(windows)]
    {
        let mut command = Command::new("taskkill");
        command.args(["/PID", &child.id().to_string(), "/T", "/F"]).stdout(Stdio::null()).stderr(Stdio::null());
        let _ = hidden(&mut command).status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// Wait until the model answers, its process exits, or `limit` passes.
pub async fn wait_ready(model: &ModelSpec, process: &mut ServerProcess, limit: Duration) -> Result<()> {
    let deadline = Instant::now() + limit;
    loop {
        if probe(model).await {
            return Ok(());
        }
        if let Some(status) = process.child.try_wait()? {
            bail!("server_start_error: {} exited with {status}; see {}", model.id, process.log.display());
        }
        if Instant::now() > deadline {
            bail!("server_start_error: {} not ready after {:?}; see {}", model.id, limit, process.log.display());
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Download the model's pinned files to `<path>.partial`, check byte count and SHA-256, then rename.
/// Files already present with the right size are kept.
pub async fn download(catalog: &Catalog, model: &ModelSpec, progress: impl Fn(&str, u64, u64)) -> Result<()> {
    if model.download.is_empty() {
        bail!("{} has no pinned download", model.id);
    }
    let client = reqwest::Client::builder().connect_timeout(Duration::from_secs(30)).build()?;
    for file in &model.download {
        if !file.url.starts_with("https://huggingface.co/") {
            bail!("download_error: {} is not a Hugging Face URL", file.url);
        }
        let path = catalog.expand(&file.path);
        if std::fs::metadata(&path).map(|m| m.len() == file.bytes).unwrap_or(false) {
            progress(&file.path, file.bytes, file.bytes);
            continue;
        }
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let partial = path.with_extension("partial");
        let response = client.get(&file.url).send().await?.error_for_status().context("download_error")?;
        let mut out = std::fs::File::create(&partial)?;
        let mut hasher = Sha256::new();
        let mut done = 0u64;
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.context("download_error: stream")?;
            out.write_all(&chunk)?;
            hasher.update(&chunk);
            done += chunk.len() as u64;
            progress(&file.path, done, file.bytes);
        }
        out.flush()?;
        drop(out);
        let digest = hex(&hasher.finalize());
        if done != file.bytes || digest != file.sha256 {
            let _ = std::fs::remove_file(&partial);
            bail!("download_error: {} gave {done} bytes sha256 {digest}; pinned {} bytes {}", file.url, file.bytes, file.sha256);
        }
        std::fs::rename(&partial, &path)?;
    }
    Ok(())
}
