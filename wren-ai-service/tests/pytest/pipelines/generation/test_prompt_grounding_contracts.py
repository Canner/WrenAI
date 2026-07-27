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
    assert "Use `display_label` and `description` only to understand" in source
    assert "generated SQL must use that exact identifier" in source


def test_sql_correction_receives_raw_wren_engine_validation_error():
    source = _read_source("src/web/v1/services/ask.py")

    assert "_build_sql_correction_error" in source
    assert "Original Wren Engine validation error" in source
    assert "error_message" in source


def test_sql_correction_unknown_identifier_contract():
    source = _read_source("src/pipelines/generation/sql_correction.py")

    assert "If the error reports an unknown table or field" in source
    assert "replace it only with an exact executable identifier" in source
    assert "Do not retry the same unknown identifier" in source


def test_sql_post_processor_has_schema_identifier_guard():
    source = _read_source("src/pipelines/generation/utils/sql.py")

    assert "_validate_sql_against_schema_contexts" in source
    assert "SCHEMA_VALIDATION" in source
    assert "Unknown table identifiers" in source
    assert "Unknown column identifiers" in source
    assert "physical schema prefixes" in source


def test_generation_paths_pass_retrieved_schema_to_post_processor():
    for relative_path in [
        "src/pipelines/generation/sql_generation.py",
        "src/pipelines/generation/followup_sql_generation.py",
        "src/pipelines/generation/sql_correction.py",
    ]:
        source = _read_source(relative_path)
        assert "documents: list[str] | None = None" in source
        assert "schema_contexts=documents" in source


def test_table_description_retrieval_indexes_business_metadata():
    source = _read_source("src/pipelines/indexing/table_description.py")

    assert "display_label" in source
    assert "column_details" in source
    assert "clean_display_name" in source
    assert "description" in source
