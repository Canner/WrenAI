from src.core.trace_compare import build_shadow_compare, summarize_ask_result


def test_summarize_ask_result_extracts_only_text_to_sql_summary_fields():
    summary = summarize_ask_result(
        {
            "metadata": {
                "type": "TEXT_TO_SQL",
                "ask_path": "nl2sql",
                "error_type": "",
                "fallback_reason": "deepagents_error",
                "resolved_runtime": "legacy",
                "ask_runtime_mode": "deepagents",
                "orchestrator": "legacy",
            },
            "ask_result": [
                {"sql": "SELECT 1"},
                {"sql": "SELECT 2"},
            ],
        }
    )

    assert summary == {
        "type": "TEXT_TO_SQL",
        "ask_path": "nl2sql",
        "error_type": "",
        "fallback_reason": "deepagents_error",
        "resolved_runtime": "legacy",
        "ask_runtime_mode": "deepagents",
        "orchestrator": "legacy",
        "sql": "SELECT 1",
        "result_count": 2,
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


def test_build_shadow_compare_marks_non_text_to_sql_results_as_non_comparable():
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
    )

    assert comparison["comparable"] is False
    assert comparison["matched"] is False
    assert comparison["primary_type"] == "GENERAL"
    assert comparison["shadow_type"] == "GENERAL"


def test_build_shadow_compare_uses_primary_fallback_reason_when_shadow_not_executed():
    comparison = build_shadow_compare(
        enabled=True,
        executed=False,
        primary_result={
            "metadata": {
                "type": "TEXT_TO_SQL",
                "ask_path": "nl2sql",
                "fallback_reason": "deepagents_error",
            },
            "ask_result": [{"sql": "SELECT 1"}],
        },
    )

    assert comparison["executed"] is False
    assert comparison["comparable"] is False
    assert comparison["matched"] is False
    assert comparison["reason"] == "deepagents_error"
    assert comparison["shadow_type"] is None
    assert comparison["shadow_sql"] is None


def test_build_shadow_compare_sets_shadow_error_reason_when_shadow_execution_fails():
    comparison = build_shadow_compare(
        enabled=True,
        executed=True,
        primary_result={
            "metadata": {
                "type": "TEXT_TO_SQL",
                "ask_path": "nl2sql",
            },
            "ask_result": [{"sql": "SELECT 1"}],
        },
        shadow_error="legacy timeout",
        reason="shadow_error",
    )

    assert comparison["comparable"] is False
    assert comparison["matched"] is False
    assert comparison["shadow_error"] == "legacy timeout"
    assert comparison["reason"] == "shadow_error"
