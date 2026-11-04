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
    capability_catalog, capture_project, catalog_document, prepared_document, MdlContext,
    ProjectSnapshot, ProjectSources,
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

    if !project_dir.is_dir() {
        eprintln!("{} is not a directory", project_dir.display());
        return ExitCode::from(1);
    }
    let snapshot = match capture_project(&project_dir) {
        Ok(snapshot) => snapshot,
        Err(error) => {
            eprintln!("failed to read {}: {error}", project_dir.display());
            return ExitCode::from(1);
        }
    };
    let context = load(&project_dir, snapshot.sources.as_ref());

    let catalog_document = match catalog_path.as_ref() {
        Some(_) => match catalog_from_snapshot(&snapshot) {
            Ok(document) => Some(document),
            Err(message) => {
                eprintln!("{message}");
                return ExitCode::from(1);
            }
        },
        None => None,
    };

    let document = match prepared_document(&context) {
        Ok(document) => document,
        Err(e) => {
            eprintln!("failed to serialize the context projection: {e}");
            return ExitCode::from(1);
        }
    };

    match wren_context_loader::project_digest(&project_dir) {
        Ok(digest) if digest == snapshot.digest => {}
        Ok(_) => {
            eprintln!("project changed while preparing context; retry the invocation");
            return ExitCode::from(1);
        }
        Err(error) => {
            eprintln!("failed to digest {}: {error}", project_dir.display());
            return ExitCode::from(1);
        }
    }

    if let Some(catalog_path) = catalog_path {
        if let Err(e) = std::fs::write(&catalog_path, catalog_document.expect("catalog requested"))
        {
            eprintln!("failed to write {}: {e}", catalog_path.display());
            return ExitCode::from(1);
        }
    }

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
    let out_path = out_path.map(resolve_output_destination).transpose()?;
    let catalog_path = catalog_path.map(resolve_output_destination).transpose()?;

    for path in out_path.iter().chain(catalog_path.iter()) {
        if digest_covers_output(&project_dir, &path.logical)
            || digest_covers_output(&project_dir, &path.resolved)
            || output_aliases_digest_input(&project_dir, &path.resolved)?
        {
            return Err(format!(
                "output path {} is covered by the project digest",
                path.resolved.display()
            ));
        }
        validate_writable_output(&path.resolved)?;
    }

    if let Some((out, catalog)) = out_path.as_ref().zip(catalog_path.as_ref()) {
        if output_paths_match(&out.resolved, &catalog.resolved)? {
            return Err("-o and --catalog-out must name different files".to_string());
        }
    }
    Ok(())
}

struct OutputDestination {
    /// The fully resolved destination, used for identity comparison and final-file validation.
    resolved: PathBuf,
    /// The location reached after resolving the parent but before following a final file symlink.
    /// This preserves whether a write would replace a digest-covered source entry through a link.
    logical: PathBuf,
}

fn resolve_output_destination(path: &Path) -> Result<OutputDestination, String> {
    let resolved = resolve_output_path(path)?;
    let logical = match (path.parent(), path.file_name()) {
        (Some(parent), Some(name)) => resolve_output_path(parent)?.join(name),
        _ => resolved.clone(),
    };
    Ok(OutputDestination { resolved, logical })
}

fn validate_writable_output(path: &Path) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| {
        format!(
            "failed to resolve output path {}: no parent directory",
            path.display()
        )
    })?;
    let parent_metadata = std::fs::metadata(parent).map_err(|error| {
        format!(
            "failed to resolve output path {}: parent {}: {error}",
            path.display(),
            parent.display()
        )
    })?;
    if !parent_metadata.is_dir() {
        return Err(format!(
            "failed to resolve output path {}: parent {} is not a directory",
            path.display(),
            parent.display()
        ));
    }
    if let Some(metadata) = existing_output_metadata(path)? {
        if !metadata.is_file() {
            return Err(format!(
                "failed to resolve output path {}: destination is not a regular file",
                path.display()
            ));
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
                    Ok(metadata) => {
                        if !pending.is_empty() && !metadata.is_dir() {
                            return Err(format!(
                                "failed to resolve output path {}: {} is not a directory",
                                path.display(),
                                candidate.display()
                            ));
                        }
                        resolved.push(prefix);
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                        if pending.is_empty() {
                            return Ok(candidate);
                        }
                        return Err(format!(
                            "failed to resolve output path {}: missing path component {}",
                            path.display(),
                            candidate.display()
                        ));
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
                if !resolved.as_os_str().is_empty()
                    && !std::fs::metadata(&resolved)
                        .map_err(|error| {
                            format!(
                                "failed to resolve output path {}: {}",
                                path.display(),
                                error
                            )
                        })?
                        .is_dir()
                {
                    return Err(format!(
                        "failed to resolve output path {}: {} is not a directory",
                        path.display(),
                        resolved.display()
                    ));
                }
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

/// Compare resolved paths and, when both targets already exist, their filesystem identities so
/// hard links cannot be used to make the two writers overwrite one file.
fn output_paths_match(left: &Path, right: &Path) -> Result<bool, String> {
    if left == right {
        return Ok(true);
    }
    let left_metadata = existing_output_metadata(left)?;
    let right_metadata = existing_output_metadata(right)?;
    match (left_metadata, right_metadata) {
        (Some(left_metadata), Some(right_metadata)) => {
            same_file(left, &left_metadata, right, &right_metadata)
        }
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
fn same_file(
    _: &Path,
    left: &std::fs::Metadata,
    _: &Path,
    right: &std::fs::Metadata,
) -> Result<bool, String> {
    Ok(left.dev() == right.dev() && left.ino() == right.ino())
}

#[cfg(windows)]
fn same_file(
    left_path: &Path,
    _: &std::fs::Metadata,
    right_path: &Path,
    _: &std::fs::Metadata,
) -> Result<bool, String> {
    same_file::is_same_file(left_path, right_path).map_err(|error| {
        format!(
            "failed to compare output paths {} and {}: {error}",
            left_path.display(),
            right_path.display()
        )
    })
}

#[cfg(all(not(unix), not(windows)))]
fn same_file(
    _: &Path,
    _: &std::fs::Metadata,
    _: &Path,
    _: &std::fs::Metadata,
) -> Result<bool, String> {
    Ok(false)
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

/// Detect an output outside the project that is an existing hard link to a covered input. Path
/// checks alone cannot see that write target, but overwriting it would still mutate the source.
fn output_aliases_digest_input(project_dir: &Path, output: &Path) -> Result<bool, String> {
    let Some(output_metadata) = existing_output_metadata(output)? else {
        return Ok(false);
    };
    const ROOT_FILES: [&str; 5] = [
        "wren_project.yml",
        "relationships.yml",
        "cubes.yml",
        "dashboards.yml",
        "instructions.md",
    ];
    const SOURCE_DIRS: [&str; 4] = ["models", "cubes", "views", "knowledge"];

    for name in ROOT_FILES {
        let source = project_dir.join(name);
        if let Some(metadata) = existing_output_metadata(&source)? {
            if metadata.is_file() && same_file(output, &output_metadata, &source, &metadata)? {
                return Ok(true);
            }
        }
    }
    for name in SOURCE_DIRS {
        if source_directory_has_output_alias(&project_dir.join(name), output, &output_metadata)? {
            return Ok(true);
        }
    }
    Ok(false)
}

fn source_directory_has_output_alias(
    directory: &Path,
    output_path: &Path,
    output: &std::fs::Metadata,
) -> Result<bool, String> {
    let metadata = match std::fs::symlink_metadata(directory) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => {
            return Err(format!(
                "failed to inspect source directory {}: {error}",
                directory.display()
            ));
        }
    };
    if !metadata.file_type().is_dir() {
        return Ok(false);
    }
    for entry in std::fs::read_dir(directory).map_err(|error| {
        format!(
            "failed to inspect source directory {}: {error}",
            directory.display()
        )
    })? {
        let entry = entry.map_err(|error| {
            format!(
                "failed to inspect source directory {}: {error}",
                directory.display()
            )
        })?;
        let name = entry.file_name();
        if source_name_is_hidden(&name) {
            continue;
        }
        let path = entry.path();
        let entry_type = entry.file_type().map_err(|error| {
            format!("failed to inspect source entry {}: {error}", path.display())
        })?;
        if entry_type.is_dir() {
            if source_directory_has_output_alias(&path, output_path, output)? {
                return Ok(true);
            }
        } else if entry_type.is_file() || entry_type.is_symlink() {
            if let Some(metadata) = existing_output_metadata(&path)? {
                if metadata.is_file() && same_file(output_path, output, &path, &metadata)? {
                    return Ok(true);
                }
            }
        }
    }
    Ok(false)
}

fn source_name_is_hidden(name: &std::ffi::OsStr) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        name.as_bytes().first() == Some(&b'.')
    }
    #[cfg(not(unix))]
    {
        name.to_str().is_some_and(|name| name.starts_with('.'))
    }
}

/// Build the capability catalog from the same captured source bytes as the prepared document.
fn catalog_from_snapshot(snapshot: &ProjectSnapshot) -> Result<String, String> {
    let catalog = match &snapshot.sources {
        Some(sources) => capability_catalog(sources),
        None => capability_catalog(&ProjectSources {
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
    let catalog = catalog
        .with_knowledge_rules(snapshot.rules.clone())
        .with_digest(snapshot.digest.clone());
    catalog_document(&catalog)
        .map_err(|e| format!("failed to serialize the capability catalog: {e}"))
}

/// Read and assemble the project, turning an assembly failure into an unparseable context rather
/// than an error: that distinction is what `mdl_parseable` reports downstream.
fn load(project_dir: &Path, sources: Option<&ProjectSources>) -> MdlContext {
    let Some(sources) = sources else {
        // No `wren_project.yml`: not a wren project at all. Still a document — a profile bound
        // here must fail its `mdl_parseable` precondition, not fail to compile.
        return MdlContext::unparseable_with_error(Some(format!(
            "{} holds no wren_project.yml",
            project_dir.display()
        )));
    };
    match MdlContext::try_from_sources(sources) {
        Ok(context) => context,
        Err(e) => MdlContext::unparseable_with_error(Some(e.to_string())),
    }
}
