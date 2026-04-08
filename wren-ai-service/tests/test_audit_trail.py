"""Smoke tests for src.audit_trail (Wave 4 P1)."""

from __future__ import annotations

import json

from src.audit_trail import AuditEntry, AuditTrail, SCHEMA_VERSION


def test_disabled_by_default():
    trail = AuditTrail()
    trail.disable()
    assert trail.record(AuditEntry(query_id="q1", prompt="p", model="m")) is False
    assert trail.all() == []


def test_record_and_get_when_enabled():
    trail = AuditTrail()
    trail.enable()
    entry = AuditEntry(
        query_id="q1",
        prompt="select all",
        model="gpt-4",
        schema_objects=["customers"],
        validation_steps=["sql-syntax"],
        final_sql="SELECT * FROM customers",
    )
    assert trail.record(entry) is True
    assert trail.get("q1") is entry
    assert trail.get("missing") is None


def test_serialises_to_json():
    trail = AuditTrail()
    trail.enable()
    trail.record(AuditEntry(query_id="q1", prompt="p", model="m"))
    payload = json.loads(trail.to_json())
    assert payload["schema_version"] == SCHEMA_VERSION
    assert len(payload["entries"]) == 1
    assert payload["entries"][0]["query_id"] == "q1"
