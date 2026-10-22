"""Tests for Apache Ossie (formerly OSI) ⇄ Wren MDL conversion."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

from wren.cli import app
from wren.ossie import (
    _extract_wren_block,
    _is_calculated_expression,
    _ossie_datatype,
    _parse_join_condition,
    _parse_source,
    _pick_expression,
    _qualify_measure_expression,
    _source_from_model,
    build_json_from_ossie,
    build_manifest_from_ossie,
    dump_ossie,
    export_ossie_from_manifest,
    extract_wren_config,
    lint_ossie_file,
    parse_ossie,
    select_semantic_model,
)

# ── Fixtures ──────────────────────────────────────────────────────────────

FIXTURES = Path(__file__).parent.parent / "fixtures" / "ossie"


def _fixture(name: str) -> Path:
    return FIXTURES / name


# ── Unit: parse_ossie / select_semantic_model ───────────────────────────────


def test_parse_ossie_yaml():
    osi = parse_ossie('version: "0.2.0"\nsemantic_model: []\n')
    assert osi["version"] == "0.2.0"
    assert osi["semantic_model"] == []


def test_parse_ossie_json():
    osi = parse_ossie('{"version": "0.2.0", "semantic_model": []}', suffix=".json")
    assert osi["version"] == "0.2.0"


def test_select_semantic_model_single():
    osi = {"semantic_model": [{"name": "only"}]}
    sm, errs = select_semantic_model(osi)
    assert sm["name"] == "only"
    assert errs == []


def test_select_semantic_model_explicit_name():
    osi = {"semantic_model": [{"name": "a"}, {"name": "b"}]}
    sm, errs = select_semantic_model(osi, name="b")
    assert sm["name"] == "b"
    assert errs == []


def test_select_semantic_model_explicit_not_found():
    osi = {"semantic_model": [{"name": "a"}]}
    sm, errs = select_semantic_model(osi, name="missing")
    assert sm == {}
    assert errs and errs[0].level == "error"
    assert "missing" in errs[0].message


def test_select_semantic_model_root_default():
    osi = {
        "custom_extensions": [
            {
                "vendor_name": "WREN",
                "data": '{"default_semantic_model": "b"}',
            }
        ],
        "semantic_model": [{"name": "a"}, {"name": "b"}],
    }
    sm, errs = select_semantic_model(osi)
    assert sm["name"] == "b"
    assert errs == []


def test_select_semantic_model_ambiguous_errors_with_snippet():
    osi = {"semantic_model": [{"name": "a"}, {"name": "b"}]}
    sm, errs = select_semantic_model(osi)
    assert sm == {}
    assert errs and errs[0].level == "error"
    # Snippet must be copy-pasteable
    assert "custom_extensions:" in errs[0].message
    assert "vendor_name: WREN" in errs[0].message
    assert "default_semantic_model" in errs[0].message


def test_select_semantic_model_empty_file_errors():
    sm, errs = select_semantic_model({"semantic_model": []})
    assert sm == {}
    assert errs and errs[0].level == "error"


# ── Unit: WREN block extraction ───────────────────────────────────────────


def test_extract_wren_block_parses_json_string():
    ext = [
        {"vendor_name": "WREN", "data": '{"dialect": "SNOWFLAKE"}'},
        {"vendor_name": "DBT", "data": '{"foo": "bar"}'},
    ]
    out = _extract_wren_block(ext)
    assert out == {"dialect": "SNOWFLAKE"}


def test_extract_wren_block_tolerates_raw_dict():
    """Spec says `data` is a JSON string, but tolerate dict for hand-authored YAML."""
    ext = [{"vendor_name": "WREN", "data": {"dialect": "ANSI_SQL"}}]
    assert _extract_wren_block(ext) == {"dialect": "ANSI_SQL"}


def test_extract_wren_block_no_match_returns_empty():
    ext = [{"vendor_name": "DBT", "data": "{}"}]
    assert _extract_wren_block(ext) == {}


def test_extract_wren_block_last_wins_when_duplicated():
    ext = [
        {"vendor_name": "WREN", "data": '{"dialect": "ANSI_SQL"}'},
        {"vendor_name": "WREN", "data": '{"dialect": "SNOWFLAKE"}'},
    ]
    assert _extract_wren_block(ext)["dialect"] == "SNOWFLAKE"


def test_extract_wren_block_ignores_malformed_json():
    ext = [{"vendor_name": "WREN", "data": "{this is not json}"}]
    assert _extract_wren_block(ext) == {}


# ── Unit: extract_wren_config — precedence ────────────────────────────────


def test_extract_wren_config_sm_overrides_root():
    osi = {
        "custom_extensions": [
            {
                "vendor_name": "WREN",
                "data": '{"dialect": "ANSI_SQL", "metrics": "note"}',
            }
        ]
    }
    sm = {
        "custom_extensions": [
            {"vendor_name": "WREN", "data": '{"dialect": "SNOWFLAKE"}'}
        ]
    }
    cfg, errs = extract_wren_config(osi, sm)
    assert cfg.dialect == "SNOWFLAKE"
    assert cfg.metrics_mode == "note"  # inherited from root
    assert errs == []


def test_extract_wren_config_cli_overrides_sm():
    osi = {}
    sm = {"custom_extensions": [{"vendor_name": "WREN", "data": '{"metrics": "note"}'}]}
    cfg, _ = extract_wren_config(osi, sm, cli_overrides={"metrics": "skip"})
    assert cfg.metrics_mode == "skip"


def test_extract_wren_config_invalid_metrics_falls_back_with_warning():
    osi = {}
    sm = {
        "custom_extensions": [{"vendor_name": "WREN", "data": '{"metrics": "bogus"}'}]
    }
    cfg, errs = extract_wren_config(osi, sm)
    assert cfg.metrics_mode == "note"  # default
    assert any("bogus" in e.message for e in errs)


# ── Unit: _parse_source ───────────────────────────────────────────────────


def test_parse_source_three_parts():
    tref, sql = _parse_source("cat.sch.tbl")
    assert tref == {"catalog": "cat", "schema": "sch", "table": "tbl"}
    assert sql is None


def test_parse_source_two_parts():
    tref, sql = _parse_source("sch.tbl")
    assert tref == {"catalog": "", "schema": "sch", "table": "tbl"}
    assert sql is None


def test_parse_source_one_part():
    tref, sql = _parse_source("tbl")
    assert tref == {"catalog": "", "schema": "", "table": "tbl"}
    assert sql is None


def test_parse_source_inline_sql_with_select():
    tref, sql = _parse_source("SELECT * FROM x WHERE y = 1")
    assert tref is None
    assert sql == "SELECT * FROM x WHERE y = 1"


def test_parse_source_multiline_treated_as_sql():
    tref, sql = _parse_source("a.b.c\nSELECT 1")
    assert tref is None
    assert sql is not None and "SELECT 1" in sql


def test_parse_source_empty():
    assert _parse_source("") == (None, None)
    assert _parse_source(None) == (None, None)


# ── Unit: _pick_expression ────────────────────────────────────────────────


def test_pick_expression_prefers_named_dialect():
    expr = {
        "dialects": [
            {"dialect": "ANSI_SQL", "expression": "lower(x)"},
            {"dialect": "SNOWFLAKE", "expression": "LOWER(x)::VARCHAR"},
        ]
    }
    assert _pick_expression(expr, "SNOWFLAKE") == "LOWER(x)::VARCHAR"


def test_pick_expression_falls_back_to_ansi_sql():
    expr = {
        "dialects": [
            {"dialect": "ANSI_SQL", "expression": "x + 1"},
            {"dialect": "MDX", "expression": "[x] + 1"},
        ]
    }
    assert _pick_expression(expr, "SNOWFLAKE") == "x + 1"


def test_pick_expression_falls_back_to_first():
    expr = {"dialects": [{"dialect": "MDX", "expression": "[x]"}]}
    assert _pick_expression(expr, "SNOWFLAKE") == "[x]"


def test_pick_expression_skips_empty_preferred_and_uses_ansi():
    # An empty preferred-dialect expression must not shadow a real ANSI_SQL one.
    expr = {
        "dialects": [
            {"dialect": "SNOWFLAKE", "expression": ""},
            {"dialect": "ANSI_SQL", "expression": "SUM(x)"},
        ]
    }
    assert _pick_expression(expr, "SNOWFLAKE") == "SUM(x)"


def test_pick_expression_skips_empty_ansi_and_uses_first_nonempty():
    # Empty preferred AND empty ANSI_SQL must fall through to the next
    # non-empty expression rather than returning "".
    expr = {
        "dialects": [
            {"dialect": "SNOWFLAKE", "expression": ""},
            {"dialect": "ANSI_SQL", "expression": ""},
            {"dialect": "MDX", "expression": "[x]"},
        ]
    }
    assert _pick_expression(expr, "SNOWFLAKE") == "[x]"


def test_pick_expression_shorthand_string():
    assert _pick_expression("x", "ANSI_SQL") == "x"


def test_pick_expression_empty():
    assert _pick_expression({}, "ANSI_SQL") == ""
    assert _pick_expression(None, "ANSI_SQL") == ""


# ── Unit: _is_calculated_expression ───────────────────────────────────────


@pytest.mark.parametrize(
    "expr, fname, expected",
    [
        ("amount", "amount", False),  # bare identity
        ("Amount", "amount", True),  # different identifier — treat as calc
        ("amount * 1.1", "amount", True),  # arithmetic
        ("SUM(amount)", "amount", True),  # aggregation
        ("a || b", "concat", True),  # concat
        ("", "x", False),
    ],
)
def test_is_calculated_expression(expr, fname, expected):
    assert _is_calculated_expression(expr, fname) is expected


# ── Integration: build_manifest_from_ossie on minimal fixture ──────────────


def test_build_minimal_clean_no_warnings():
    """Minimal fixture has WREN column_types for every dataset — no warnings."""
    manifest, errors = build_manifest_from_ossie(
        _fixture("minimal.yaml"), data_source="postgres"
    )
    warnings = [e for e in errors if e.level == "warning"]
    assert errors == warnings, [str(e) for e in errors if e.level == "error"]
    # column_types covered every field, so no untyped warning
    assert not any("no type" in e.message for e in warnings)
    # single-dataset metrics don't fire cross-dataset warning
    assert not any("references 2 datasets" in e.message for e in warnings)


def test_build_minimal_structure():
    manifest, _ = build_manifest_from_ossie(
        _fixture("minimal.yaml"), data_source="postgres"
    )
    assert manifest["catalog"] == "wren"
    assert manifest["schema"] == "public"
    assert manifest["data_source"] == "postgres"
    assert len(manifest["models"]) == 2
    assert len(manifest["relationships"]) == 1

    orders = next(m for m in manifest["models"] if m["name"] == "orders")
    assert orders["table_reference"] == {
        "catalog": "shop",
        "schema": "public",
        "table": "orders",
    }
    assert orders["primary_key"] == "order_id"
    # PK column has is_primary_key + not_null
    pk_col = next(c for c in orders["columns"] if c["name"] == "order_id")
    assert pk_col["is_primary_key"] is True
    assert pk_col["not_null"] is True
    # Column types pulled from WREN block
    amount_col = next(c for c in orders["columns"] if c["name"] == "amount")
    assert amount_col["type"] == "DECIMAL(18,2)"


def test_build_minimal_calculated_field():
    """customer.full_name has a SQL expression and per-field WREN type override."""
    manifest, _ = build_manifest_from_ossie(
        _fixture("minimal.yaml"), data_source="postgres"
    )
    customers = next(m for m in manifest["models"] if m["name"] == "customers")
    full_name = next(c for c in customers["columns"] if c["name"] == "full_name")
    assert full_name["is_calculated"] is True
    assert "first_name" in full_name["expression"]
    assert full_name["type"] == "VARCHAR"  # from field-level WREN block


def test_build_minimal_relationship_condition():
    manifest, _ = build_manifest_from_ossie(
        _fixture("minimal.yaml"), data_source="postgres"
    )
    rel = manifest["relationships"][0]
    assert rel["name"] == "orders_to_customers"
    assert rel["join_type"] == "MANY_TO_ONE"
    assert rel["models"] == ["orders", "customers"]
    assert rel["condition"] == "orders.customer_id = customers.customer_id"


def test_build_minimal_instructions_include_metrics():
    manifest, _ = build_manifest_from_ossie(
        _fixture("minimal.yaml"), data_source="postgres"
    )
    instr = manifest.get("_instructions", "")
    assert "Shop analytics model" in instr  # from ai_context.instructions
    assert "total_revenue" in instr  # from metrics-as-notes


# ── Integration: build_json_from_ossie (camelCase + layoutVersion) ──────────


def test_build_json_emits_camel_case_and_layout_version():
    json_manifest, _ = build_json_from_ossie(
        _fixture("minimal.yaml"), data_source="postgres"
    )
    assert json_manifest["layoutVersion"] == 2
    orders = next(m for m in json_manifest["models"] if m["name"] == "orders")
    assert "tableReference" in orders  # camelCased
    assert "isCalculated" in orders["columns"][0]
    rel = json_manifest["relationships"][0]
    assert "joinType" in rel


def test_build_json_preserves_instructions_key():
    """`_instructions` must survive the snake→camel pass with its leading
    underscore intact — downstream tooling (memory indexer, MDL importer)
    looks for that exact key."""
    json_manifest, _ = build_json_from_ossie(
        _fixture("minimal.yaml"), data_source="postgres"
    )
    assert "_instructions" in json_manifest
    assert "Instructions" not in json_manifest  # the bug we're guarding against
    assert "Shop analytics model" in json_manifest["_instructions"]


# ── Integration: TPC-DS full fixture (exercises every warning path) ───────


def test_build_tpcds_full_runs():
    manifest, errors = build_manifest_from_ossie(
        _fixture("tpcds_full.yaml"), data_source="postgres"
    )
    hard = [e for e in errors if e.level == "error"]
    assert hard == [], [str(e) for e in hard]
    assert len(manifest["models"]) == 5
    assert len(manifest["relationships"]) == 4


def test_build_tpcds_composite_pk_preserved():
    """store_sales has composite PK [ss_item_sk, ss_ticket_number] — wren MDL now
    keeps it as a list instead of downgrading to one column with a warning."""
    manifest, errors = build_manifest_from_ossie(
        _fixture("tpcds_full.yaml"), data_source="postgres"
    )
    # No downgrade warning any more.
    composite_warns = [e for e in errors if "composite primary_key" in e.message]
    assert composite_warns == []

    store_sales = next(m for m in manifest["models"] if m["name"] == "store_sales")
    assert store_sales["primary_key"] == ["ss_item_sk", "ss_ticket_number"]
    # Every composite member is a declared field and is flagged on its column.
    pk_cols = {c["name"] for c in store_sales["columns"] if c.get("is_primary_key")}
    assert pk_cols == {"ss_item_sk", "ss_ticket_number"}
    assert not any("primary_key references undeclared" in e.message for e in errors)


def test_build_tpcds_untyped_field_warnings_include_snippets():
    """No WREN column_types provided → every dataset triggers a typed warning
    with a copy-pasteable snippet."""
    _, errors = build_manifest_from_ossie(
        _fixture("tpcds_full.yaml"), data_source="postgres"
    )
    untyped = [e for e in errors if "have no type" in e.message]
    assert len(untyped) >= 5  # one per dataset
    for w in untyped:
        assert "custom_extensions:" in w.message
        assert "vendor_name: WREN" in w.message
        assert "column_types" in w.message


def test_build_tpcds_cross_dataset_metric_warns():
    """customer_lifetime_value and store_productivity span 2 datasets."""
    _, errors = build_manifest_from_ossie(
        _fixture("tpcds_full.yaml"), data_source="postgres"
    )
    cross = [e for e in errors if "references 2 datasets" in e.message]
    assert len(cross) == 2
    names = " ".join(e.path for e in cross)
    assert "customer_lifetime_value" in names
    assert "store_productivity" in names


def test_build_tpcds_time_dimension_inferred_as_timestamp():
    """date_dim has dimension.is_time fields — should default to TIMESTAMP, not VARCHAR."""
    manifest, _ = build_manifest_from_ossie(
        _fixture("tpcds_full.yaml"), data_source="postgres"
    )
    date_dim = next(m for m in manifest["models"] if m["name"] == "date_dim")
    d_year = next(c for c in date_dim["columns"] if c["name"] == "d_year")
    assert d_year["type"] == "TIMESTAMP"


def test_build_json_layout_version_3_for_composite_primary_key():
    """A composite primary_key is a layoutVersion 3 wire format; stamping 2
    makes `init --from-ossie` land on schema_version 3, which validate then
    flags. (Single-column keys keep layoutVersion 2 — see the minimal test.)"""
    json_manifest, _ = build_json_from_ossie(
        _fixture("tpcds_full.yaml"), data_source="postgres"
    )
    assert json_manifest["layoutVersion"] == 3


# ── Integration: undeclared fields behind calculated columns / primary keys ──


def _write_ossie(tmp_path: Path, body: str) -> Path:
    p = tmp_path / "ossie.yaml"
    p.write_text(body)
    return p


def _customers_with(fields_yaml: str, *, primary_key: str = "[customer_id]") -> str:
    return (
        'version: "0.1.1"\n'
        "semantic_model:\n"
        "  - name: shop\n"
        "    datasets:\n"
        "      - name: customers\n"
        "        source: shop.public.customers\n"
        f"        primary_key: {primary_key}\n"
        "        custom_extensions:\n"
        "          - vendor_name: WREN\n"
        '            data: \'{"column_types": {"customer_id": "BIGINT", '
        '"full_name": "VARCHAR"}}\'\n'
        "        fields:\n"
        "          - name: customer_id\n"
        "            expression: customer_id\n"
        f"{fields_yaml}"
    )


_UNDECLARED_CALC = _customers_with(
    "          - name: full_name\n"
    "            expression: first_name || ' ' || last_name\n"
)


def test_build_calculated_field_over_undeclared_columns_warns(tmp_path: Path):
    """full_name reads first_name / last_name, which are not fields. The engine
    resolves calculated expressions against the model's columns, so every query
    on the model would fail — the converter must say so, with a fix snippet."""
    manifest, errors = build_manifest_from_ossie(
        _write_ossie(tmp_path, _UNDECLARED_CALC), data_source="postgres"
    )
    assert [e for e in errors if e.level == "error"] == []
    warns = [e for e in errors if "undeclared field" in e.message]
    assert len(warns) == 1
    w = warns[0]
    assert w.level == "warning"
    assert w.path == "dataset 'customers'"
    assert "'first_name' (used by full_name)" in w.message
    assert "'last_name' (used by full_name)" in w.message
    # Copy-pasteable snippet declaring the missing fields.
    assert "fields:" in w.message
    assert "- name: first_name" in w.message
    assert "expression: last_name" in w.message
    # The column itself is still emitted as calculated.
    full_name = next(
        c for c in manifest["models"][0]["columns"] if c["name"] == "full_name"
    )
    assert full_name["is_calculated"] is True


def test_build_calculated_field_over_declared_columns_is_clean():
    """minimal.yaml declares first_name / last_name — no warning."""
    _, errors = build_manifest_from_ossie(
        _fixture("minimal.yaml"), data_source="postgres"
    )
    assert not any("undeclared field" in e.message for e in errors)


def test_build_calculated_field_ignores_qualified_nested_and_unparseable(
    tmp_path: Path,
):
    """Qualified refs resolve through relationships, subquery columns through
    their own FROM, and an unparseable expression is left to the engine —
    none of them is an undeclared *field* of this dataset."""
    body = _customers_with(
        "          - name: order_total\n"
        "            expression: orders.amount * 2\n"
        "          - name: max_order\n"
        "            expression: (SELECT MAX(amount) FROM orders)\n"
        "          - name: broken\n"
        "            expression: CASE WHEN first_name\n"
    )
    _, errors = build_manifest_from_ossie(
        _write_ossie(tmp_path, body), data_source="postgres"
    )
    assert [e for e in errors if e.level == "error"] == []
    assert not any("undeclared field" in e.message for e in errors)


def test_build_primary_key_over_undeclared_field_errors(tmp_path: Path):
    """primary_key names a column that is not a field. `wren context validate`
    rejects the generated model, so the conversion must report it up front."""
    body = _customers_with("", primary_key="[customer_id, tenant_id]")
    _, errors = build_manifest_from_ossie(
        _write_ossie(tmp_path, body), data_source="postgres"
    )
    hard = [e for e in errors if e.level == "error"]
    assert len(hard) == 1
    assert hard[0].path == "dataset 'customers'"
    assert "primary_key references undeclared field(s): tenant_id" in hard[0].message
    assert "- name: tenant_id" in hard[0].message
    assert "expression: tenant_id" in hard[0].message


def test_build_primary_key_pick_only_checks_the_picked_column(tmp_path: Path):
    """A WREN.primary_key override narrows the key to one column; only that
    column has to be declared."""
    body = _customers_with("", primary_key="[customer_id, tenant_id]").replace(
        '"full_name": "VARCHAR"}}',
        '"full_name": "VARCHAR"}, "primary_key": "customer_id"}',
    )
    manifest, errors = build_manifest_from_ossie(
        _write_ossie(tmp_path, body), data_source="postgres"
    )
    assert [e for e in errors if e.level == "error"] == []
    assert manifest["models"][0]["primary_key"] == "customer_id"


# ── Integration: ref_sql source detection ────────────────────────────────


def test_ref_sql_source_detected():
    manifest, errors = build_manifest_from_ossie(
        _fixture("ref_sql_source.yaml"), data_source="postgres"
    )
    hard = [e for e in errors if e.level == "error"]
    assert hard == [], [str(e) for e in hard]
    active = manifest["models"][0]
    assert active["name"] == "active_users"
    assert "table_reference" not in active
    assert "ref_sql" in active
    assert "SELECT" in active["ref_sql"]


# ── Integration: multi semantic_model requires selection ──────────────────


def test_multi_semantic_model_requires_selection():
    _, errors = build_manifest_from_ossie(
        _fixture("multi_semantic_model.yaml"), data_source="postgres"
    )
    hard = [e for e in errors if e.level == "error"]
    assert hard, "should error when multiple semantic_models and none picked"
    assert any("2 semantic_models" in e.message for e in hard)


def test_multi_semantic_model_with_flag_succeeds():
    manifest, errors = build_manifest_from_ossie(
        _fixture("multi_semantic_model.yaml"),
        data_source="postgres",
        semantic_model="model_b",
    )
    hard = [e for e in errors if e.level == "error"]
    assert hard == [], [str(e) for e in hard]
    assert manifest["models"][0]["name"] == "t2"


# ── Integration: lint_ossie_file ─────────────────────────────────────────────


def test_lint_missing_data_source_errors():
    errors = lint_ossie_file(_fixture("minimal.yaml"), data_source=None)
    assert errors and errors[0].level == "error"
    assert "--data-source" in errors[0].message


def test_lint_missing_file_errors(tmp_path):
    errors = lint_ossie_file(tmp_path / "nonexistent.yaml", data_source="postgres")
    assert errors and errors[0].level == "error"
    assert "not found" in errors[0].message


def test_lint_minimal_clean():
    errors = lint_ossie_file(_fixture("minimal.yaml"), data_source="postgres")
    hard = [e for e in errors if e.level == "error"]
    assert hard == []


# ── Regression: malformed inputs surface as ValidationError ──────────────


def test_build_manifest_malformed_yaml_returns_error(tmp_path: Path):
    """Broken YAML must produce a structured error, not a raw exception."""
    p = tmp_path / "bad.yaml"
    p.write_text("semantic_model: [\n")  # unterminated flow sequence
    manifest, errors = build_manifest_from_ossie(p, data_source="postgres")
    assert manifest == {}
    assert any(e.level == "error" for e in errors)
    assert any("failed to read Ossie file" in e.message for e in errors)


def test_lint_malformed_yaml_does_not_raise(tmp_path: Path):
    """lint_ossie_file likewise reports parse failure cleanly."""
    p = tmp_path / "bad.yaml"
    p.write_text("not: [a, b,")
    errors = lint_ossie_file(p, data_source="postgres")
    assert errors and errors[0].level == "error"
    assert "failed to read Ossie file" in errors[0].message


def test_relationship_non_string_join_columns_error(tmp_path: Path):
    """Non-string from_columns / to_columns must error before any SQL is built."""
    bad = {
        "version": "0.2.0",
        "semantic_model": [
            {
                "name": "x",
                "datasets": [
                    {
                        "name": "a",
                        "source": "c.s.a",
                        "primary_key": ["id"],
                        "custom_extensions": [
                            {
                                "vendor_name": "WREN",
                                "data": '{"column_types": {"id": "INTEGER"}}',
                            }
                        ],
                        "fields": [{"name": "id", "expression": "id"}],
                    },
                    {
                        "name": "b",
                        "source": "c.s.b",
                        "primary_key": ["id"],
                        "custom_extensions": [
                            {
                                "vendor_name": "WREN",
                                "data": '{"column_types": {"id": "INTEGER"}}',
                            }
                        ],
                        "fields": [{"name": "id", "expression": "id"}],
                    },
                ],
                "relationships": [
                    {
                        "name": "a_to_b",
                        "from": "a",
                        "to": "b",
                        "from_columns": ["id"],
                        "to_columns": [123],  # non-string entry
                    }
                ],
            }
        ],
    }
    p = tmp_path / "bad_rel.yaml"
    p.write_text(json.dumps(bad))
    _, errors = build_manifest_from_ossie(p, data_source="postgres")
    rel_errs = [e for e in errors if "relationship 'a_to_b'" in e.path]
    assert rel_errs and rel_errs[0].level == "error"
    assert "non-empty strings" in rel_errs[0].message


# ── CLI integration ──────────────────────────────────────────────────────


runner = CliRunner()


def test_cli_build_from_ossie(tmp_path: Path):
    out = tmp_path / "mdl.json"
    result = runner.invoke(
        app,
        [
            "context",
            "build",
            "--from-ossie",
            str(_fixture("minimal.yaml")),
            "--data-source",
            "postgres",
            "--output",
            str(out),
        ],
    )
    assert result.exit_code == 0, result.output
    assert out.exists()
    data = json.loads(out.read_text())
    assert data["dataSource"] == "postgres"
    assert data["layoutVersion"] == 2
    assert {m["name"] for m in data["models"]} == {"orders", "customers"}


def test_cli_build_from_ossie_requires_data_source(tmp_path: Path):
    result = runner.invoke(
        app,
        [
            "context",
            "build",
            "--from-ossie",
            str(_fixture("minimal.yaml")),
            "--output",
            str(tmp_path / "mdl.json"),
        ],
    )
    assert result.exit_code == 1
    assert "--data-source" in result.output


def test_cli_build_from_ossie_missing_file(tmp_path: Path):
    result = runner.invoke(
        app,
        [
            "context",
            "build",
            "--from-ossie",
            str(tmp_path / "nonexistent.yaml"),
            "--data-source",
            "postgres",
        ],
    )
    assert result.exit_code == 1
    assert "not found" in result.output


def test_cli_build_from_ossie_aborts_on_hard_error(tmp_path: Path):
    """multi-semantic_model without --semantic-model should hard-error."""
    result = runner.invoke(
        app,
        [
            "context",
            "build",
            "--from-ossie",
            str(_fixture("multi_semantic_model.yaml")),
            "--data-source",
            "postgres",
            "--output",
            str(tmp_path / "mdl.json"),
        ],
    )
    assert result.exit_code == 1
    assert "semantic_models" in result.output


def test_cli_validate_from_ossie_clean():
    result = runner.invoke(
        app,
        [
            "context",
            "validate",
            "--from-ossie",
            str(_fixture("minimal.yaml")),
            "--data-source",
            "postgres",
        ],
    )
    assert result.exit_code == 0, result.output
    assert "Valid" in result.output


def test_cli_validate_from_ossie_surfaces_warnings():
    """TPC-DS fixture has no WREN column_types → warnings printed."""
    result = runner.invoke(
        app,
        [
            "context",
            "validate",
            "--from-ossie",
            str(_fixture("tpcds_full.yaml")),
            "--data-source",
            "postgres",
            "--verbose",
        ],
    )
    # Warnings only — exit 0
    assert result.exit_code == 0, result.output
    assert "Warnings" in result.output
    assert "column_types" in result.output  # snippet emitted


def test_cli_validate_from_ossie_summary_counts_errors(tmp_path: Path):
    ossie_file = tmp_path / "osi.yaml"
    ossie_file.write_text(
        'version: "0.2.0"\n'
        "semantic_model:\n"
        "  - name: shop\n"
        "    datasets:\n"
        "      - name: orders\n"
        "        source: shop.public.orders\n"
        "        fields:\n"
        "          - name: order_id\n"
        "            expression: order_id\n"
        "      - source: shop.public.customers\n"
    )
    result = runner.invoke(
        app,
        [
            "context",
            "validate",
            "--from-ossie",
            str(ossie_file),
            "--data-source",
            "postgres",
        ],
    )
    assert result.exit_code == 1
    assert "dataset missing 'name'" in result.output
    assert "1 warning(s), 1 error(s)." in result.output


def test_cli_validate_from_ossie_strict_fails_on_warning():
    result = runner.invoke(
        app,
        [
            "context",
            "validate",
            "--from-ossie",
            str(_fixture("tpcds_full.yaml")),
            "--data-source",
            "postgres",
            "--strict",
        ],
    )
    assert result.exit_code == 1


def test_cli_show_from_ossie_summary():
    result = runner.invoke(
        app,
        [
            "context",
            "show",
            "--from-ossie",
            str(_fixture("minimal.yaml")),
            "--data-source",
            "postgres",
        ],
    )
    assert result.exit_code == 0, result.output
    assert "orders" in result.output
    assert "customers" in result.output
    assert "MANY_TO_ONE" in result.output


def test_cli_show_from_ossie_json():
    result = runner.invoke(
        app,
        [
            "context",
            "show",
            "--from-ossie",
            str(_fixture("minimal.yaml")),
            "--data-source",
            "postgres",
            "--output",
            "json",
        ],
    )
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)
    assert data["layoutVersion"] == 2
    assert "tableReference" in data["models"][0]
    # The show --output json path must shield `_instructions` from the
    # snake→camel pass, same as build_json_from_ossie.
    assert "_instructions" in data
    assert "Instructions" not in data
    assert "Shop analytics model" in data["_instructions"]


# ── CLI: init --from-ossie (one-way migration) ─────────────────────────────


def test_cli_init_from_ossie_scaffolds_project(tmp_path: Path):
    """Ossie → wren project layout, ready for the standard build flow."""
    proj = tmp_path / "migrated"
    result = runner.invoke(
        app,
        [
            "context",
            "init",
            "--from-ossie",
            str(_fixture("minimal.yaml")),
            "--data-source",
            "postgres",
            "--path",
            str(proj),
        ],
    )
    assert result.exit_code == 0, result.output
    assert "Migrated Ossie" in result.output
    # Standard wren project layout
    assert (proj / "wren_project.yml").exists()
    assert (proj / "models" / "orders" / "metadata.yml").exists()
    assert (proj / "models" / "customers" / "metadata.yml").exists()
    assert (proj / "relationships.yml").exists()
    assert (proj / "knowledge" / "rules" / "general.md").exists()
    assert (proj / "AGENTS.md").exists()
    # The Ossie semantic_model.name flowed into wren_project.yml
    import yaml as _yaml  # noqa: PLC0415

    cfg = _yaml.safe_load((proj / "wren_project.yml").read_text())
    assert cfg["name"] == "shop"
    assert cfg["data_source"] == "postgres"


def test_cli_init_from_ossie_roundtrip_matches_direct_build(tmp_path: Path):
    """init --from-ossie then context build should produce a manifest with the
    same models / relationships as a direct build --from-ossie."""
    proj = tmp_path / "migrated"
    _invoke = lambda args: runner.invoke(app, args)  # noqa: E731

    init = _invoke(
        [
            "context",
            "init",
            "--from-ossie",
            str(_fixture("minimal.yaml")),
            "--data-source",
            "postgres",
            "--path",
            str(proj),
        ]
    )
    assert init.exit_code == 0, init.output
    build = _invoke(["context", "build", "--path", str(proj)])
    assert build.exit_code == 0, build.output

    migrated_mdl = json.loads((proj / "target" / "mdl.json").read_text())

    direct_out = tmp_path / "direct.mdl.json"
    direct = _invoke(
        [
            "context",
            "build",
            "--from-ossie",
            str(_fixture("minimal.yaml")),
            "--data-source",
            "postgres",
            "--output",
            str(direct_out),
        ]
    )
    assert direct.exit_code == 0, direct.output
    direct_mdl = json.loads(direct_out.read_text())

    assert {m["name"] for m in migrated_mdl["models"]} == {
        m["name"] for m in direct_mdl["models"]
    }
    assert len(migrated_mdl["relationships"]) == len(direct_mdl["relationships"])
    # Per-column type / expression should survive the round-trip.
    mig_orders = next(m for m in migrated_mdl["models"] if m["name"] == "orders")
    direct_orders = next(m for m in direct_mdl["models"] if m["name"] == "orders")
    mig_cols = {c["name"]: c.get("type") for c in mig_orders["columns"]}
    direct_cols = {c["name"]: c.get("type") for c in direct_orders["columns"]}
    assert mig_cols == direct_cols


def test_cli_validate_from_ossie_reports_undeclared_calculated_columns(
    tmp_path: Path,
):
    result = runner.invoke(
        app,
        [
            "context",
            "validate",
            "--from-ossie",
            str(_write_ossie(tmp_path, _UNDECLARED_CALC)),
            "--data-source",
            "postgres",
            "--verbose",
        ],
    )
    assert result.exit_code == 0, result.output
    assert "undeclared field" in result.output
    assert "- name: first_name" in result.output


def test_cli_init_from_ossie_project_validates_and_builds(tmp_path: Path):
    """What converts cleanly must also validate and build as a wren project."""
    proj = tmp_path / "migrated"
    init = runner.invoke(
        app,
        [
            "context",
            "init",
            "--from-ossie",
            str(_fixture("minimal.yaml")),
            "--data-source",
            "duckdb",
            "--path",
            str(proj),
        ],
    )
    assert init.exit_code == 0, init.output
    validate = runner.invoke(app, ["context", "validate", "--path", str(proj)])
    assert validate.exit_code == 0, validate.output
    assert "0 error(s)" in validate.output or "Valid" in validate.output
    build = runner.invoke(app, ["context", "build", "--path", str(proj)])
    assert build.exit_code == 0, build.output


def test_cli_init_from_ossie_composite_pk_lands_on_schema_version_4_plus(
    tmp_path: Path,
):
    """tpcds_full.yaml has a composite primary key. The migrated project must
    carry a schema_version that accepts it, and validate / build cleanly."""
    import yaml as _yaml  # noqa: PLC0415

    proj = tmp_path / "tpcds"
    init = runner.invoke(
        app,
        [
            "context",
            "init",
            "--from-ossie",
            str(_fixture("tpcds_full.yaml")),
            "--data-source",
            "duckdb",
            "--path",
            str(proj),
        ],
    )
    assert init.exit_code == 0, init.output
    cfg = _yaml.safe_load((proj / "wren_project.yml").read_text())
    assert cfg["schema_version"] >= 4

    validate = runner.invoke(
        app, ["context", "validate", "--path", str(proj), "--verbose"]
    )
    assert validate.exit_code == 0, validate.output
    assert "composite primary_key requires" not in validate.output
    assert "not found in columns" not in validate.output

    build = runner.invoke(app, ["context", "build", "--path", str(proj)])
    assert build.exit_code == 0, build.output
    mdl = json.loads((proj / "target" / "mdl.json").read_text())
    store_sales = next(m for m in mdl["models"] if m["name"] == "store_sales")
    assert store_sales["primaryKey"] == ["ss_item_sk", "ss_ticket_number"]


def test_cli_init_from_ossie_requires_data_source(tmp_path: Path):
    result = runner.invoke(
        app,
        [
            "context",
            "init",
            "--from-ossie",
            str(_fixture("minimal.yaml")),
            "--path",
            str(tmp_path / "p"),
        ],
    )
    assert result.exit_code == 1
    assert "--data-source" in result.output


def test_cli_init_from_ossie_missing_file(tmp_path: Path):
    result = runner.invoke(
        app,
        [
            "context",
            "init",
            "--from-ossie",
            str(tmp_path / "nonexistent.yaml"),
            "--data-source",
            "postgres",
            "--path",
            str(tmp_path / "p"),
        ],
    )
    assert result.exit_code == 1
    assert "not found" in result.output


def test_cli_init_from_ossie_mutually_exclusive_with_from_mdl(tmp_path: Path):
    """--from-mdl and --from-ossie cannot be combined — bail before either runs."""
    fake_mdl = tmp_path / "fake.json"
    fake_mdl.write_text("{}")
    result = runner.invoke(
        app,
        [
            "context",
            "init",
            "--from-mdl",
            str(fake_mdl),
            "--from-ossie",
            str(_fixture("minimal.yaml")),
            "--data-source",
            "postgres",
            "--path",
            str(tmp_path / "p"),
        ],
    )
    assert result.exit_code == 1
    assert "mutually exclusive" in result.output


def test_cli_init_from_ossie_refuses_overwrite_without_force(tmp_path: Path):
    """Without --force, an existing wren_project.yml blocks the migration."""
    proj = tmp_path / "existing"
    proj.mkdir()
    (proj / "wren_project.yml").write_text("name: prior\n")
    result = runner.invoke(
        app,
        [
            "context",
            "init",
            "--from-ossie",
            str(_fixture("minimal.yaml")),
            "--data-source",
            "postgres",
            "--path",
            str(proj),
        ],
    )
    assert result.exit_code == 1
    assert "already exists" in result.output


def test_cli_init_from_ossie_force_overwrites(tmp_path: Path):
    proj = tmp_path / "existing"
    proj.mkdir()
    (proj / "wren_project.yml").write_text("name: prior\n")
    result = runner.invoke(
        app,
        [
            "context",
            "init",
            "--from-ossie",
            str(_fixture("minimal.yaml")),
            "--data-source",
            "postgres",
            "--path",
            str(proj),
            "--force",
        ],
    )
    assert result.exit_code == 0, result.output
    import yaml as _yaml  # noqa: PLC0415

    cfg = _yaml.safe_load((proj / "wren_project.yml").read_text())
    assert cfg["name"] == "shop"


def test_cli_init_from_ossie_aborts_on_hard_error(tmp_path: Path):
    """Ambiguous semantic_model selection is a hard error — migration must
    bail without touching the target directory."""
    proj = tmp_path / "p"
    result = runner.invoke(
        app,
        [
            "context",
            "init",
            "--from-ossie",
            str(_fixture("multi_semantic_model.yaml")),
            "--data-source",
            "postgres",
            "--path",
            str(proj),
        ],
    )
    assert result.exit_code == 1
    assert "semantic_models" in result.output
    assert not proj.exists() or not any(proj.iterdir())


def test_cli_init_from_ossie_with_semantic_model_picks_one(tmp_path: Path):
    proj = tmp_path / "migrated_b"
    result = runner.invoke(
        app,
        [
            "context",
            "init",
            "--from-ossie",
            str(_fixture("multi_semantic_model.yaml")),
            "--data-source",
            "postgres",
            "--semantic-model",
            "model_b",
            "--path",
            str(proj),
        ],
    )
    assert result.exit_code == 0, result.output
    assert (proj / "models" / "t2" / "metadata.yml").exists()
    assert not (proj / "models" / "t1").exists()


# ═══════════════════════════════════════════════════════════════════════════
# MDL → Ossie (export)
# ═══════════════════════════════════════════════════════════════════════════


def _wren_data(obj: dict) -> dict:
    """Decode the WREN custom_extensions block of an exported Ossie object."""
    return _extract_wren_block(obj.get("custom_extensions"))


def _export_manifest() -> dict:
    """A snake_case manifest exercising every exported construct."""
    return {
        "catalog": "wren",
        "schema": "public",
        "data_source": "postgres",
        "models": [
            {
                "name": "orders",
                "table_reference": {"catalog": "", "schema": "main", "table": "orders"},
                "primary_key": "order_id",
                "cached": False,
                "properties": {"description": "Order fact"},
                "columns": [
                    {
                        "name": "order_id",
                        "type": "BIGINT",
                        "is_calculated": False,
                        "not_null": True,
                        "is_primary_key": True,
                        "properties": {},
                    },
                    {
                        "name": "customer_id",
                        "type": "BIGINT",
                        "not_null": True,
                        "properties": {"description": "FK"},
                    },
                    {"name": "amount", "type": "DECIMAL(18,2)", "properties": {}},
                    {"name": "ordered_at", "type": "TIMESTAMP", "properties": {}},
                    {
                        "name": "amount_eur",
                        "type": "DECIMAL(18,2)",
                        "is_calculated": True,
                        "expression": "amount * 0.92",
                        "properties": {},
                    },
                    {
                        "name": "customer",
                        "type": "customers",
                        "relationship": "orders_customers",
                        "properties": {},
                    },
                ],
            },
            {
                "name": "customers",
                "table_reference": {
                    "catalog": "shop",
                    "schema": "main",
                    "table": "customers",
                },
                "primary_key": ["tenant_id", "customer_id"],
                "columns": [
                    {"name": "tenant_id", "type": "INTEGER"},
                    {"name": "customer_id", "type": "BIGINT"},
                    {"name": "email", "type": "VARCHAR"},
                ],
            },
        ],
        "relationships": [
            {
                "name": "orders_customers",
                "models": ["orders", "customers"],
                "join_type": "MANY_TO_ONE",
                "condition": "orders.customer_id = customers.customer_id",
                "properties": {"description": "Each order has one customer"},
            }
        ],
        "views": [{"name": "recent_orders", "statement": "SELECT 1"}],
        "cubes": [
            {
                "name": "order_metrics",
                "base_object": "orders",
                "measures": [
                    {
                        "name": "total_revenue",
                        "expression": "SUM(amount)",
                        "type": "DECIMAL(18,2)",
                        "description": "Revenue",
                    },
                    {"name": "order_count", "expression": "COUNT(*)", "type": "BIGINT"},
                ],
                "dimensions": [{"name": "cust", "expression": "customer_id"}],
            }
        ],
    }


# ── Unit: helpers ────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "wren_type, expected",
    [
        ("VARCHAR", "String"),
        ("varchar(255)", "String"),
        ("BIGINT", "Integer"),
        ("DECIMAL(18,2)", "Decimal"),
        ("double", "Float"),
        ("BOOLEAN", "Boolean"),
        ("DATE", "Date"),
        ("TIMESTAMP", "DateTime"),
        ("TIMESTAMP WITH TIME ZONE", "DateTimeTz"),
        ("TIMESTAMPTZ", "DateTimeTz"),
        ("GEOGRAPHY", None),
        ("", None),
        (None, None),
    ],
)
def test_ossie_datatype_mapping(wren_type, expected):
    assert _ossie_datatype(wren_type) == expected


def test_source_from_model_three_part():
    assert (
        _source_from_model(
            {"table_reference": {"catalog": "c", "schema": "s", "table": "t"}}
        )
        == "c.s.t"
    )


def test_source_from_model_drops_empty_leading_parts():
    assert (
        _source_from_model(
            {"table_reference": {"catalog": "", "schema": "s", "table": "t"}}
        )
        == "s.t"
    )
    assert _source_from_model({"table_reference": {"table": "t"}}) == "t"


def test_source_from_model_prefers_ref_sql():
    assert (
        _source_from_model(
            {
                "ref_sql": "  SELECT 1 FROM x\n",
                "table_reference": {"table": "ignored"},
            }
        )
        == "SELECT 1 FROM x"
    )


def test_source_from_model_missing_table():
    assert _source_from_model({"table_reference": {"schema": "s"}}) is None
    assert _source_from_model({}) is None


def test_parse_join_condition_single_and_composite():
    assert _parse_join_condition("a.x = b.y") == [("a", "x", "b", "y")]
    assert _parse_join_condition('a.x = b.y AND a."z" = b.w') == [
        ("a", "x", "b", "y"),
        ("a", "z", "b", "w"),
    ]


def test_parse_join_condition_rejects_non_equality():
    assert _parse_join_condition("a.x > b.y") is None
    assert _parse_join_condition("a.x = b.y OR a.z = b.w") is None
    assert _parse_join_condition("") is None
    assert _parse_join_condition(None) is None


def test_qualify_measure_expression_prefixes_bare_columns():
    assert (
        _qualify_measure_expression("SUM(amount) / COUNT(DISTINCT id)", "orders")
        == "SUM(orders.amount) / COUNT(DISTINCT orders.id)"
    )


def test_qualify_measure_expression_leaves_nested_query_scope_alone():
    assert (
        _qualify_measure_expression(
            "SUM(amount) + (SELECT MAX(amount) FROM refunds)", "orders"
        )
        == "SUM(orders.amount) + (SELECT MAX(amount) FROM refunds)"
    )


def test_qualify_measure_expression_keeps_qualified_columns():
    assert _qualify_measure_expression("SUM(o.amount)", "orders") == "SUM(o.amount)"


def test_qualify_measure_expression_unparseable():
    assert _qualify_measure_expression("SUM(", "orders") is None
    # Tokenizer failures (TokenError, not ParseError) take the same path.
    assert _qualify_measure_expression("SUM('abc)", "orders") is None


# ── Unit: export_ossie_from_manifest ───────────────────────────────────────


def test_export_document_shape_matches_importer():
    doc, _ = export_ossie_from_manifest(_export_manifest(), name="shop")
    assert doc["version"] == "0.1.1"
    assert [sm["name"] for sm in doc["semantic_model"]] == ["shop"]
    # ANSI_SQL is the default dialect: no root WREN block is needed.
    assert "custom_extensions" not in doc


def test_export_datasets_fields_and_types():
    doc, _ = export_ossie_from_manifest(_export_manifest())
    sm = doc["semantic_model"][0]
    orders = next(d for d in sm["datasets"] if d["name"] == "orders")

    assert orders["source"] == "main.orders"
    assert orders["primary_key"] == ["order_id"]
    assert orders["description"] == "Order fact"
    # Relationship column is dropped; physical + calculated fields remain.
    assert [f["name"] for f in orders["fields"]] == [
        "order_id",
        "customer_id",
        "amount",
        "ordered_at",
        "amount_eur",
    ]
    assert _wren_data(orders)["column_types"] == {
        "order_id": "BIGINT",
        "customer_id": "BIGINT",
        "amount": "DECIMAL(18,2)",
        "ordered_at": "TIMESTAMP",
        "amount_eur": "DECIMAL(18,2)",
    }

    by_name = {f["name"]: f for f in orders["fields"]}
    assert by_name["amount"]["expression"] == {
        "dialects": [{"dialect": "ANSI_SQL", "expression": "amount"}]
    }
    # 0.1.1 has no ``datatype``; the time role still travels via is_time.
    assert "datatype" not in by_name["amount"]
    assert by_name["amount_eur"]["expression"]["dialects"][0]["expression"] == (
        "amount * 0.92"
    )
    assert by_name["ordered_at"]["dimension"] == {"is_time": True}
    assert by_name["customer_id"]["description"] == "FK"
    # not_null survives on non-PK columns via a field-level WREN block;
    # the PK column is implied not-null by the importer, so no block there.
    assert _wren_data(by_name["customer_id"]) == {"not_null": True}
    assert "custom_extensions" not in by_name["order_id"]


def test_export_composite_primary_key_and_three_part_source():
    doc, _ = export_ossie_from_manifest(_export_manifest())
    customers = next(
        d for d in doc["semantic_model"][0]["datasets"] if d["name"] == "customers"
    )
    assert customers["source"] == "shop.main.customers"
    assert customers["primary_key"] == ["tenant_id", "customer_id"]


def test_export_relationship_many_to_one():
    doc, _ = export_ossie_from_manifest(_export_manifest())
    rels = doc["semantic_model"][0]["relationships"]
    assert rels == [
        {
            "name": "orders_customers",
            "from": "orders",
            "to": "customers",
            "from_columns": ["customer_id"],
            "to_columns": ["customer_id"],
            "ai_context": {"instructions": "Each order has one customer"},
        }
    ]


def test_export_relationship_one_to_many_is_flipped():
    manifest = {
        "models": [
            {"name": "a", "table_reference": {"table": "a"}, "columns": []},
            {"name": "b", "table_reference": {"table": "b"}, "columns": []},
        ],
        "relationships": [
            {
                "name": "a_b",
                "models": ["a", "b"],
                "join_type": "ONE_TO_MANY",
                "condition": "a.id = b.a_id AND a.k = b.a_k",
            }
        ],
    }
    doc, errors = export_ossie_from_manifest(manifest)
    rel = doc["semantic_model"][0]["relationships"][0]
    assert (rel["from"], rel["to"]) == ("b", "a")
    assert rel["from_columns"] == ["a_id", "a_k"]
    assert rel["to_columns"] == ["id", "k"]
    assert not [e for e in errors if e.level == "warning"]


def test_export_relationship_one_to_one_warns_but_exports():
    manifest = {
        "models": [
            {"name": "a", "table_reference": {"table": "a"}, "columns": []},
            {"name": "b", "table_reference": {"table": "b"}, "columns": []},
        ],
        "relationships": [
            {
                "name": "a_b",
                "models": ["a", "b"],
                "join_type": "ONE_TO_ONE",
                "condition": "a.id = b.id",
            }
        ],
    }
    doc, errors = export_ossie_from_manifest(manifest)
    assert doc["semantic_model"][0]["relationships"][0]["from"] == "a"
    assert any("ONE_TO_ONE" in e.message for e in errors if e.level == "warning")


def test_export_relationship_non_equality_condition_skipped():
    manifest = {
        "models": [
            {"name": "a", "table_reference": {"table": "a"}, "columns": []},
            {"name": "b", "table_reference": {"table": "b"}, "columns": []},
        ],
        "relationships": [
            {
                "name": "range_join",
                "models": ["a", "b"],
                "join_type": "MANY_TO_ONE",
                "condition": "a.ts BETWEEN b.start AND b.end",
            }
        ],
    }
    doc, errors = export_ossie_from_manifest(manifest)
    assert "relationships" not in doc["semantic_model"][0]
    assert any("range_join" in e.path for e in errors if e.level == "warning")


def test_export_relationship_condition_naming_foreign_model_skipped():
    manifest = {
        "models": [
            {"name": "a", "table_reference": {"table": "a"}, "columns": []},
            {"name": "b", "table_reference": {"table": "b"}, "columns": []},
        ],
        "relationships": [
            {
                "name": "stray",
                "models": ["a", "b"],
                "join_type": "MANY_TO_ONE",
                "condition": "a.id = c.id",
            }
        ],
    }
    doc, errors = export_ossie_from_manifest(manifest)
    assert "relationships" not in doc["semantic_model"][0]
    assert any("'c'" in e.message for e in errors if e.level == "warning")


def test_export_cube_measures_become_qualified_metrics():
    doc, errors = export_ossie_from_manifest(_export_manifest())
    metrics = doc["semantic_model"][0]["metrics"]
    assert [m["name"] for m in metrics] == ["total_revenue", "order_count"]
    assert metrics[0]["expression"]["dialects"][0]["expression"] == (
        "SUM(orders.amount)"
    )
    assert "datatype" not in metrics[0]
    assert metrics[0]["description"] == "Revenue"
    assert metrics[1]["expression"]["dialects"][0]["expression"] == "COUNT(*)"
    # Dimensions have no Ossie home and are reported.
    assert any(
        "dimension" in e.message and e.path == "cube 'order_metrics'"
        for e in errors
        if e.level == "warning"
    )


def test_export_duplicate_measure_names_are_cube_prefixed():
    manifest = {
        "models": [{"name": "t", "table_reference": {"table": "t"}, "columns": []}],
        "cubes": [
            {
                "name": "c1",
                "base_object": "t",
                "measures": [{"name": "n", "expression": "COUNT(*)"}],
            },
            {
                "name": "c2",
                "base_object": "t",
                "measures": [{"name": "n", "expression": "COUNT(DISTINCT x)"}],
            },
        ],
    }
    doc, _ = export_ossie_from_manifest(manifest)
    assert [m["name"] for m in doc["semantic_model"][0]["metrics"]] == ["n", "c2_n"]


def test_export_cube_with_unknown_base_object_skipped():
    manifest = {
        "models": [{"name": "t", "table_reference": {"table": "t"}, "columns": []}],
        "cubes": [
            {
                "name": "orphan",
                "base_object": "missing_view",
                "measures": [{"name": "n", "expression": "COUNT(*)"}],
            }
        ],
    }
    doc, errors = export_ossie_from_manifest(manifest)
    assert "metrics" not in doc["semantic_model"][0]
    assert any(e.path == "cube 'orphan'" for e in errors if e.level == "warning")


def test_export_views_and_access_controls_warn():
    manifest = _export_manifest()
    manifest["models"][0]["properties"]["row_level_access_controls"] = [
        {"name": "tenant", "condition": "tenant_id = @tenant"}
    ]
    _, errors = export_ossie_from_manifest(manifest)
    warnings = [e for e in errors if e.level == "warning"]
    assert any(e.path == "views" and "recent_orders" in e.message for e in warnings)
    assert any(
        e.path == "model 'orders'" and "row_level_access_controls" in e.message
        for e in warnings
    )
    assert any(
        e.path == "model 'orders'" and "relationship column" in e.message
        for e in warnings
    )


def test_export_instructions_and_name_fallbacks():
    doc, _ = export_ossie_from_manifest(
        {"name": "from_manifest", "models": []}, instructions="Be nice."
    )
    sm = doc["semantic_model"][0]
    assert sm["name"] == "from_manifest"
    assert sm["ai_context"] == {"instructions": "Be nice."}

    doc, _ = export_ossie_from_manifest({"models": []})
    assert doc["semantic_model"][0]["name"] == "wren_project"
    assert "ai_context" not in doc["semantic_model"][0]


def test_export_dialect_inferred_from_data_source_and_pinned_at_root():
    manifest = _export_manifest()
    manifest["data_source"] = "snowflake"
    doc, _ = export_ossie_from_manifest(manifest)
    assert _wren_data(doc) == {"dialect": "SNOWFLAKE"}
    field = doc["semantic_model"][0]["datasets"][0]["fields"][0]
    assert field["expression"]["dialects"][0]["dialect"] == "SNOWFLAKE"

    doc, _ = export_ossie_from_manifest(manifest, dialect="DATABRICKS")
    assert _wren_data(doc) == {"dialect": "DATABRICKS"}


def test_export_model_without_source_is_an_error():
    manifest = {"models": [{"name": "ghost", "columns": []}]}
    doc, errors = export_ossie_from_manifest(manifest)
    assert doc["semantic_model"][0]["datasets"] == []
    assert [e.level for e in errors] == ["error"]
    assert "ghost" in errors[0].path


def test_export_ref_sql_model_round_trips_through_importer(tmp_path: Path):
    manifest = {
        "data_source": "postgres",
        "models": [
            {
                "name": "active_users",
                "ref_sql": "SELECT u.id, u.email\nFROM users u\nWHERE u.is_active",
                "primary_key": "id",
                "columns": [
                    {"name": "id", "type": "BIGINT"},
                    {"name": "email", "type": "VARCHAR"},
                ],
            }
        ],
    }
    doc, errors = export_ossie_from_manifest(manifest)
    assert errors == []
    ossie_path = tmp_path / "exported.yaml"
    ossie_path.write_text(dump_ossie(doc))

    rebuilt, errs = build_manifest_from_ossie(ossie_path, data_source="postgres")
    assert [e for e in errs if e.level == "error"] == []
    model = rebuilt["models"][0]
    assert model["ref_sql"] == manifest["models"][0]["ref_sql"]
    assert model["primary_key"] == "id"
    assert {c["name"]: c["type"] for c in model["columns"]} == {
        "id": "BIGINT",
        "email": "VARCHAR",
    }


def test_export_then_import_preserves_models_and_relationships(tmp_path: Path):
    """The exporter's output must be readable by the importer with no loss on
    the constructs both sides model: sources, PKs, column types/expressions,
    descriptions, relationships and instructions."""
    manifest = _export_manifest()
    doc, _ = export_ossie_from_manifest(
        manifest, name="shop", instructions="Revenue is USD."
    )
    ossie_path = tmp_path / "exported.yaml"
    ossie_path.write_text(dump_ossie(doc))

    rebuilt, errs = build_manifest_from_ossie(ossie_path, data_source="postgres")
    assert [e for e in errs if e.level == "error"] == []
    # Nothing is untyped, so no VARCHAR-default warnings either.
    assert not [e for e in errs if "no type" in e.message]

    by_name = {m["name"]: m for m in rebuilt["models"]}
    orders = by_name["orders"]
    assert orders["table_reference"] == {
        "catalog": "",
        "schema": "main",
        "table": "orders",
    }
    assert orders["primary_key"] == "order_id"
    assert orders["properties"]["description"] == "Order fact"
    cols = {c["name"]: c for c in orders["columns"]}
    assert cols["order_id"]["is_primary_key"] is True
    assert cols["order_id"]["not_null"] is True
    # Non-PK not_null travels through the field-level WREN block.
    assert cols["customer_id"]["not_null"] is True
    assert cols["amount"]["not_null"] is False
    assert cols["amount"]["type"] == "DECIMAL(18,2)"
    assert cols["amount"]["is_calculated"] is False
    assert cols["amount_eur"]["is_calculated"] is True
    assert cols["amount_eur"]["expression"] == "amount * 0.92"
    assert cols["customer_id"]["properties"]["description"] == "FK"
    assert "customer" not in cols  # relationship column is not a field

    customers = by_name["customers"]
    assert customers["table_reference"] == {
        "catalog": "shop",
        "schema": "main",
        "table": "customers",
    }
    assert customers["primary_key"] == ["tenant_id", "customer_id"]

    rel = rebuilt["relationships"][0]
    assert rel["models"] == ["orders", "customers"]
    assert rel["join_type"] == "MANY_TO_ONE"
    assert rel["condition"] == "orders.customer_id = customers.customer_id"
    assert rel["properties"]["description"] == "Each order has one customer"

    assert rebuilt["_instructions"].startswith("Revenue is USD.")
    # Exported metrics come back as instruction notes (importer behaviour).
    assert "total_revenue" in rebuilt["_instructions"]


def test_dump_ossie_is_yaml_in_authoring_order():
    doc, _ = export_ossie_from_manifest(_export_manifest(), name="shop")
    text = dump_ossie(doc)
    assert text.startswith("version: 0.1.1\nsemantic_model:\n")
    assert parse_ossie(text) == doc


# ── CLI: export ossie ──────────────────────────────────────────────────────


def _make_export_project(tmp_path: Path) -> Path:
    proj = tmp_path / "proj"
    proj.mkdir()
    (proj / "wren_project.yml").write_text(
        "schema_version: 5\nname: shop\ncatalog: wren\nschema: public\n"
        "data_source: postgres\n"
    )
    orders = proj / "models" / "orders"
    orders.mkdir(parents=True)
    (orders / "metadata.yml").write_text(
        "name: orders\n"
        "table_reference:\n  catalog: ''\n  schema: main\n  table: orders\n"
        "primary_key: id\n"
        "columns:\n"
        "  - name: id\n    type: BIGINT\n    not_null: true\n"
        "  - name: amount\n    type: DECIMAL(18,2)\n"
    )
    (proj / "relationships.yml").write_text("relationships: []\n")
    rules = proj / "knowledge" / "rules"
    rules.mkdir(parents=True)
    (proj / "knowledge" / "knowledge.yml").write_text("schema_version: 1\n")
    (rules / "general.md").write_text("Amounts are USD.\n")
    return proj


def test_cli_export_ossie_to_stdout(tmp_path: Path):
    proj = _make_export_project(tmp_path)
    result = runner.invoke(app, ["context", "export", "ossie", "--path", str(proj)])
    assert result.exit_code == 0, result.output
    doc = parse_ossie(result.output)
    sm = doc["semantic_model"][0]
    assert sm["name"] == "shop"
    assert sm["ai_context"] == {"instructions": "Amounts are USD."}
    assert sm["datasets"][0]["source"] == "main.orders"
    assert _wren_data(sm["datasets"][0])["column_types"] == {
        "id": "BIGINT",
        "amount": "DECIMAL(18,2)",
    }


def test_cli_export_ossie_to_file_then_build_from_ossie(tmp_path: Path):
    proj = _make_export_project(tmp_path)
    out = tmp_path / "semantic_model.yaml"
    result = runner.invoke(
        app, ["context", "export", "ossie", "--path", str(proj), "--output", str(out)]
    )
    assert result.exit_code == 0, result.output
    assert "1 datasets" in result.output
    assert out.exists()

    mdl_out = tmp_path / "mdl.json"
    build = runner.invoke(
        app,
        [
            "context",
            "build",
            "--from-ossie",
            str(out),
            "--data-source",
            "postgres",
            "--output",
            str(mdl_out),
        ],
    )
    assert build.exit_code == 0, build.output
    data = json.loads(mdl_out.read_text())
    assert data["name"] == "shop"
    assert [m["name"] for m in data["models"]] == ["orders"]
    assert {c["name"]: c["type"] for c in data["models"][0]["columns"]} == {
        "id": "BIGINT",
        "amount": "DECIMAL(18,2)",
    }


def test_cli_export_ossie_from_mdl(tmp_path: Path):
    mdl = tmp_path / "mdl.json"
    mdl.write_text(
        json.dumps(
            {
                "name": "tpch",
                "dataSource": "snowflake",
                "models": [
                    {
                        "name": "orders",
                        "tableReference": {"schema": "main", "table": "orders"},
                        "primaryKey": "o_orderkey",
                        "columns": [{"name": "o_orderkey", "type": "BIGINT"}],
                    }
                ],
                "cubes": [
                    {
                        "name": "m",
                        "baseObject": "orders",
                        "measures": [{"name": "n", "expression": "COUNT(*)"}],
                    }
                ],
                "_instructions": "Rules.",
            }
        )
    )
    result = runner.invoke(app, ["context", "export", "ossie", "--from-mdl", str(mdl)])
    assert result.exit_code == 0, result.output
    doc = parse_ossie(result.output)
    assert _wren_data(doc) == {"dialect": "SNOWFLAKE"}
    sm = doc["semantic_model"][0]
    assert sm["name"] == "tpch"
    assert sm["ai_context"] == {"instructions": "Rules."}
    assert sm["datasets"][0]["primary_key"] == ["o_orderkey"]
    assert sm["metrics"][0]["name"] == "n"


def test_cli_export_ossie_name_override(tmp_path: Path):
    proj = _make_export_project(tmp_path)
    result = runner.invoke(
        app, ["context", "export", "ossie", "--path", str(proj), "--name", "renamed"]
    )
    assert result.exit_code == 0, result.output
    assert parse_ossie(result.output)["semantic_model"][0]["name"] == "renamed"


def test_cli_export_ossie_strict_fails_on_warning(tmp_path: Path):
    proj = _make_export_project(tmp_path)
    view = proj / "views" / "v"
    view.mkdir(parents=True)
    (view / "metadata.yml").write_text("name: v\nstatement: SELECT 1\n")
    ok = runner.invoke(app, ["context", "export", "ossie", "--path", str(proj)])
    assert ok.exit_code == 0, ok.output
    assert "view(s) not exported" in ok.output
    strict = runner.invoke(
        app, ["context", "export", "ossie", "--path", str(proj), "--strict"]
    )
    assert strict.exit_code == 1
    assert "Export aborted" in strict.output


def test_cli_export_ossie_from_mdl_missing_file(tmp_path: Path):
    result = runner.invoke(
        app, ["context", "export", "ossie", "--from-mdl", str(tmp_path / "nope.json")]
    )
    assert result.exit_code == 1
    assert "not found" in result.output


def test_cli_export_ossie_from_mdl_and_path_exclusive(tmp_path: Path):
    result = runner.invoke(
        app,
        [
            "context",
            "export",
            "ossie",
            "--from-mdl",
            str(tmp_path / "x.json"),
            "--path",
            str(tmp_path),
        ],
    )
    assert result.exit_code == 1
    assert "mutually exclusive" in result.output


# ── 0.2.0.dev0 layout: import + export ───────────────────────────────────


ROOT_LAYOUT_DOC = """\
version: 0.2.0.dev0
name: sales
ai_context:
  instructions: Root-level model.
datasets:
  - name: orders
    source: shop.public.orders
    primary_key: [order_id]
    fields:
      - name: order_id
        expression: order_id
        datatype: Integer
      - name: amount
        expression: amount
        datatype: Decimal
      - name: ordered_at
        expression: ordered_at
        datatype: DateTime
      - name: note
        expression: note
      - name: blob
        expression: blob
        datatype: Opaque
relationships: []
metrics: []
"""


def test_import_root_layout_document(tmp_path: Path):
    path = tmp_path / "root.yaml"
    path.write_text(ROOT_LAYOUT_DOC)
    manifest, errors = build_manifest_from_ossie(path, data_source="postgres")
    assert [e for e in errors if e.level == "error"] == []
    assert manifest["name"] == "sales"
    assert manifest["_instructions"] == "Root-level model."
    cols = {c["name"]: c for c in manifest["models"][0]["columns"]}
    # datatype maps to a Wren type when no WREN override is present …
    assert cols["order_id"]["type"] == "BIGINT"
    assert cols["amount"]["type"] == "DECIMAL"
    assert cols["ordered_at"]["type"] == "TIMESTAMP"
    # … and fields without a usable datatype still default to VARCHAR + warn.
    assert cols["note"]["type"] == "VARCHAR"
    assert cols["blob"]["type"] == "VARCHAR"
    untyped = [e for e in errors if "no type" in e.message]
    assert len(untyped) == 1
    assert "2 field(s)" in untyped[0].message
    assert '"note"' in untyped[0].message and '"blob"' in untyped[0].message


def test_import_root_layout_wren_override_beats_datatype(tmp_path: Path):
    path = tmp_path / "root.yaml"
    path.write_text(
        ROOT_LAYOUT_DOC.replace(
            "        datatype: Decimal\n",
            "        datatype: Decimal\n"
            "        custom_extensions:\n"
            "          - vendor_name: WREN\n"
            '            data: \'{"type": "DECIMAL(18,2)"}\'\n',
        )
    )
    manifest, _ = build_manifest_from_ossie(path, data_source="postgres")
    cols = {c["name"]: c["type"] for c in manifest["models"][0]["columns"]}
    assert cols["amount"] == "DECIMAL(18,2)"


def test_select_semantic_model_root_layout_name_mismatch():
    osi = parse_ossie(ROOT_LAYOUT_DOC)
    sm, errs = select_semantic_model(osi, name="other")
    assert sm == {}
    assert errs and "'sales'" in errs[0].message
    sm, errs = select_semantic_model(osi, name="sales")
    assert sm["name"] == "sales" and errs == []


def test_select_semantic_model_neither_layout():
    sm, errs = select_semantic_model({"version": "0.1.1"})
    assert sm == {}
    assert "root-level datasets" in errs[0].message


def test_export_draft_layout_is_root_level_with_datatype():
    manifest = _export_manifest()
    manifest["data_source"] = "snowflake"
    doc, _ = export_ossie_from_manifest(
        manifest, name="shop", instructions="Rules.", spec_version="0.2.0.dev0"
    )
    assert doc["version"] == "0.2.0.dev0"
    assert "semantic_model" not in doc
    assert doc["name"] == "shop"
    assert doc["ai_context"] == {"instructions": "Rules."}
    assert _wren_data(doc) == {"dialect": "SNOWFLAKE"}
    orders = next(d for d in doc["datasets"] if d["name"] == "orders")
    fields = {f["name"]: f for f in orders["fields"]}
    assert fields["amount"]["datatype"] == "Decimal"
    assert fields["ordered_at"]["datatype"] == "DateTime"
    assert fields["ordered_at"]["dimension"] == {"is_time": True}
    assert doc["metrics"][0]["datatype"] == "Decimal"


def test_export_rejects_unknown_spec_version():
    with pytest.raises(ValueError, match="0.1.1, 0.2.0.dev0"):
        export_ossie_from_manifest(_export_manifest(), spec_version="9.9")


def test_export_draft_layout_round_trips_through_importer(tmp_path: Path):
    manifest = _export_manifest()
    doc, _ = export_ossie_from_manifest(
        manifest, name="shop", instructions="Rules.", spec_version="0.2.0.dev0"
    )
    path = tmp_path / "draft.yaml"
    path.write_text(dump_ossie(doc))
    rebuilt, errs = build_manifest_from_ossie(path, data_source="postgres")
    assert [e for e in errs if e.level == "error"] == []
    assert rebuilt["name"] == "shop"
    assert {m["name"] for m in rebuilt["models"]} == {"orders", "customers"}
    cols = {c["name"]: c["type"] for c in rebuilt["models"][0]["columns"]}
    # Exact types come back from the WREN block, not the coarse datatype.
    assert cols["amount"] == "DECIMAL(18,2)"
    assert rebuilt["relationships"][0]["condition"] == (
        "orders.customer_id = customers.customer_id"
    )


def test_cli_export_ossie_spec_version(tmp_path: Path):
    proj = _make_export_project(tmp_path)
    result = runner.invoke(
        app,
        [
            "context",
            "export",
            "ossie",
            "--path",
            str(proj),
            "--spec-version",
            "0.2.0.dev0",
        ],
    )
    assert result.exit_code == 0, result.output
    doc = parse_ossie(result.output)
    assert doc["version"] == "0.2.0.dev0"
    assert doc["name"] == "shop"
    assert doc["datasets"][0]["fields"][0]["datatype"] == "Integer"

    bad = runner.invoke(
        app,
        ["context", "export", "ossie", "--path", str(proj), "--spec-version", "1.0"],
    )
    assert bad.exit_code == 1
    assert "--spec-version must be one of" in bad.output


# ── deprecated --from-osi alias ───────────────────────────────────────────


def test_cli_from_osi_alias_warns_and_still_works(tmp_path: Path):
    out = tmp_path / "mdl.json"
    result = runner.invoke(
        app,
        [
            "context",
            "build",
            "--from-osi",
            str(_fixture("minimal.yaml")),
            "--data-source",
            "postgres",
            "--output",
            str(out),
        ],
    )
    assert result.exit_code == 0, result.output
    assert "--from-osi is deprecated" in result.output
    assert "--from-ossie" in result.output
    assert out.exists()


def test_cli_from_ossie_does_not_warn(tmp_path: Path):
    result = runner.invoke(
        app,
        [
            "context",
            "validate",
            "--from-ossie",
            str(_fixture("minimal.yaml")),
            "--data-source",
            "postgres",
        ],
    )
    assert result.exit_code == 0, result.output
    assert "deprecated" not in result.output


@pytest.mark.parametrize("command", ["init", "validate", "build", "show"])
def test_cli_from_osi_and_from_ossie_together_is_an_error(command: str, tmp_path: Path):
    args = [
        "context",
        command,
        "--from-ossie",
        str(_fixture("minimal.yaml")),
        "--from-osi",
        str(_fixture("minimal.yaml")),
        "--data-source",
        "postgres",
    ]
    if command == "init":
        args += ["--path", str(tmp_path / "p")]
    result = runner.invoke(app, args)
    assert result.exit_code == 1
    assert "pass only one of them" in result.output


def test_cli_export_unknown_target_fails(tmp_path: Path):
    proj = _make_export_project(tmp_path)
    result = runner.invoke(app, ["context", "export", "pdf", "--path", str(proj)])
    assert result.exit_code == 1
    assert "unsupported export target 'pdf'" in result.output
    assert "ossie" in result.output


def test_cli_export_ossie_deprecated_alias_warns_and_matches(tmp_path: Path):
    """`export-ossie` still works, prints a deprecation, and writes the same file."""
    proj = _make_export_project(tmp_path)
    new_out = tmp_path / "new.yaml"
    old_out = tmp_path / "old.yaml"
    new = runner.invoke(
        app,
        ["context", "export", "ossie", "--path", str(proj), "--output", str(new_out)],
    )
    assert new.exit_code == 0, new.output
    assert "deprecated" not in new.output
    old = runner.invoke(
        app,
        ["context", "export-ossie", "--path", str(proj), "--output", str(old_out)],
    )
    assert old.exit_code == 0, old.output
    assert "export-ossie` is deprecated" in old.output
    assert "wren context export ossie" in old.output
    assert old_out.read_text() == new_out.read_text()


def test_cli_export_ossie_alias_is_hidden_from_help():
    from typer.main import get_command  # noqa: PLC0415

    context_group = get_command(app).commands["context"]
    assert not context_group.commands["export"].hidden
    assert context_group.commands["export-ossie"].hidden

    result = runner.invoke(app, ["context", "--help"])
    assert result.exit_code == 0, result.output
    assert "export-ossie" not in result.output


# ── CLI: import ossie ──────────────────────────────────────────────────────


def _import_ossie(args: list[str]):
    return runner.invoke(app, ["context", "import", "ossie", *args])


def test_cli_import_ossie_scaffolds_project(tmp_path: Path):
    proj = tmp_path / "imported"
    result = _import_ossie(
        [
            "--file",
            str(_fixture("minimal.yaml")),
            "--data-source",
            "postgres",
            "--path",
            str(proj),
        ]
    )
    assert result.exit_code == 0, result.output
    assert "Imported Ossie semantic model" in result.output
    assert "2 models, 1 relationships" in result.output
    assert "wren context build --path" in result.output
    assert (proj / "wren_project.yml").exists()
    assert (proj / "models" / "orders" / "metadata.yml").exists()
    assert (proj / "models" / "customers" / "metadata.yml").exists()
    assert (proj / "relationships.yml").exists()
    assert (proj / "knowledge" / "rules" / "general.md").exists()
    assert (proj / "AGENTS.md").exists()
    import yaml as _yaml  # noqa: PLC0415

    cfg = _yaml.safe_load((proj / "wren_project.yml").read_text())
    assert cfg["name"] == "shop"
    assert cfg["data_source"] == "postgres"


def test_cli_import_ossie_matches_init_from_ossie(tmp_path: Path):
    """`import ossie` and `init --from-ossie` are the same conversion."""
    imported = tmp_path / "imported"
    migrated = tmp_path / "migrated"
    res = _import_ossie(
        [
            "--file",
            str(_fixture("minimal.yaml")),
            "--data-source",
            "postgres",
            "--path",
            str(imported),
        ]
    )
    assert res.exit_code == 0, res.output
    init = runner.invoke(
        app,
        [
            "context",
            "init",
            "--from-ossie",
            str(_fixture("minimal.yaml")),
            "--data-source",
            "postgres",
            "--path",
            str(migrated),
        ],
    )
    assert init.exit_code == 0, init.output

    imported_files = {
        f.relative_to(imported): f.read_text()
        for f in imported.rglob("*")
        if f.is_file()
    }
    migrated_files = {
        f.relative_to(migrated): f.read_text()
        for f in migrated.rglob("*")
        if f.is_file()
    }
    assert imported_files == migrated_files


def test_cli_import_ossie_then_build(tmp_path: Path):
    proj = tmp_path / "imported"
    res = _import_ossie(
        [
            "--file",
            str(_fixture("minimal.yaml")),
            "--data-source",
            "postgres",
            "--path",
            str(proj),
        ]
    )
    assert res.exit_code == 0, res.output
    build = runner.invoke(app, ["context", "build", "--path", str(proj)])
    assert build.exit_code == 0, build.output
    mdl = json.loads((proj / "target" / "mdl.json").read_text())
    assert {m["name"] for m in mdl["models"]} == {"orders", "customers"}
    assert len(mdl["relationships"]) == 1


def test_cli_import_ossie_dry_run_writes_nothing(tmp_path: Path):
    proj = tmp_path / "imported"
    result = _import_ossie(
        [
            "--file",
            str(_fixture("minimal.yaml")),
            "--data-source",
            "postgres",
            "--path",
            str(proj),
            "--dry-run",
        ]
    )
    assert result.exit_code == 0, result.output
    assert "Dry run" in result.output
    assert "wren_project.yml" in result.output
    assert "models/orders/metadata.yml" in result.output
    assert "relationships.yml" in result.output
    assert "2 models, 1 relationships" in result.output
    assert not proj.exists()


def test_cli_import_ossie_requires_file(tmp_path: Path):
    result = _import_ossie(["--data-source", "postgres", "--path", str(tmp_path)])
    assert result.exit_code == 1
    assert "--file is required" in result.output


def test_cli_import_ossie_requires_data_source(tmp_path: Path):
    result = _import_ossie(
        ["--file", str(_fixture("minimal.yaml")), "--path", str(tmp_path / "p")]
    )
    assert result.exit_code == 1
    assert "--data-source is required" in result.output
    assert "--from-ossie" not in result.output
    assert not (tmp_path / "p").exists()


def test_cli_import_ossie_missing_file(tmp_path: Path):
    result = _import_ossie(
        [
            "--file",
            str(tmp_path / "nope.yaml"),
            "--data-source",
            "postgres",
            "--path",
            str(tmp_path / "p"),
        ]
    )
    assert result.exit_code == 1
    assert "Ossie file not found" in result.output


def test_cli_import_ossie_aborts_on_hard_error(tmp_path: Path):
    bad = tmp_path / "bad.yaml"
    bad.write_text(
        "version: '0.1.1'\n"
        "semantic_model:\n"
        "  - name: broken\n"
        "    datasets:\n"
        "      - name: orders\n"
        "        fields:\n"
        "          - name: id\n"
    )
    proj = tmp_path / "p"
    result = _import_ossie(
        ["--file", str(bad), "--data-source", "postgres", "--path", str(proj)]
    )
    assert result.exit_code == 1
    assert "Import aborted due to Ossie errors." in result.output
    assert not proj.exists()


def test_cli_import_ossie_refuses_overwrite_without_force(tmp_path: Path):
    proj = tmp_path / "existing"
    proj.mkdir()
    (proj / "wren_project.yml").write_text("name: prior\n")
    result = _import_ossie(
        [
            "--file",
            str(_fixture("minimal.yaml")),
            "--data-source",
            "postgres",
            "--path",
            str(proj),
        ]
    )
    assert result.exit_code == 1
    assert "already exists" in result.output
    assert (proj / "wren_project.yml").read_text() == "name: prior\n"


def test_cli_import_ossie_force_overwrites(tmp_path: Path):
    """--force regenerates the managed layout, including a stale cubes/ dir."""
    proj = tmp_path / "existing"
    proj.mkdir()
    (proj / "wren_project.yml").write_text("name: prior\n")
    (proj / "cubes").mkdir()
    (proj / "cubes" / "stale.yml").write_text("name: stale\n")
    result = _import_ossie(
        [
            "--file",
            str(_fixture("minimal.yaml")),
            "--data-source",
            "postgres",
            "--path",
            str(proj),
            "--force",
        ]
    )
    assert result.exit_code == 0, result.output
    import yaml as _yaml  # noqa: PLC0415

    cfg = _yaml.safe_load((proj / "wren_project.yml").read_text())
    assert cfg["name"] == "shop"
    assert not (proj / "cubes" / "stale.yml").exists()


def test_cli_import_ossie_with_semantic_model_picks_one(tmp_path: Path):
    proj = tmp_path / "p"
    result = _import_ossie(
        [
            "--file",
            str(_fixture("multi_semantic_model.yaml")),
            "--data-source",
            "postgres",
            "--semantic-model",
            "model_a",
            "--path",
            str(proj),
        ]
    )
    assert result.exit_code == 0, result.output
    import yaml as _yaml  # noqa: PLC0415

    cfg = _yaml.safe_load((proj / "wren_project.yml").read_text())
    assert cfg["name"] == "model_a"


def test_cli_export_ossie_then_import_ossie_round_trips(tmp_path: Path):
    """export ossie → import ossie reproduces the models and relationships."""
    src = tmp_path / "src"
    first = _import_ossie(
        [
            "--file",
            str(_fixture("minimal.yaml")),
            "--data-source",
            "postgres",
            "--path",
            str(src),
        ]
    )
    assert first.exit_code == 0, first.output

    exported = tmp_path / "exported.yaml"
    export = runner.invoke(
        app,
        ["context", "export", "ossie", "--path", str(src), "--output", str(exported)],
    )
    assert export.exit_code == 0, export.output

    back = tmp_path / "back"
    second = _import_ossie(
        ["--file", str(exported), "--data-source", "postgres", "--path", str(back)]
    )
    assert second.exit_code == 0, second.output

    def _models(root: Path) -> dict[str, str]:
        return {
            f.parent.name: f.read_text()
            for f in (root / "models").rglob("metadata.yml")
        }

    assert _models(back) == _models(src)
    assert (back / "relationships.yml").read_text() == (
        src / "relationships.yml"
    ).read_text()
