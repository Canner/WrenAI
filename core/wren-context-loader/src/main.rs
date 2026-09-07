//! Render a wren project as a Warble prepared-context document.
//!
//! ```text
//! wren-context-loader <project-dir> [-o <out.json>]
//! ```
//!
//! Writes to stdout when `-o` is omitted. A host runs this before `warble compile` and binds the
//! output with `kind: prepared`, which is how a Warble profile binds a wren project without Warble
//! itself depending on Wren.
//!
//! **An unreadable project is still a document.** Failing to assemble the MDL is a fact *about the
//! project* that Warble's `mdl_parseable` precondition exists to report, so it is written as
//! `parseable: false` with the assembly error attached. Only a genuinely unusable invocation — a
//! path that is not a directory, an unwritable output file — exits non-zero.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use wren_context_loader::{prepared_document, read_project_dir, MdlContext};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (project_dir, out_path) = match parse_args(&args) {
        Ok(parsed) => parsed,
        Err(message) => {
            eprintln!("{message}");
            eprintln!("usage: wren-context-loader <project-dir> [-o <out.json>]");
            return ExitCode::from(2);
        }
    };

    let context = match load(&project_dir) {
        Ok(context) => context,
        Err(message) => {
            eprintln!("{message}");
            return ExitCode::from(1);
        }
    };

    let document = match prepared_document(&context) {
        Ok(document) => document,
        Err(e) => {
            eprintln!("failed to serialize the context projection: {e}");
            return ExitCode::from(1);
        }
    };

    match out_path {
        Some(path) => {
            if let Err(e) = std::fs::write(&path, document) {
                eprintln!("failed to write {}: {e}", path.display());
                return ExitCode::from(1);
            }
        }
        None => println!("{document}"),
    }
    ExitCode::SUCCESS
}

fn parse_args(args: &[String]) -> Result<(PathBuf, Option<PathBuf>), String> {
    let mut project_dir: Option<PathBuf> = None;
    let mut out_path: Option<PathBuf> = None;
    let mut rest = args.iter();
    while let Some(arg) = rest.next() {
        match arg.as_str() {
            "-o" | "--out" => {
                let value = rest.next().ok_or_else(|| format!("{arg} needs a path"))?;
                out_path = Some(PathBuf::from(value));
            }
            other if other.starts_with('-') => return Err(format!("unknown flag '{other}'")),
            other => {
                if project_dir.is_some() {
                    return Err(format!("unexpected second project directory '{other}'"));
                }
                project_dir = Some(PathBuf::from(other));
            }
        }
    }
    let project_dir = project_dir.ok_or_else(|| "a project directory is required".to_string())?;
    Ok((project_dir, out_path))
}

/// Read and assemble the project, turning an assembly failure into an unparseable context rather
/// than an error: that distinction is what `mdl_parseable` reports downstream.
fn load(project_dir: &Path) -> Result<MdlContext, String> {
    if !project_dir.is_dir() {
        return Err(format!("{} is not a directory", project_dir.display()));
    }
    let sources = read_project_dir(project_dir)
        .map_err(|e| format!("failed to read {}: {e}", project_dir.display()))?;
    let Some(sources) = sources else {
        // No `wren_project.yml`: not a wren project at all. Still a document — a profile bound
        // here must fail its `mdl_parseable` precondition, not fail to compile.
        return Ok(MdlContext::unparseable_with_error(Some(format!(
            "{} holds no wren_project.yml",
            project_dir.display()
        ))));
    };
    Ok(match MdlContext::try_from_sources(&sources) {
        Ok(context) => context,
        Err(e) => MdlContext::unparseable_with_error(Some(e.to_string())),
    })
}
