//! A content digest of the project sources, so a host can tell that the project changed.
//!
//! The digest covers what the loader reads to describe the project: `wren_project.yml`,
//! `relationships.yml`, `cubes.yml`, `dashboards.yml`, the legacy root `instructions.md`, and every
//! file under `models/`, `cubes/`, `views/` and `knowledge/`. It does not cover `target/` (a build
//! product) or data files, and it skips dotfiles (editor and OS droppings never change what the
//! project says). Every reader that lists a source directory applies the same rule through
//! [`is_hidden`], so the digest, the catalog and the prepared document agree on which files are
//! inputs. Source-directory roots and nested directory/unresolved symlinks are refused by
//! both the digest and the project readers; file symlinks remain covered by their relative
//! path and target bytes.
//!
//! Framing: files are visited in path order (byte-wise order of the `/`-joined relative path), and
//! each contributes `<path> NUL <decimal byte length> NUL <bytes>`, so no two different projects
//! hash the same input. The result is lowercase hex SHA-256. This is a change detector, not a
//! database snapshot.

use std::io;
use std::path::Path;

#[cfg(not(unix))]
use std::fs;

use sha2::{Digest, Sha256};

const ROOT_FILES: [&str; 5] = [
    "wren_project.yml",
    "relationships.yml",
    "cubes.yml",
    "dashboards.yml",
    "instructions.md",
];
const SOURCE_DIRS: [&str; 4] = ["models", "cubes", "views", "knowledge"];

/// Whether a directory entry is ignored as a project input: a name that starts with `.`, such as
/// an editor swap file, `.DS_Store` or `.gitkeep`. Dot-named files and directories under
/// `models/`, `cubes/`, `views/` and `knowledge/` are not loader inputs: they are not in the
/// digest, the catalog or the prepared document. The one definition of the rule, shared by the
/// digest and by the readers in `project.rs`.
pub(crate) fn is_hidden(name: &std::ffi::OsStr) -> bool {
    name.to_string_lossy().starts_with('.')
}

/// The digest of the project in `dir`, as lowercase hex.
pub fn project_digest(dir: &Path) -> io::Result<String> {
    #[cfg(unix)]
    return project_digest_unix(&crate::source_fs::SourceDir::open_root(dir)?);
    #[cfg(not(unix))]
    let mut files: Vec<(String, std::path::PathBuf)> = Vec::new();
    #[cfg(not(unix))]
    {
        for name in ROOT_FILES {
            let path = dir.join(name);
            if path.is_file() {
                files.push((name.to_string(), path));
            }
        }
        files.extend(source_files(dir)?);
    }
    #[cfg(not(unix))]
    files.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));

    #[cfg(not(unix))]
    let mut hasher = Sha256::new();
    #[cfg(not(unix))]
    for (relative, bytes) in files {
        #[cfg(not(unix))]
        let bytes = fs::read(&bytes)?;
        hasher.update(relative.as_bytes());
        hasher.update([0]);
        hasher.update(bytes.len().to_string().as_bytes());
        hasher.update([0]);
        hasher.update(&bytes);
    }
    #[cfg(not(unix))]
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

#[cfg(unix)]
fn project_digest_unix(root: &crate::source_fs::SourceDir) -> io::Result<String> {
    let mut hasher = Sha256::new();
    let mut entries: Vec<(String, bool)> = ROOT_FILES
        .iter()
        .map(|name| (name.to_string(), false))
        .chain(SOURCE_DIRS.iter().map(|name| (format!("{name}/"), true)))
        .collect();
    entries.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    for (key, is_dir) in entries {
        let name = key.trim_end_matches('/');
        if is_dir {
            if let Some(child) = root.open_dir_if_exists(name.as_ref())? {
                hash_directory(&child, name, &mut hasher)?;
            }
        } else if let Some(file) = root.open_regular_file(name.as_ref())? {
            hash_file(&mut hasher, name, file)?;
        }
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

#[cfg(unix)]
fn hash_directory(
    dir: &crate::source_fs::SourceDir,
    prefix: &str,
    hasher: &mut Sha256,
) -> io::Result<()> {
    let mut entries = Vec::new();
    for name in dir.names()? {
        if is_hidden(&name) {
            continue;
        }
        let kind = dir.entry_kind(&name)?;
        let label = format!(
            "{}/{}{}",
            prefix,
            name.to_string_lossy(),
            if kind == crate::source_fs::EntryKind::Directory {
                "/"
            } else {
                ""
            }
        );
        entries.push((label, name, kind));
    }
    entries.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    for (label, name, kind) in entries {
        match kind {
            crate::source_fs::EntryKind::Directory => {
                hash_directory(&dir.open_dir(&name)?, label.trim_end_matches('/'), hasher)?
            }
            crate::source_fs::EntryKind::Regular | crate::source_fs::EntryKind::Symlink => {
                let Some(file) = dir.open_regular_file(&name)? else {
                    if kind == crate::source_fs::EntryKind::Symlink {
                        return Err(io::Error::new(
                            io::ErrorKind::InvalidInput,
                            "directory_symlink_unsupported",
                        ));
                    }
                    continue;
                };
                hash_file(hasher, &label, file)?;
            }
            _ => {}
        }
    }
    Ok(())
}

#[cfg(unix)]
fn hash_file(hasher: &mut Sha256, relative: &str, mut file: std::fs::File) -> io::Result<()> {
    use std::io::Read;
    let expected = file.metadata()?.len();
    hasher.update(relative.as_bytes());
    hasher.update([0]);
    hasher.update(expected.to_string().as_bytes());
    hasher.update([0]);
    let mut total = 0;
    let mut buf = [0; 8192];
    loop {
        let count = file.read(&mut buf)?;
        if count == 0 {
            break;
        }
        total += count as u64;
        hasher.update(&buf[..count]);
    }
    if total != expected {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("file changed while hashing: {relative}"),
        ));
    }
    Ok(())
}

/// Validate exactly the same covered directory tree before either reader uses it.
/// File symlinks stay supported; directory and unresolved symlinks fail closed.
pub(crate) fn validate_source_directories(dir: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        let root = crate::source_fs::SourceDir::open_root(dir)?;
        for name in SOURCE_DIRS {
            if let Some(source) = root.open_dir_if_exists(name.as_ref())? {
                validate_collect(&source)?;
            }
        }
        Ok(())
    }
    #[cfg(not(unix))]
    source_files(dir).map(|_| ())
}

#[cfg(unix)]
fn validate_collect(dir: &crate::source_fs::SourceDir) -> io::Result<()> {
    for name in dir.names()? {
        if is_hidden(&name) {
            continue;
        }
        match dir.entry_kind(&name)? {
            crate::source_fs::EntryKind::Directory => validate_collect(&dir.open_dir(&name)?)?,
            crate::source_fs::EntryKind::Symlink if !dir.final_is_regular_file(&name)? => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "directory_symlink_unsupported",
                ));
            }
            _ => {}
        }
    }
    Ok(())
}

#[cfg(not(unix))]
fn source_files(dir: &Path) -> io::Result<Vec<(String, std::path::PathBuf)>> {
    let mut files = Vec::new();
    for name in SOURCE_DIRS {
        let root = dir.join(name);
        if root.is_symlink() {
            return Err(directory_symlink_error(&root));
        }
        if root.is_dir() {
            collect(&root, name, &mut files)?;
        }
    }
    Ok(files)
}

#[cfg(not(unix))]
fn directory_symlink_error(path: &Path) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidInput,
        format!("directory_symlink_unsupported: {}", path.display()),
    )
}

#[cfg(not(unix))]
fn collect(
    dir: &Path,
    relative: &str,
    out: &mut Vec<(String, std::path::PathBuf)>,
) -> io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        if is_hidden(&entry.file_name()) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        let child = format!("{relative}/{name}");
        if path.is_symlink() && !path.is_file() {
            return Err(directory_symlink_error(&path));
        }
        if path.is_dir() {
            collect(&path, &child, out)?;
        } else if path.is_file() {
            out.push((child, path));
        }
    }
    Ok(())
}
