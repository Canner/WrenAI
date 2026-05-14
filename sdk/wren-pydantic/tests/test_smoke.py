"""Package skeleton smoke test — imports and exposes __version__."""

from __future__ import annotations


def test_package_imports():
    import wren_pydantic  # noqa: PLC0415

    assert wren_pydantic.__version__ == "0.1.0"
