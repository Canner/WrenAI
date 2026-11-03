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
    let mut files = source_files(&crate::source_fs::SourceDir::open_root(dir)?)?;
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
    files.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));

    let mut hasher = Sha256::new();
    for (relative, bytes) in files {
        #[cfg(not(unix))]
        let bytes = fs::read(&bytes)?;
        hasher.update(relative.as_bytes());
        hasher.update([0]);
        hasher.update(bytes.len().to_string().as_bytes());
        hasher.update([0]);
        hasher.update(&bytes);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

/// Validate exactly the same covered directory tree before either reader uses it.
/// File symlinks stay supported; directory and unresolved symlinks fail closed.
pub(crate) fn validate_source_directories(dir: &Path) -> io::Result<()> {
    #[cfg(unix)]
    return source_files(&crate::source_fs::SourceDir::open_root(dir)?).map(|_| ());
    #[cfg(not(unix))]
    source_files(dir).map(|_| ())
}

#[cfg(unix)]
fn source_files(dir: &crate::source_fs::SourceDir) -> io::Result<Vec<(String, Vec<u8>)>> {
    let mut files = Vec::new();
    for name in ROOT_FILES {
        if let Some(bytes) = dir.read_bytes_if_file(name.as_ref())? {
            files.push((name.to_string(), bytes));
        }
    }
    for name in SOURCE_DIRS {
        if let Some(root) = dir.open_dir_if_exists(name.as_ref())? {
            collect(&root, name, &mut files)?;
        }
    }
    Ok(files)
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

#[cfg(unix)]
fn collect(
    dir: &crate::source_fs::SourceDir,
    relative: &str,
    out: &mut Vec<(String, Vec<u8>)>,
) -> io::Result<()> {
    for name in dir.names()? {
        if is_hidden(&name) {
            continue;
        }
        let child = format!("{relative}/{}", name.to_string_lossy());
        match dir.open_dir(&name) {
            Ok(child_dir) => collect(&child_dir, &child, out)?,
            Err(directory_error) => {
                if let Some(bytes) = dir.read_bytes_if_file(&name)? {
                    out.push((child, bytes));
                } else {
                    return Err(directory_error);
                }
            }
        }
    }
    Ok(())
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
