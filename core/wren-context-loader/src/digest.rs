//! A content digest of the project sources, so a host can tell that the project changed.
//!
//! The digest covers what the loader reads to describe the project: `wren_project.yml`,
//! `relationships.yml`, `cubes.yml`, `dashboards.yml`, the legacy root `instructions.md`, and every
//! file under `models/`, `cubes/`, `views/` and `knowledge/`. It does not cover `target/` (a build
//! product) or data files, and it skips dotfiles (editor and OS droppings never change what the
//! project says).
//!
//! Framing: files are visited in path order (byte-wise order of the `/`-joined relative path), and
//! each contributes `<path> NUL <decimal byte length> NUL <bytes>`, so no two different projects
//! hash the same input. The result is lowercase hex SHA-256. This is a change detector, not a
//! database snapshot.

use std::fs;
use std::io;
use std::path::Path;

use sha2::{Digest, Sha256};

const ROOT_FILES: [&str; 5] = [
    "wren_project.yml",
    "relationships.yml",
    "cubes.yml",
    "dashboards.yml",
    "instructions.md",
];
const SOURCE_DIRS: [&str; 4] = ["models", "cubes", "views", "knowledge"];

/// The digest of the project in `dir`, as lowercase hex.
pub fn project_digest(dir: &Path) -> io::Result<String> {
    let mut files: Vec<(String, std::path::PathBuf)> = Vec::new();
    for name in ROOT_FILES {
        let path = dir.join(name);
        if path.is_file() {
            files.push((name.to_string(), path));
        }
    }
    for name in SOURCE_DIRS {
        let root = dir.join(name);
        if root.is_dir() {
            collect(&root, name, &mut files)?;
        }
    }
    files.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));

    let mut hasher = Sha256::new();
    for (relative, path) in files {
        let bytes = fs::read(&path)?;
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

fn collect(
    dir: &Path,
    relative: &str,
    out: &mut Vec<(String, std::path::PathBuf)>,
) -> io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        let child = format!("{relative}/{name}");
        if path.is_dir() {
            collect(&path, &child, out)?;
        } else if path.is_file() {
            out.push((child, path));
        }
    }
    Ok(())
}
