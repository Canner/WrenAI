//! Render a wren project as a Warble prepared-context document.
//!
//! ```text
//! wren-context-loader <project-dir> [-o <out.json>] [--catalog-out <catalog.json>]
//! ```
//!
//! Writes to stdout when `-o` is omitted. `--catalog-out` additionally writes the **capability
//! catalog** — the authored, descriptive, SQL-free slice of the project (see `catalog.rs`) — which a
//! host may render into a card for a planner outside the data zone. A host runs this before `warble compile` and binds the
//! output with `kind: prepared`, which is how a Warble profile binds a wren project without Warble
//! itself depending on Wren.
//!
//! **An unreadable project is still a document.** Failing to assemble the MDL is a fact *about the
//! project* that Warble's `mdl_parseable` precondition exists to report, so it is written as
//! `parseable: false` with the assembly error attached. Only a genuinely unusable invocation — a
//! path that is not a directory, an unwritable output file — exits non-zero.

use std::collections::VecDeque;
use std::path::{Component, Path, PathBuf};
use std::process::ExitCode;

#[cfg(unix)]
use std::os::unix::fs::MetadataExt;

use wren_context_loader::{
    capability_catalog, catalog_document, prepared_document, read_project_dir, MdlContext,
};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (project_dir, out_path, catalog_path) = match parse_args(&args) {
        Ok(parsed) => parsed,
        Err(message) => {
            eprintln!("{message}");
            eprintln!(
                "usage: wren-context-loader <project-dir> [-o <out.json>] [--catalog-out <catalog.json>]"
            );
            return ExitCode::from(2);
        }
    };
    if let Err(message) =
        validate_output_paths(&project_dir, out_path.as_deref(), catalog_path.as_deref())
    {
        eprintln!("{message}");
        return ExitCode::from(2);
    }

    let context = match load(&project_dir) {
        Ok(context) => context,
        Err(message) => {
            eprintln!("{message}");
            return ExitCode::from(1);
        }
    };

    if let Some(catalog_path) = catalog_path {
        if let Err(message) = write_catalog(&project_dir, &catalog_path) {
            eprintln!("{message}");
            return ExitCode::from(1);
        }
    }

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

type ParsedArgs = (PathBuf, Option<PathBuf>, Option<PathBuf>);

fn parse_args(args: &[String]) -> Result<ParsedArgs, String> {
    let mut project_dir: Option<PathBuf> = None;
    let mut out_path: Option<PathBuf> = None;
    let mut catalog_path: Option<PathBuf> = None;
    let mut rest = args.iter();
    while let Some(arg) = rest.next() {
        match arg.as_str() {
            "-o" | "--out" => {
                let value = rest.next().ok_or_else(|| format!("{arg} needs a path"))?;
                out_path = Some(PathBuf::from(value));
            }
            "--catalog-out" => {
                let value = rest.next().ok_or_else(|| format!("{arg} needs a path"))?;
                catalog_path = Some(PathBuf::from(value));
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
    Ok((project_dir, out_path, catalog_path))
}

/// Validate every file destination before either writer runs. In particular, resolving an output
/// must not leave a second output to be written after the first destination proves unusable.
fn validate_output_paths(
    project_dir: &Path,
    out_path: Option<&Path>,
    catalog_path: Option<&Path>,
) -> Result<(), String> {
    let project_dir = resolve_output_path(project_dir)?;
    let out_path = out_path.map(resolve_output_path).transpose()?;
    let catalog_path = catalog_path.map(resolve_output_path).transpose()?;

    for path in out_path.iter().chain(catalog_path.iter()) {
        if digest_covers_output(&project_dir, path) {
            return Err(format!(
                "output path {} is covered by the project digest",
                path.display()
            ));
        }
    }

    if let Some((out, catalog)) = out_path.as_ref().zip(catalog_path.as_ref()) {
        if output_paths_match(out, catalog)? {
            return Err("-o and --catalog-out must name different files".to_string());
        }
    }
    Ok(())
}

/// Resolve lexical components and every existing symlink while permitting a missing final path.
/// A dangling link therefore resolves to its intended destination, but a loop is an invocation
/// error rather than evidence that two output paths differ.
fn resolve_output_path(path: &Path) -> Result<PathBuf, String> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|error| format!("failed to resolve output path {}: {error}", path.display()))?
            .join(path)
    };
    let mut pending = path_components(&absolute);
    let mut resolved = PathBuf::new();
    let mut followed_links = 0;

    while let Some(component) = pending.pop_front() {
        match component {
            OwnedComponent::Prefix(prefix) => resolved.push(prefix),
            OwnedComponent::Normal(prefix) => {
                let candidate = resolved.join(&prefix);
                match std::fs::symlink_metadata(&candidate) {
                    Ok(metadata) if metadata.file_type().is_symlink() => {
                        followed_links += 1;
                        if followed_links > 40 {
                            return Err(format!(
                                "failed to resolve output path {}: too many symbolic links",
                                path.display()
                            ));
                        }
                        let target = std::fs::read_link(&candidate).map_err(|error| {
                            format!("failed to resolve output path {}: {error}", path.display())
                        })?;
                        let mut target_components = path_components(&target);
                        if target.is_absolute() {
                            resolved = PathBuf::new();
                        }
                        target_components.extend(pending);
                        pending = target_components;
                    }
                    Ok(_) => resolved.push(prefix),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                        resolved.push(prefix);
                        append_lexical_components(&mut resolved, pending);
                        return Ok(resolved);
                    }
                    Err(error) => {
                        return Err(format!(
                            "failed to resolve output path {}: {error}",
                            path.display()
                        ));
                    }
                }
            }
            OwnedComponent::Root => resolved.push(std::path::MAIN_SEPARATOR_STR),
            OwnedComponent::Current => {}
            OwnedComponent::Parent => {
                resolved.pop();
            }
        }
    }
    Ok(resolved)
}

#[derive(Clone)]
enum OwnedComponent {
    Prefix(std::ffi::OsString),
    Root,
    Current,
    Parent,
    Normal(std::ffi::OsString),
}

fn path_components(path: &Path) -> VecDeque<OwnedComponent> {
    path.components()
        .map(|component| match component {
            Component::Prefix(prefix) => OwnedComponent::Prefix(prefix.as_os_str().to_owned()),
            Component::RootDir => OwnedComponent::Root,
            Component::CurDir => OwnedComponent::Current,
            Component::ParentDir => OwnedComponent::Parent,
            Component::Normal(name) => OwnedComponent::Normal(name.to_owned()),
        })
        .collect()
}

fn append_lexical_components(path: &mut PathBuf, components: VecDeque<OwnedComponent>) {
    for component in components {
        match component {
            OwnedComponent::Prefix(prefix) | OwnedComponent::Normal(prefix) => path.push(prefix),
            OwnedComponent::Root => path.push(std::path::MAIN_SEPARATOR_STR),
            OwnedComponent::Current => {}
            OwnedComponent::Parent => {
                path.pop();
            }
        }
    }
}

/// Compare resolved paths and, when both targets already exist, their filesystem identities so
/// hard links cannot be used to make the two writers overwrite one file.
fn output_paths_match(left: &Path, right: &Path) -> Result<bool, String> {
    if left == right {
        return Ok(true);
    }
    let left_metadata = existing_output_metadata(left)?;
    let right_metadata = existing_output_metadata(right)?;
    match (left_metadata, right_metadata) {
        (Some(left), Some(right)) => Ok(same_file(&left, &right)),
        _ => Ok(false),
    }
}

fn existing_output_metadata(path: &Path) -> Result<Option<std::fs::Metadata>, String> {
    match std::fs::metadata(path) {
        Ok(metadata) => Ok(Some(metadata)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!(
            "failed to resolve output path {}: {error}",
            path.display()
        )),
    }
}

#[cfg(unix)]
fn same_file(left: &std::fs::Metadata, right: &std::fs::Metadata) -> bool {
    left.dev() == right.dev() && left.ino() == right.ino()
}

#[cfg(not(unix))]
fn same_file(_: &std::fs::Metadata, _: &std::fs::Metadata) -> bool {
    false
}

/// Return whether writing `output` would add or replace an input covered by the project digest.
/// Ordinary project paths, such as `target/`, remain valid output locations.
fn digest_covers_output(project_dir: &Path, output: &Path) -> bool {
    const ROOT_FILES: [&str; 5] = [
        "wren_project.yml",
        "relationships.yml",
        "cubes.yml",
        "dashboards.yml",
        "instructions.md",
    ];
    const SOURCE_DIRS: [&str; 4] = ["models", "cubes", "views", "knowledge"];

    ROOT_FILES
        .iter()
        .any(|name| output == project_dir.join(name))
        || SOURCE_DIRS
            .iter()
            .any(|name| output.starts_with(project_dir.join(name)))
}

/// Write the capability catalog. A directory that is not a wren project yields an empty catalog
/// (no models), mirroring how the prepared document reports `parseable: false` rather than
/// failing: the host decides what an empty card means.
fn write_catalog(project_dir: &Path, catalog_path: &Path) -> Result<(), String> {
    let sources = read_project_dir(project_dir)
        .map_err(|e| format!("failed to read {}: {e}", project_dir.display()))?;
    let rules = wren_context_loader::read_knowledge_rules(project_dir).map_err(|e| {
        format!(
            "failed to read knowledge rules in {}: {e}",
            project_dir.display()
        )
    })?;
    let catalog = match &sources {
        Some(sources) => capability_catalog(sources),
        None => capability_catalog(&wren_context_loader::ProjectSources {
            wren_project_yml: String::new(),
            model_ymls: Vec::new(),
            relationships_yml: None,
            cubes_yml: None,
            cube_ymls: Vec::new(),
            views: Vec::new(),
            knowledge_sql_mds: Vec::new(),
            dashboards_yml: None,
        }),
    };
    let digest = wren_context_loader::project_digest(project_dir)
        .map_err(|e| format!("failed to digest {}: {e}", project_dir.display()))?;
    let catalog = catalog.with_knowledge_rules(rules).with_digest(digest);
    let document = catalog_document(&catalog)
        .map_err(|e| format!("failed to serialize the capability catalog: {e}"))?;
    std::fs::write(catalog_path, document)
        .map_err(|e| format!("failed to write {}: {e}", catalog_path.display()))
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
