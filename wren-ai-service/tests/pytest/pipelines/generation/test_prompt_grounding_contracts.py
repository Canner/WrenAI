from pathlib import Path


SERVICE_ROOT = Path(__file__).resolve().parents[4]


def _read_source(relative_path: str) -> str:
    return (SERVICE_ROOT / relative_path).read_text(encoding="utf-8")


def test_intent_classification_does_not_require_exact_user_schema_names():
    source = _read_source("src/pipelines/generation/intent_classification.py")

    assert "schema-resolvable references" in source
    assert "even if the user did not type exact table or column names" in source
    assert "do not require the user to write exact schema identifiers" in source
    assert (
        "Do not classify a data retrieval or analytics question as MISLEADING only "
        "because the user did not write exact table or column names"
    ) in source


def test_data_assistance_does_not_invent_hypothetical_schema():
    source = _read_source("src/pipelines/generation/data_assistance.py")

    assert "MUST NOT add SQL code" in source
    assert "Use only the provided DATABASE SCHEMA as context" in source
    assert "Do not invent, assume, or name tables or columns" in source
    assert "do not provide hypothetical schema" in source


def test_sql_reasoning_contract_rejects_substitute_identifiers():
    source = _read_source("src/pipelines/generation/utils/sql.py")

    assert "If the DATABASE SCHEMA does not contain an identifier needed" in source
    assert "instead of naming a substitute table or column" in source
    assert "prompt examples" in source
    assert "Identifiers shown in prompt examples are illustrative only" in source
