//! Reads a Wren MDL project into [`warble::ContextLoader`]'s projection.
//!
//! This crate is the Wren half of a deliberately one-directional relationship. Warble is a
//! context-neutral behavior framework: it declares *what* a data agent does and probes a bound
//! semantic layer through a narrow trait, without knowing any semantic format. Teaching it to read
//! MDL would put a Wren dependency inside the framework, so the adapter lives here instead —
//! Wren depends on Warble, never the reverse.
//!
//! Pipeline: read project files (host I/O) → [`assemble`] into a `wren-core-base` `Manifest` →
//! [`MdlContext::from_manifest`] projects it to Warble's Info types and builds the semantic
//! [`warble::LineageGraph`]. Parsing is pure and WASM-friendly (no DB, no async); query execution
//! never enters this layer.
//!
//! # Two ways to hand the result to Warble
//!
//! - **In-process**: [`MdlContext`] implements [`warble::ContextLoader`], so a host that links
//!   Warble as a library passes it straight to a `ContextResolver`.
//! - **Across a process boundary**: [`prepared_document`] renders the same projection as a
//!   prepared-context document, which `warble compile` reads via `kind: prepared`. This is the
//!   route for a host that drives the `warble` binary as a subprocess and therefore cannot hand
//!   over a Rust trait object.
//!
//! Both go through the same projection, so the two cannot disagree about what the project says.

mod consumers;
mod introspect;
mod lineage;
mod project;

pub use introspect::{infer_additivity, MdlContext};
pub use lineage::{cube_id, dashboard_id, dim_id, metric_id, model_id, query_id, rel_id, view_id};
pub use project::{assemble, KnowledgeRules, LoadError, LoadedProject, ProjectSources};
#[cfg(not(target_arch = "wasm32"))]
pub use project::{read_knowledge_rules, read_project_dir};

/// Render a project's Warble projection as a prepared-context document.
///
/// The serialization itself belongs to Warble ([`warble::prepared_document_from`]), so this crate
/// never hand-rolls the wire format and cannot drift from what `warble compile` reads.
pub fn prepared_document(context: &MdlContext) -> Result<String, serde_json::Error> {
    warble::prepared_document_from(context)
}
