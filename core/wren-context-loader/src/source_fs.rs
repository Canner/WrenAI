//! Native source-tree access rooted in opened directory file descriptors.
//!
//! On Unix, source directories are opened with `openat(..., O_DIRECTORY | O_NOFOLLOW)` from an
//! already-open parent. This closes the validate-then-reopen race for directory traversal while
//! retaining existing support for a final file symlink to a regular file. The project root is the
//! caller's trusted anchor; this module is not a general filesystem sandbox.

use std::ffi::{OsStr, OsString};
use std::fs::File;
use std::io::{self, Read};
use std::os::fd::OwnedFd;
use std::os::unix::ffi::OsStringExt;
use std::path::{Path, PathBuf};
#[cfg(test)]
use std::{cell::RefCell, thread_local};

use rustix::fs::{open, openat, statat, AtFlags, Dir, FileType, Mode, OFlags};

pub(crate) struct SourceDir {
    fd: OwnedFd,
    display: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EntryKind {
    Missing,
    Directory,
    Regular,
    Symlink,
    Other,
}

impl SourceDir {
    /// Open the caller-supplied project root. It is the trusted anchor for subsequent `openat`
    /// operations and may itself be a symlink, preserving the native API's existing behavior.
    pub(crate) fn open_root(path: &Path) -> io::Result<Self> {
        let fd = open(
            path,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC,
            Mode::empty(),
        )?;
        Ok(Self {
            fd,
            display: path.to_path_buf(),
        })
    }

    /// Open an immediate source child as a directory without resolving a symlink at that point.
    pub(crate) fn open_dir(&self, name: &OsStr) -> io::Result<Self> {
        let display = self.display.join(name);
        let fd = openat(
            &self.fd,
            name,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|error| directory_open_error(&display, error))?;
        let directory = Self { fd, display };
        #[cfg(test)]
        run_after_open_directory_hook();
        Ok(directory)
    }

    pub(crate) fn open_dir_if_exists(&self, name: &OsStr) -> io::Result<Option<Self>> {
        match self.entry_kind(name)? {
            EntryKind::Missing | EntryKind::Regular | EntryKind::Other => Ok(None),
            EntryKind::Directory => self.open_dir(name).map(Some),
            EntryKind::Symlink => Err(directory_symlink_error(&self.display.join(name))),
        }
    }

    /// Classify an immediate entry without resolving its final symlink component.
    pub(crate) fn entry_kind(&self, name: &OsStr) -> io::Result<EntryKind> {
        let stat = match statat(&self.fd, name, AtFlags::SYMLINK_NOFOLLOW) {
            Ok(stat) => stat,
            Err(error) if error == rustix::io::Errno::NOENT => return Ok(EntryKind::Missing),
            Err(error) => return Err(error.into()),
        };
        let file_type = FileType::from_raw_mode(stat.st_mode);
        Ok(if file_type.is_dir() {
            EntryKind::Directory
        } else if file_type.is_file() {
            EntryKind::Regular
        } else if file_type.is_symlink() {
            EntryKind::Symlink
        } else {
            EntryKind::Other
        })
    }

    /// Classify a nested source entry. A final symlink remains a valid file only when its opened
    /// target is regular; it is otherwise a refused traversal edge.
    pub(crate) fn open_nested_dir(&self, name: &OsStr) -> io::Result<Option<Self>> {
        match self.entry_kind(name)? {
            EntryKind::Directory => self.open_dir(name).map(Some),
            EntryKind::Symlink => {
                if self.final_is_regular_file(name)? {
                    Ok(None)
                } else {
                    Err(directory_symlink_error(&self.display.join(name)))
                }
            }
            EntryKind::Missing | EntryKind::Regular | EntryKind::Other => Ok(None),
        }
    }

    /// List entries from this already-open directory. Names are sorted byte-wise as Rust paths
    /// were before; callers decide which names are project inputs.
    pub(crate) fn names(&self) -> io::Result<Vec<OsString>> {
        let mut directory = Dir::read_from(&self.fd)?;
        let mut names = Vec::new();
        while let Some(entry) = directory.read() {
            let entry = entry?;
            let bytes = entry.file_name().to_bytes();
            if bytes == b"." || bytes == b".." {
                continue;
            }
            names.push(OsString::from_vec(bytes.to_vec()));
        }
        names.sort();
        Ok(names)
    }

    /// Read one final file from this directory. Its final component intentionally follows a
    /// symlink, matching the established supported-file-symlink contract.
    pub(crate) fn read_bytes_if_file(&self, name: &OsStr) -> io::Result<Option<Vec<u8>>> {
        let fd = openat(
            &self.fd,
            name,
            OFlags::RDONLY | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map(Some)
        .or_else(|error| {
            if error.kind() == io::ErrorKind::NotFound {
                Ok(None)
            } else {
                Err(error)
            }
        })?;
        let Some(fd) = fd else {
            return Ok(None);
        };
        let mut file = File::from(fd);
        if !file.metadata()?.is_file() {
            return Ok(None);
        }
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)?;
        Ok(Some(bytes))
    }

    fn final_is_regular_file(&self, name: &OsStr) -> io::Result<bool> {
        let fd = match openat(
            &self.fd,
            name,
            OFlags::RDONLY | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        ) {
            Ok(fd) => fd,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error.into()),
        };
        Ok(File::from(fd).metadata()?.is_file())
    }

    pub(crate) fn read_string_if_file(&self, name: &OsStr) -> io::Result<Option<String>> {
        self.read_bytes_if_file(name).and_then(|bytes| {
            bytes
                .map(|bytes| String::from_utf8(bytes).map_err(io::Error::other))
                .transpose()
        })
    }
}

#[cfg(test)]
type OpenDirectoryHook = (usize, Box<dyn FnOnce()>);

#[cfg(test)]
thread_local! {
    static AFTER_OPEN_DIRECTORY: RefCell<Option<OpenDirectoryHook>> = RefCell::new(None);
    static OPEN_DIRECTORY_COUNT: RefCell<usize> = const { RefCell::new(0) };
}

#[cfg(test)]
pub(crate) fn set_after_open_directory_hook(hook: impl FnOnce() + 'static) {
    set_after_nth_open_directory_hook(1, hook);
}

#[cfg(test)]
pub(crate) fn set_after_nth_open_directory_hook(nth: usize, hook: impl FnOnce() + 'static) {
    OPEN_DIRECTORY_COUNT.with(|count| *count.borrow_mut() = 0);
    AFTER_OPEN_DIRECTORY.with(|slot| *slot.borrow_mut() = Some((nth, Box::new(hook))));
}

#[cfg(test)]
fn run_after_open_directory_hook() {
    let count = OPEN_DIRECTORY_COUNT.with(|count| {
        let mut count = count.borrow_mut();
        *count += 1;
        *count
    });
    AFTER_OPEN_DIRECTORY.with(|slot| {
        let should_run = slot.borrow().as_ref().is_some_and(|(nth, _)| *nth == count);
        if should_run {
            if let Some((_, hook)) = slot.borrow_mut().take() {
                hook();
            }
        }
    });
}

fn directory_open_error(path: &Path, error: rustix::io::Errno) -> io::Error {
    // `O_NOFOLLOW` reports a symlink as ELOOP. Keep the established diagnostic string for callers
    // and tests, while all other errors retain their normal kind and message.
    if matches!(
        error.raw_os_error(),
        code if code == rustix::io::Errno::LOOP.raw_os_error()
            || code == rustix::io::Errno::NOTDIR.raw_os_error()
    ) {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("directory_symlink_unsupported: {}", path.display()),
        )
    } else {
        error.into()
    }
}

fn directory_symlink_error(path: &Path) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidInput,
        format!("directory_symlink_unsupported: {}", path.display()),
    )
}
