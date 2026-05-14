"""Tests for SDK-specific exception types."""

import pytest

from wren_pydantic.exceptions import (
    MemoryNotEnabledError,
    WrenToolkitInitError,
)


def test_wren_toolkit_init_error_carries_message():
    with pytest.raises(WrenToolkitInitError, match="missing target/mdl.json"):
        raise WrenToolkitInitError("missing target/mdl.json")


def test_memory_not_enabled_error_is_distinct_type():
    """MemoryNotEnabledError is its own class, not a generic ValueError."""
    err = MemoryNotEnabledError("memory provider not configured")
    assert isinstance(err, MemoryNotEnabledError)
    assert isinstance(err, Exception)
    assert "memory provider" in str(err)
