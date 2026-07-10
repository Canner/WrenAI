use datafusion::common::exec_datafusion_err;
use std::path::{Path, PathBuf};

pub fn read_dir_recursive<P: AsRef<Path>>(
    path: P,
) -> datafusion::common::Result<Vec<PathBuf>> {
    let mut dst = vec![];
    read_dir_recursive_impl(&mut dst, path.as_ref())?;
    Ok(dst)
}

/// Append all paths recursively to dst
fn read_dir_recursive_impl(
    dst: &mut Vec<PathBuf>,
    path: &Path,
) -> datafusion::common::Result<()> {
    let entries = std::fs::read_dir(path)
        .map_err(|e| exec_datafusion_err!("Error reading directory {path:?}: {e}"))?;
    for entry in entries {
        let path = entry
            .map_err(|e| {
                exec_datafusion_err!("Error reading entry in directory {path:?}: {e}")
            })?
            .path();

        if path.is_dir() {
            read_dir_recursive_impl(dst, &path)?;
        } else {
            dst.push(path);
        }
    }

    Ok(())
}
