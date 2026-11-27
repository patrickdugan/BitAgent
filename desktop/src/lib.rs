//! BitAgent Desktop: a Goose GDK app. A `goose-agent` state machine drives BitAgent's candidate-only
//! MCP tools with a local model (Inkling 2 Mini on the squid5080 runner, or a Ternary Bonsai GGUF on
//! PrismML's llama.cpp). `bitagent-desktop` is the window; `bitagent-cli` runs the same agent headless.

pub mod agent;
pub mod config;
pub mod mcp;
pub mod models;
pub mod text_tools;
