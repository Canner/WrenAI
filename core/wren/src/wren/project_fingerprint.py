"""Pure filesystem fingerprint algorithm and its fixed-purpose native worker.

Kept independent of the Wren package/SQL imports so the worker can be started
as this exact file. The native host alone supplies the captured root/path list.
"""

import hashlib
import pickle
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


def project_digest(root: Path) -> str:
    """The loader's ``digest``, computed in Python so a running service can detect change.

    Same definition as ``wren_context_loader::project_digest``: SHA-256 over, for each
    covered file in path order, ``<path> NUL <byte length> NUL <bytes>``. Covered files are
    the root files ``wren_project.yml``, ``relationships.yml``, ``cubes.yml``,
    ``dashboards.yml`` and ``instructions.md`` plus everything under ``models/``,
    ``cubes/``, ``views/`` and ``knowledge/``; ``target/``, data files and dotfiles are
    not covered. Source directories and nested directory symlinks (including
    unresolved links) are refused; file symlinks remain covered by their path and
    target bytes. ``load_snapshot`` asserts the two implementations agree.
    """
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
    for relative in sorted(files, key=lambda r: r.encode()):
        data = files[relative].read_bytes()
        digest.update(relative.encode() + b"\0" + str(len(data)).encode() + b"\0")
        digest.update(data)
    return digest.hexdigest()


def _collect(directory: Path, relative: str, files: dict[str, Path]) -> None:
    for entry in directory.iterdir():
        if entry.name.startswith("."):
            continue
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
