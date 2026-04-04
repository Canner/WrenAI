from src.core.trace_compare import build_shadow_compare, summarize_ask_result


def test_summarize_ask_result_extracts_text_to_sql_and_skill_fields():
    summary = summarize_ask_result(
        {
            "metadata": {
                "type": "TEXT_TO_SQL",
                "ask_path": "nl2sql",
                "error_type": "",
                "fallback_reason": "runtime_identity_missing",
                "resolved_runtime": "legacy",
                "ask_runtime_mode": "deepagents",
            },
            "ask_result": [
                {"sql": "SELECT 1"},
                {"sql": "SELECT 2"},
            ],
            "skill_result": {
                "result_type": "text",
                "text": "should still be readable",
            },
        }
    )

    assert summary == {
        "type": "TEXT_TO_SQL",
        "ask_path": "nl2sql",
        "error_type": "",
        "fallback_reason": "runtime_identity_missing",
        "resolved_runtime": "legacy",
        "ask_runtime_mode": "deepagents",
        "sql": "SELECT 1",
        "result_count": 2,
        "skill_result_type": "text",
        "skill_text": "should still be readable",
    }


def test_build_shadow_compare_marks_text_to_sql_match_only_when_sql_and_counts_align():
    comparison = build_shadow_compare(
        enabled=True,
        executed=True,
        primary_result={
            "metadata": {
                "type": "TEXT_TO_SQL",
                "ask_path": "nl2sql",
                "error_type": "",
            },
            "ask_result": [{"sql": "SELECT 1"}],
        },
        shadow_result={
            "metadata": {
                "type": "TEXT_TO_SQL",
                "ask_path": "correction",
                "error_type": "",
            },
            "ask_result": [{"sql": "SELECT 1"}],
        },
    )

    assert comparison["comparable"] is True
    assert comparison["matched"] is True
    assert comparison["primary_sql"] == "SELECT 1"
    assert comparison["shadow_sql"] == "SELECT 1"
    assert comparison["primary_result_count"] == 1
    assert comparison["shadow_result_count"] == 1
    assert comparison["reason"] is None


def test_build_shadow_compare_detects_skill_mismatch_by_result_payload():
    comparison = build_shadow_compare(
        enabled=True,
        executed=True,
        primary_result={
            "metadata": {
                "type": "SKILL",
                "ask_path": "skill",
            },
            "skill_result": {
                "result_type": "text",
                "text": "GMV 128 万",
            },
        },
        shadow_result={
            "metadata": {
                "type": "SKILL",
                "ask_path": "skill",
            },
            "skill_result": {
                "result_type": "text",
                "text": "GMV 256 万",
            },
        },
    )

    assert comparison["comparable"] is True
    assert comparison["matched"] is False
    assert comparison["primary_type"] == "SKILL"
    assert comparison["shadow_type"] == "SKILL"
    assert comparison["primary_ask_path"] == "skill"
    assert comparison["shadow_ask_path"] == "skill"


def test_build_shadow_compare_uses_primary_fallback_reason_when_shadow_not_executed():
    comparison = build_shadow_compare(
        enabled=True,
        executed=False,
        primary_result={
            "metadata": {
                "type": "TEXT_TO_SQL",
                "ask_path": "nl2sql",
                "fallback_reason": "primary_fallback",
            },
            "ask_result": [{"sql": "SELECT 1"}],
        },
    )

    assert comparison["executed"] is False
    assert comparison["comparable"] is False
    assert comparison["matched"] is False
    assert comparison["reason"] == "primary_fallback"
    assert comparison["shadow_type"] is None
    assert comparison["shadow_sql"] is None


def test_build_shadow_compare_forces_non_comparable_on_shadow_error_and_sets_reason():
    comparison = build_shadow_compare(
        enabled=True,
        executed=True,
        primary_result={
            "metadata": {
                "type": "GENERAL",
                "ask_path": "general",
            },
        },
        shadow_result={
            "metadata": {
                "type": "GENERAL",
                "ask_path": "general",
            },
        },
        shadow_error="legacy timeout",
    )

    assert comparison["comparable"] is False
    assert comparison["matched"] is False
    assert comparison["shadow_error"] == "legacy timeout"
    assert comparison["reason"] == "shadow_error"
