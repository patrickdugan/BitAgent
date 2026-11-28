//! YaRN-MCP, a Goose GDK app over a personal chat archive.
//!
//! The Python stdio server (`python/yarn_mcp`, stdlib only) indexes a ChatGPT or Claude data export
//! into SQLite (FTS5), computes themes, research threads and interconnections, and distills
//! long-context packets sized for YaRN-extended models. This crate is the goose-agent host: a state
//! machine that drives a local model through those tools, with GDK skills (`skills/*/SKILL.md`).

pub mod agent;
pub mod mcp;
pub mod skills;
pub mod text_tools;
