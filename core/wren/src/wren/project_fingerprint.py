"""Pure filesystem fingerprint algorithm and its fixed-purpose native worker.

Kept independent of the Wren package/SQL imports so the worker can be started
as this exact file. The native host alone supplies the captured root/path list.
"""

import errno
import hashlib
import os
import pickle
import stat
import sys
from pathlib import Path

MAX_FRAME_BYTES = 131072

_DIGEST_ROOT_FILES = (
    "wren_project.yml",
    "relationships.yml",
    "cubes.yml",
    "dashboards.yml",
    "instructions.md",
)
_DIGEST_DIRS = ("models", "cubes", "views", "knowledge")


def is_project_source_path(root: Path, path: Path) -> bool:
    """Whether a resolved output sink overlaps the project's source namespace."""
    try:
        relative = path.resolve().relative_to(root.resolve())
    except ValueError:
        return False
    return relative.as_posix() in _DIGEST_ROOT_FILES or (
        bool(relative.parts) and relative.parts[0] in _DIGEST_DIRS
    )


def _source_name_bytes(name):
    try:
        return name.encode("utf-8")
    except UnicodeEncodeError:
        raise OSError("non_utf8_source_name") from None


def project_digest(root: Path) -> str:
    """The loader's ``digest``, computed in Python so a running service can detect change.

    Same definition as ``wren_context_loader::project_digest``: SHA-256 over, for each
    covered file in path order, ``<path> NUL <byte length> NUL <bytes>``. Covered files are
    the root files ``wren_project.yml``, ``relationships.yml``, ``cubes.yml``,
    ``dashboards.yml`` and ``instructions.md`` plus everything under ``models/``,
    ``cubes/``, ``views/`` and ``knowledge/``; ``target/``, data files and dotfiles are
    not covered. Source directories and nested directory symlinks (including
    unresolved links) are refused; file symlinks remain covered by their path and
    target bytes. On POSIX, captured directory descriptors and no-follow opens
    prevent directory replacements from redirecting subsequent traversal. The
    root is trusted, and regular-file symlink targets are intentionally followed.
    ``load_snapshot`` asserts the two implementations agree.
    """
    if os.name == "posix":
        return _descriptor_digest(root)
    return _path_digest(root)


def _descriptor_digest(root):
    # The root is the trusted anchor. Every directory below it is opened through
    # its captured parent, with no symlink following at the point of use.
    root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
    try:
        entries = []
        for name in (*_DIGEST_ROOT_FILES, *_DIGEST_DIRS):
            try:
                mode = os.stat(name, dir_fd=root_fd, follow_symlinks=False).st_mode
            except FileNotFoundError:
                continue
            directory = name in _DIGEST_DIRS
            if directory and stat.S_ISLNK(mode):
                raise OSError("directory_symlink_unsupported", name)
            if directory and not stat.S_ISDIR(mode):
                continue
            if not directory and not (stat.S_ISREG(mode) or stat.S_ISLNK(mode)):
                continue
            entries.append((name, directory, stat.S_ISLNK(mode)))
        digest = hashlib.sha256()
        _hash_entries(root_fd, "", entries, digest)
        return digest.hexdigest()
    finally:
        os.close(root_fd)


def _hash_entries(parent_fd, prefix, entries, digest):
    # A file named a.yml sorts before directory a/'s children. Sort by complete
    # path prefixes (including the directory slash), preserving the old framing.
    for name, directory, symlink in sorted(
        entries, key=lambda item: _source_name_bytes(item[0] + ("/" if item[1] else ""))
    ):
        relative = prefix + name
        if directory:
            try:
                child_fd = os.open(
                    name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd
                )
            except OSError as error:
                if error.errno in (errno.ELOOP, errno.ENOTDIR):
                    raise OSError("directory_symlink_unsupported", relative) from None
                raise
            try:
                children = []
                for child in os.listdir(child_fd):
                    if child.startswith("."):
                        continue
                    _source_name_bytes(child)
                    mode = os.stat(
                        child, dir_fd=child_fd, follow_symlinks=False
                    ).st_mode
                    if stat.S_ISDIR(mode) or stat.S_ISREG(mode) or stat.S_ISLNK(mode):
                        children.append((child, stat.S_ISDIR(mode), stat.S_ISLNK(mode)))
                _hash_entries(child_fd, relative + "/", children, digest)
            finally:
                os.close(child_fd)
        else:
            try:
                fd = os.open(name, os.O_RDONLY | os.O_NONBLOCK, dir_fd=parent_fd)
            except OSError:
                if symlink:
                    raise OSError("directory_symlink_unsupported", relative) from None
                raise
            try:
                if not stat.S_ISREG(os.fstat(fd).st_mode):
                    raise OSError("directory_symlink_unsupported", relative)
                with os.fdopen(fd, "rb", closefd=False) as stream:
                    data = stream.read()
            finally:
                os.close(fd)
            digest.update(
                _source_name_bytes(relative) + b"\0" + str(len(data)).encode() + b"\0"
            )
            digest.update(data)


def _path_digest(root):
    """Compatibility path for platforms without the controlled POSIX service."""
    files: dict[str, Path] = {}
    for name in _DIGEST_ROOT_FILES:
        if (root / name).is_file():
            files[name] = root / name
    for name in _DIGEST_DIRS:
        base = root / name
        if base.is_symlink():
            raise OSError("directory_symlink_unsupported", str(base))
        if base.is_dir():
            _collect(base, name, files)
    digest = hashlib.sha256()
    for relative in sorted(files, key=_source_name_bytes):
        data = files[relative].read_bytes()
        digest.update(relative.encode() + b"\0" + str(len(data)).encode() + b"\0")
        digest.update(data)
    return digest.hexdigest()


def _collect(directory: Path, relative: str, files: dict[str, Path]) -> None:
    for entry in directory.iterdir():
        if entry.name.startswith("."):
            continue
        _source_name_bytes(entry.name)
        child = f"{relative}/{entry.name}"
        if entry.is_symlink() and not entry.is_file():
            raise OSError("directory_symlink_unsupported", str(entry))
        if entry.is_dir():
            _collect(entry, child, files)
        elif entry.is_file():
            files[child] = entry


def fingerprint_sources(root, paths):
    root = Path(root)
    digest = hashlib.sha256()
    digest.update(b"project\0" + project_digest(root).encode() + b"\0")
    for item in paths:
        path = Path(item)
        data = path.read_bytes()
        digest.update(str(path).encode() + b"\0")
        digest.update(str(len(data)).encode() + b"\0" + data)
    return digest.hexdigest()


def write_frame(value, error):
    payload = pickle.dumps((value, error))
    if len(payload) > MAX_FRAME_BYTES:
        payload = pickle.dumps((None, ("result", "result_limit")))
    sys.stdout.buffer.write(len(payload).to_bytes(8, "big"))
    sys.stdout.buffer.write(payload)
    sys.stdout.buffer.flush()


if __name__ == "__main__":
    try:
        root, paths = pickle.loads(sys.stdin.buffer.read())
        result = fingerprint_sources(root, paths)
    except Exception:
        write_frame(None, ("filesystem",))
    else:
        write_frame(result, None)
