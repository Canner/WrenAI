"""The project digest keeps its framing while hashing sources in bounded chunks."""

import hashlib
import os
import shutil
import stat
from pathlib import Path

import pytest

from wren import project_fingerprint as fingerprint

pytestmark = pytest.mark.unit

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "declared_defaults"
# Computed by the whole-file implementation this chunked one replaced.
FIXTURE_DIGEST = "78db6b36a8f6c256bfc2653d407c52f18be652915e13fcffa554bf4a9ad209de"


def reference_digest(root: Path, names: list[str]) -> str:
    digest = hashlib.sha256()
    for name in sorted(names, key=str.encode):
        data = (root / name).read_bytes()
        digest.update(name.encode() + b"\0" + str(len(data)).encode() + b"\0" + data)
    return digest.hexdigest()


@pytest.mark.parametrize(
    "compute", [fingerprint.project_digest, fingerprint._path_digest]
)
def test_the_fixture_digest_is_unchanged(compute):
    assert compute(FIXTURE) == FIXTURE_DIGEST


@pytest.mark.parametrize(
    "compute", [fingerprint.project_digest, fingerprint._path_digest]
)
def test_a_source_larger_than_one_chunk_keeps_the_framing(tmp_path, compute):
    root = tmp_path / "project"
    (root / "knowledge").mkdir(parents=True)
    (root / "wren_project.yml").write_text("name: big\n")
    big = bytes(range(256)) * (fingerprint._READ_CHUNK_BYTES * 5 // 512)
    (root / "knowledge" / "big.md").write_bytes(big)
    (root / "knowledge" / "empty.md").write_bytes(b"")
    names = ["wren_project.yml", "knowledge/big.md", "knowledge/empty.md"]
    assert len(big) > 2 * fingerprint._READ_CHUNK_BYTES
    assert compute(root) == reference_digest(root, names)


@pytest.mark.parametrize("delta", [-1, 1])
def test_a_source_whose_length_changes_during_the_read_is_refused(
    tmp_path, monkeypatch, delta
):
    root = tmp_path / "project"
    shutil.copytree(FIXTURE, root)
    real = fingerprint.os.fstat

    def moving(fd):
        result = real(fd)
        if stat.S_ISREG(result.st_mode) and result.st_size:
            return os.stat_result((*result[:6], result.st_size + delta, *result[7:]))
        return result

    monkeypatch.setattr(fingerprint.os, "fstat", moving)
    with pytest.raises(OSError, match="source_changed_during_read"):
        fingerprint.project_digest(root)


def _length_moves(monkeypatch):
    real = fingerprint.os.fstat

    def moving(fd):
        result = real(fd)
        if stat.S_ISREG(result.st_mode) and result.st_size:
            return os.stat_result((*result[:6], result.st_size + 1, *result[7:]))
        return result

    monkeypatch.setattr(fingerprint.os, "fstat", moving)


def test_the_worker_reports_a_mid_read_change_as_a_change(tmp_path, monkeypatch):
    root = tmp_path / "project"
    shutil.copytree(FIXTURE, root)
    paths = [str(root / "wren_project.yml")]
    value, error = fingerprint.worker_frame(str(root), paths)
    assert error is None and len(value) == 64
    _length_moves(monkeypatch)
    assert fingerprint.worker_frame(str(root), paths) == (None, ("changed",))
    (root / "models").rename(root / "moved")
    (root / "models").symlink_to(root / "moved", target_is_directory=True)
    monkeypatch.undo()
    assert fingerprint.worker_frame(str(root), paths) == (None, ("filesystem",))


@pytest.mark.parametrize(
    "compute", [fingerprint.project_digest, fingerprint._path_digest]
)
def test_every_read_is_bounded_by_the_chunk_size(tmp_path, monkeypatch, compute):
    root = tmp_path / "project"
    (root / "knowledge").mkdir(parents=True)
    (root / "wren_project.yml").write_text("name: big\n")
    (root / "knowledge" / "big.md").write_bytes(
        b"x" * (3 * fingerprint._READ_CHUNK_BYTES + 7)
    )
    sizes = []
    real = fingerprint._hash_source

    class Recording:
        def __init__(self, stream):
            self.stream = stream

        def fileno(self):
            return self.stream.fileno()

        def read(self, size=-1):
            sizes.append(size)
            return self.stream.read(size)

    monkeypatch.setattr(
        fingerprint,
        "_hash_source",
        lambda stream, name, digest: real(Recording(stream), name, digest),
    )
    compute(root)
    assert len(sizes) >= 4
    assert all(0 < size <= fingerprint._READ_CHUNK_BYTES for size in sizes)
