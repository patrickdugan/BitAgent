//! bitagent-desktop: the BitAgent Desktop window (egui), a Goose GDK app.
//!
//! Left: the local model catalog (Inkling 2 Mini on squid5080, Ternary Bonsai 2.5/2 GGUFs), with
//! health, start/stop and pinned downloads. Centre: the conversation, tool calls and their results.
//! Approval cards appear when the model calls a BitAgent tool that is not read-only. Servers this
//! window started are stopped when it closes.

#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{anyhow, Result};
use bitagent_desktop::agent::{pending_approvals, Agent, AgentSetup, ApprovePolicy, Runtime, GDK};
use bitagent_desktop::config::{state_dir, Catalog, ModelSpec, Runtime as ServerKind};
use bitagent_desktop::mcp::BitAgentTools;
use bitagent_desktop::models::{self, Health, ServerProcess};
use bitagent_desktop::text_tools::{result_text, truncate};
use eframe::egui;
use goose_provider_types::conversation::message::MessageContent;
use goose_provider_types::conversation::{effective_role, Conversation, EffectiveRole};
use tokio_util::sync::CancellationToken;

const RED: egui::Color32 = egui::Color32::from_rgb(200, 80, 80);

#[derive(Default)]
struct Shared {
    health: HashMap<String, Health>,
    tools: Option<Arc<BitAgentTools>>,
    mcp_error: Option<String>,
    busy: bool,
    error: Option<String>,
    servers: HashMap<String, ServerProcess>,
    downloads: HashMap<String, (u64, u64)>,
}

struct DesktopApp {
    rt: tokio::runtime::Runtime,
    catalog: Arc<Catalog>,
    shared: Arc<Mutex<Shared>>,
    runtime: Arc<Runtime>,
    selected: String,
    policy: ApprovePolicy,
    input: String,
    cancel: Option<CancellationToken>,
}

impl DesktopApp {
    fn new(cc: &eframe::CreationContext<'_>, catalog: Catalog) -> Result<Self> {
        let rt = tokio::runtime::Builder::new_multi_thread().enable_all().worker_threads(2).build()?;
        let catalog = Arc::new(catalog);
        let shared = Arc::new(Mutex::new(Shared::default()));
        let ctx = cc.egui_ctx.clone();

        // BitAgent's MCP server.
        {
            let (catalog, shared, ctx) = (catalog.clone(), shared.clone(), ctx.clone());
            rt.spawn(async move {
                let result = BitAgentTools::connect(&catalog).await;
                let mut shared = shared.lock().unwrap();
                match result {
                    Ok(tools) => shared.tools = Some(tools),
                    Err(error) => shared.mcp_error = Some(format!("{error:#}")),
                }
                ctx.request_repaint();
            });
        }

        // Model health every 3 s; also notices a started server that exited.
        {
            let (catalog, shared, ctx) = (catalog.clone(), shared.clone(), ctx.clone());
            rt.spawn(async move {
                loop {
                    let probes = catalog.models.iter().map(|model| models::health(&catalog, model));
                    let health: HashMap<String, Health> = catalog
                        .models
                        .iter()
                        .map(|model| model.id.clone())
                        .zip(futures_util::future::join_all(probes).await)
                        .collect();
                    {
                        let mut shared = shared.lock().unwrap();
                        shared.health = health;
                        let exited: Vec<(String, String)> = shared
                            .servers
                            .iter_mut()
                            .filter_map(|(id, process)| match process.child.try_wait() {
                                Ok(Some(status)) => Some((id.clone(), format!("{id} exited ({status}); log {}", process.log.display()))),
                                _ => None,
                            })
                            .collect();
                        for (id, message) in exited {
                            shared.servers.remove(&id);
                            shared.error = Some(format!("server_start_error: {message}"));
                        }
                    }
                    ctx.request_repaint();
                    tokio::time::sleep(Duration::from_secs(3)).await;
                }
            });
        }

        Ok(Self {
            rt,
            selected: catalog.default_model.clone(),
            catalog,
            shared,
            runtime: Runtime::new(),
            policy: ApprovePolicy::ReadOnly,
            input: String::new(),
            cancel: None,
        })
    }

    fn model(&self) -> ModelSpec {
        self.catalog.model(&self.selected).cloned().expect("selected model is in the catalog")
    }

    fn agent(&self) -> Result<Agent> {
        let tools = self.shared.lock().unwrap().tools.clone().ok_or_else(|| anyhow!("BitAgent tools are not connected"))?;
        let model = self.model();
        let setup = AgentSetup {
            tool_mode: model.tools,
            context_tokens: self.catalog.context_tokens(&model),
            max_tokens: self.catalog.max_tokens(&model),
            max_turns: self.catalog.max_turns,
            policy: self.policy,
            headless: false,
            timeout: Duration::from_secs(900),
            model,
        };
        Agent::new(setup, tools, self.runtime.clone())
    }

    /// Run the agent in the background; `prepare` adds the user message or an approval answer first.
    fn run_agent(&mut self, ctx: &egui::Context, prepare: impl FnOnce(&Agent)) {
        let agent = match self.agent() {
            Ok(agent) => agent,
            Err(error) => {
                self.shared.lock().unwrap().error = Some(format!("{error:#}"));
                return;
            }
        };
        prepare(&agent);
        let cancel = CancellationToken::new();
        self.cancel = Some(cancel.clone());
        let (shared, ctx) = (self.shared.clone(), ctx.clone());
        {
            let mut shared = shared.lock().unwrap();
            shared.busy = true;
            shared.error = None;
        }
        self.rt.spawn(async move {
            let result = agent.run(cancel).await;
            let mut shared = shared.lock().unwrap();
            shared.busy = false;
            if let Err(error) = result {
                shared.error = Some(format!("model_error: {error:#}"));
            }
            ctx.request_repaint();
        });
    }

    fn start_server(&self, model: &ModelSpec) {
        let result = models::start(&self.catalog, model);
        let mut shared = self.shared.lock().unwrap();
        match result {
            Ok(process) => {
                shared.servers.insert(model.id.clone(), process);
                shared.error = None;
            }
            Err(error) => shared.error = Some(format!("{error:#}")),
        }
    }

    fn stop_server(&self, model: &ModelSpec) {
        let process = self.shared.lock().unwrap().servers.remove(&model.id);
        let (catalog, model, shared) = (self.catalog.clone(), model.clone(), self.shared.clone());
        self.rt.spawn_blocking(move || {
            if let Err(error) = models::stop(&catalog, &model, process) {
                shared.lock().unwrap().error = Some(format!("{error:#}"));
            }
        });
    }

    fn download(&self, ctx: &egui::Context, model: &ModelSpec) {
        let total: u64 = model.download.iter().map(|f| f.bytes).sum();
        let (catalog, model, shared, ctx) = (self.catalog.clone(), model.clone(), self.shared.clone(), ctx.clone());
        shared.lock().unwrap().downloads.insert(model.id.clone(), (0, total));
        self.rt.spawn(async move {
            let finished = Mutex::new(0u64);
            let result = models::download(&catalog, &model, |_path, done, bytes| {
                let mut finished = finished.lock().unwrap();
                let progress = if done == bytes {
                    *finished += bytes;
                    *finished
                } else {
                    *finished + done
                };
                shared.lock().unwrap().downloads.insert(model.id.clone(), (progress.min(total), total));
                ctx.request_repaint();
            })
            .await;
            let mut shared = shared.lock().unwrap();
            shared.downloads.remove(&model.id);
            if let Err(error) = result {
                shared.error = Some(format!("{error:#}"));
            }
            ctx.request_repaint();
        });
    }

    fn models_panel(&mut self, ui: &mut egui::Ui) {
        ui.heading("Models");
        ui.add_space(4.0);
        let (health, servers, busy) = {
            let shared = self.shared.lock().unwrap();
            (shared.health.clone(), shared.servers.keys().cloned().collect::<Vec<_>>(), shared.busy)
        };
        let mut families: Vec<String> = Vec::new();
        for model in &self.catalog.models {
            if !families.contains(&model.family) {
                families.push(model.family.clone());
            }
        }
        let catalog = self.catalog.clone();
        for family in families {
            ui.label(egui::RichText::new(&family).small().weak());
            for model in catalog.models.iter().filter(|m| m.family == family) {
                let (dot, color) = match health.get(&model.id) {
                    Some(Health::Ready) => ("\u{25CF}", egui::Color32::from_rgb(60, 170, 90)),
                    Some(Health::Down) if servers.contains(&model.id) => ("\u{25CF}", egui::Color32::from_rgb(220, 160, 40)),
                    Some(Health::Down) => ("\u{25CB}", egui::Color32::GRAY),
                    Some(Health::Missing(_)) => ("\u{25CC}", RED),
                    None => ("\u{25CB}", egui::Color32::DARK_GRAY),
                };
                ui.horizontal(|ui| {
                    ui.label(egui::RichText::new(dot).color(color));
                    let button = egui::Button::selectable(self.selected == model.id, model.label.as_str());
                    if ui.add_enabled(!busy, button).clicked() {
                        self.selected = model.id.clone();
                    }
                });
            }
            ui.add_space(4.0);
        }
        ui.separator();
        self.model_details(ui);
    }

    fn model_details(&mut self, ui: &mut egui::Ui) {
        let model = self.model();
        let ctx = ui.ctx().clone();
        let (health, loading_for, download) = {
            let shared = self.shared.lock().unwrap();
            (
                shared.health.get(&model.id).cloned(),
                shared.servers.get(&model.id).map(|p| p.started.elapsed()),
                shared.downloads.get(&model.id).copied(),
            )
        };
        let running = loading_for.is_some();
        ui.label(egui::RichText::new(&model.label).strong());
        egui::Grid::new("model_facts").num_columns(2).spacing([8.0, 2.0]).show(ui, |ui| {
            ui.label("endpoint");
            ui.monospace(model.base_url());
            ui.end_row();
            ui.label("served as");
            ui.monospace(&model.served_model);
            ui.end_row();
            ui.label("tool calls");
            ui.label(model.tools.as_str());
            ui.end_row();
            if let Some(vram) = model.vram_mib {
                ui.label("GPU lease");
                ui.label(format!("{vram} MiB"));
                ui.end_row();
            }
            ui.label("status");
            ui.label(match (&health, loading_for) {
                (Some(Health::Ready), _) => "ready".to_string(),
                (_, Some(elapsed)) => format!("queued or loading ({}s)", elapsed.as_secs()),
                (Some(h), None) => h.word().to_string(),
                (None, None) => "checking".to_string(),
            });
            ui.end_row();
        });
        if let Some(source) = &model.source {
            ui.label(egui::RichText::new(source).small().weak());
        }
        if let Some(notes) = &model.notes {
            ui.label(egui::RichText::new(notes).small());
        }
        if let Some(Health::Missing(paths)) = &health {
            for path in paths {
                ui.label(egui::RichText::new(format!("missing: {path}")).small().color(RED));
            }
        }
        ui.add_space(6.0);
        ui.horizontal(|ui| {
            let ready = health == Some(Health::Ready);
            let startable = health == Some(Health::Down) && !running && model.runtime != ServerKind::External;
            if ui.add_enabled(startable, egui::Button::new("Start")).clicked() {
                self.start_server(&model);
            }
            let stoppable = running || (ready && model.runtime == ServerKind::Squid5080);
            if ui.add_enabled(stoppable, egui::Button::new("Stop")).clicked() {
                self.stop_server(&model);
            }
            if !model.download.is_empty() && matches!(health, Some(Health::Missing(_))) {
                let gib = model.download.iter().map(|f| f.bytes).sum::<u64>() as f64 / (1u64 << 30) as f64;
                if ui.add_enabled(download.is_none(), egui::Button::new(format!("Download {gib:.1} GiB"))).clicked() {
                    self.download(&ctx, &model);
                }
            }
        });
        if let Some((done, total)) = download {
            ui.add(egui::ProgressBar::new(done as f32 / total.max(1) as f32).show_percentage());
        }
        if running {
            let log = state_dir().join("logs").join(format!("{}.log", model.id));
            ui.label(egui::RichText::new(format!("log: {}", log.display())).small().weak());
        }
    }

    fn transcript(&mut self, ui: &mut egui::Ui) {
        let conversation: Conversation = self.runtime.conversation();
        if conversation.is_empty() {
            ui.add_space(24.0);
            ui.vertical_centered(|ui| {
                ui.heading("BitAgent Desktop");
                ui.label("Deposit Bitcoin, try the starter TradeLayer strategy, or withdraw. Candidate-only: nothing is signed or sent from here.");
                ui.add_space(8.0);
                for example in [
                    "What is BitAgent and what can it do for me?",
                    "Help me set money limits for a 50,000 sat budget.",
                    "Start a practice run with a 20,000 sat deposit.",
                ] {
                    if ui.link(example).clicked() {
                        self.input = example.to_string();
                    }
                }
            });
            return;
        }
        let user_color = egui::Color32::from_rgb(70, 120, 200);
        let agent_color = egui::Color32::from_rgb(230, 140, 40);
        for message in conversation.iter().filter(|m| m.is_user_visible()) {
            let assistant = effective_role(message) == EffectiveRole::Assistant;
            for content in &message.content {
                match content {
                    MessageContent::Text(text) if !text.text.trim().is_empty() => {
                        let (who, color) = if assistant { ("BitAgent", agent_color) } else { ("You", user_color) };
                        ui.label(egui::RichText::new(who).strong().color(color));
                        ui.label(text.text.as_str());
                        ui.add_space(6.0);
                    }
                    MessageContent::Thinking(thinking) if !thinking.thinking.trim().is_empty() => {
                        egui::CollapsingHeader::new(egui::RichText::new("thinking").small().weak())
                            .id_salt(format!("think-{}", message.id.clone().unwrap_or_default()))
                            .show(ui, |ui| {
                                ui.label(egui::RichText::new(truncate(&thinking.thinking, 4000)).small().weak());
                            });
                    }
                    MessageContent::ToolRequest(request) => {
                        let text = match &request.tool_call {
                            Ok(call) => format!(
                                "tool call  {}  {}",
                                call.name,
                                serde_json::to_string(&call.arguments.clone().unwrap_or_default()).unwrap_or_default()
                            ),
                            Err(error) => format!("tool call error: {}", error.message),
                        };
                        ui.label(egui::RichText::new(truncate(&text, 400)).monospace().small());
                    }
                    MessageContent::ToolResponse(response) => {
                        let ok = matches!(&response.tool_result, Ok(result) if result.is_error != Some(true));
                        let title = if ok { "tool result" } else { "tool result (error)" };
                        egui::CollapsingHeader::new(egui::RichText::new(title).monospace().small())
                            .id_salt(format!("result-{}", response.id))
                            .show(ui, |ui| {
                                ui.label(egui::RichText::new(truncate(&result_text(response), 4000)).monospace().small());
                            });
                        ui.add_space(4.0);
                    }
                    _ => {}
                }
            }
        }
        let ctx = ui.ctx().clone();
        let busy = self.shared.lock().unwrap().busy;
        for pending in pending_approvals(&conversation) {
            let mut answer = None;
            egui::Frame::group(ui.style()).show(ui, |ui| {
                ui.label(egui::RichText::new(format!("Approve {}?", pending.tool)).strong());
                if let Some(prompt) = &pending.prompt {
                    ui.label(prompt.as_str());
                }
                ui.label(egui::RichText::new(truncate(&pending.arguments.to_string(), 600)).monospace().small());
                ui.horizontal(|ui| {
                    if ui.add_enabled(!busy, egui::Button::new("Allow once")).clicked() {
                        answer = Some(true);
                    }
                    if ui.add_enabled(!busy, egui::Button::new("Deny")).clicked() {
                        answer = Some(false);
                    }
                });
            });
            if let Some(allow) = answer {
                let id = pending.id.clone();
                self.run_agent(&ctx, move |agent| agent.answer(&id, allow));
            }
        }
        if busy {
            ui.horizontal(|ui| {
                ui.spinner();
                ui.label(egui::RichText::new(format!("{} is working", self.model().label)).weak());
            });
        }
    }

    fn composer(&mut self, ui: &mut egui::Ui) {
        let ctx = ui.ctx().clone();
        let (busy, ready, tools_ready, error) = {
            let shared = self.shared.lock().unwrap();
            (shared.busy, shared.health.get(&self.selected) == Some(&Health::Ready), shared.tools.is_some(), shared.error.clone())
        };
        if let Some(error) = error {
            ui.label(egui::RichText::new(truncate(&error, 600)).color(RED).small());
        }
        ui.add(
            egui::TextEdit::multiline(&mut self.input)
                .desired_rows(3)
                .desired_width(f32::INFINITY)
                .hint_text("Ask BitAgent (Ctrl+Enter sends)"),
        );
        let send_key = ui.input(|i| i.key_pressed(egui::Key::Enter) && i.modifiers.command);
        ui.horizontal(|ui| {
            let can_send = !busy && ready && tools_ready && !self.input.trim().is_empty();
            let mut send = ui.add_enabled(can_send, egui::Button::new("Send"));
            if !ready {
                send = send.on_disabled_hover_text("Start the selected model first");
            } else if !tools_ready {
                send = send.on_disabled_hover_text("Waiting for BitAgent's tools");
            }
            if can_send && (send.clicked() || send_key) {
                let text = std::mem::take(&mut self.input);
                self.run_agent(&ctx, move |agent| agent.push_user(text.trim()));
            }
            if ui.add_enabled(busy, egui::Button::new("Stop")).clicked() {
                if let Some(cancel) = &self.cancel {
                    cancel.cancel();
                }
            }
            if ui.add_enabled(!busy, egui::Button::new("New chat")).clicked() {
                self.runtime = Runtime::new();
            }
            ui.separator();
            ui.label("tools:");
            let label = |policy: ApprovePolicy| match policy {
                ApprovePolicy::ReadOnly => "read-only run, others ask",
                ApprovePolicy::Ask => "every tool asks",
                ApprovePolicy::All => "every tool runs",
            };
            egui::ComboBox::from_id_salt("approve").selected_text(label(self.policy)).show_ui(ui, |ui| {
                for policy in [ApprovePolicy::ReadOnly, ApprovePolicy::Ask, ApprovePolicy::All] {
                    ui.selectable_value(&mut self.policy, policy, label(policy));
                }
            });
        });
    }
}

impl eframe::App for DesktopApp {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let active = {
            let shared = self.shared.lock().unwrap();
            shared.busy || !shared.servers.is_empty() || !shared.downloads.is_empty()
        };
        if active {
            ui.ctx().request_repaint_after(Duration::from_millis(500));
        }
        egui::Panel::top("top").show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.heading("BitAgent Desktop");
                ui.label(egui::RichText::new(format!("Goose GDK app, {GDK}")).small().weak());
                ui.separator();
                let (tools, error) = {
                    let shared = self.shared.lock().unwrap();
                    (shared.tools.clone(), shared.mcp_error.clone())
                };
                match (tools, error) {
                    (Some(tools), _) => {
                        ui.label(format!("BitAgent tools: {} ({} read-only)", tools.tools.len(), tools.read_only.len()));
                    }
                    (None, Some(error)) => {
                        ui.label(egui::RichText::new("BitAgent tools failed to start").color(RED)).on_hover_text(error);
                    }
                    (None, None) => {
                        ui.spinner();
                        ui.label("connecting BitAgent tools");
                    }
                }
                let url = self.catalog.bitagent.web_url.clone();
                if ui.button("Open BitAgent web").on_hover_text(url.as_str()).clicked() {
                    ui.ctx().open_url(egui::OpenUrl::new_tab(url));
                }
            });
        });
        egui::Panel::left("models").resizable(true).default_size(300.0).show(ui, |ui| {
            egui::ScrollArea::vertical().show(ui, |ui| self.models_panel(ui));
        });
        egui::Panel::bottom("composer").show(ui, |ui| {
            ui.add_space(4.0);
            self.composer(ui);
            ui.add_space(4.0);
        });
        egui::CentralPanel::default().show(ui, |ui| {
            egui::ScrollArea::vertical()
                .auto_shrink([false, false])
                .stick_to_bottom(true)
                .show(ui, |ui| self.transcript(ui));
        });
    }
}

impl Drop for DesktopApp {
    fn drop(&mut self) {
        if let Some(cancel) = &self.cancel {
            cancel.cancel();
        }
        let servers: Vec<ServerProcess> = self.shared.lock().unwrap().servers.drain().map(|(_, process)| process).collect();
        for process in servers {
            if let Some(model) = self.catalog.model(&process.model_id).cloned() {
                let _ = models::stop(&self.catalog, &model, Some(process));
            }
        }
    }
}

fn main() -> Result<()> {
    let mut config = None;
    let mut args = std::env::args().skip(1);
    while let Some(flag) = args.next() {
        if flag == "--config" {
            config = args.next();
        }
    }
    let catalog = Catalog::load(config.as_deref())?;
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title("BitAgent Desktop")
            .with_inner_size([1180.0, 780.0])
            .with_min_inner_size([760.0, 480.0]),
        ..Default::default()
    };
    eframe::run_native(
        "BitAgent Desktop",
        options,
        Box::new(move |cc| {
            let app = DesktopApp::new(cc, catalog).map_err(|error| error.to_string())?;
            Ok(Box::new(app) as Box<dyn eframe::App>)
        }),
    )
    .map_err(|error| anyhow!("{error}"))
}
