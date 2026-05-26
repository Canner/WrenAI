"""Tests for OSI (Open Semantic Interchange) → Wren MDL conversion."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

from wren.cli import app
from wren.osi import (
    _extract_wren_block,
    _is_calculated_expression,
    _parse_source,
    _pick_expression,
    build_json_from_osi,
    build_manifest_from_osi,
    extract_wren_config,
    lint_osi_file,
    parse_osi,
    select_semantic_model,
)

# ── Fixtures ──────────────────────────────────────────────────────────────

FIXTURES = Path(__file__).parent.parent / "fixtures" / "osi"


def _fixture(name: str) -> Path:
    return FIXTURES / name


# ── Unit: parse_osi / select_semantic_model ───────────────────────────────


def test_parse_osi_yaml():
    osi = parse_osi('version: "0.2.0"\nsemantic_model: []\n')
    assert osi["version"] == "0.2.0"
    assert osi["semantic_model"] == []


def test_parse_osi_json():
    osi = parse_osi('{"version": "0.2.0", "semantic_model": []}', suffix=".json")
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


# ── Integration: build_manifest_from_osi on minimal fixture ──────────────


def test_build_minimal_clean_no_warnings():
    """Minimal fixture has WREN column_types for every dataset — no warnings."""
    manifest, errors = build_manifest_from_osi(
        _fixture("minimal.yaml"), data_source="postgres"
    )
    warnings = [e for e in errors if e.level == "warning"]
    assert errors == warnings, [str(e) for e in errors if e.level == "error"]
    # column_types covered every field, so no untyped warning
    assert not any("no type" in e.message for e in warnings)
    # single-dataset metrics don't fire cross-dataset warning
    assert not any("references 2 datasets" in e.message for e in warnings)


def test_build_minimal_structure():
    manifest, _ = build_manifest_from_osi(
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
    manifest, _ = build_manifest_from_osi(
        _fixture("minimal.yaml"), data_source="postgres"
    )
    customers = next(m for m in manifest["models"] if m["name"] == "customers")
    full_name = next(c for c in customers["columns"] if c["name"] == "full_name")
    assert full_name["is_calculated"] is True
    assert "first_name" in full_name["expression"]
    assert full_name["type"] == "VARCHAR"  # from field-level WREN block


def test_build_minimal_relationship_condition():
    manifest, _ = build_manifest_from_osi(
        _fixture("minimal.yaml"), data_source="postgres"
    )
    rel = manifest["relationships"][0]
    assert rel["name"] == "orders_to_customers"
    assert rel["join_type"] == "MANY_TO_ONE"
    assert rel["models"] == ["orders", "customers"]
    assert rel["condition"] == "orders.customer_id = customers.customer_id"


def test_build_minimal_instructions_include_metrics():
    manifest, _ = build_manifest_from_osi(
        _fixture("minimal.yaml"), data_source="postgres"
    )
    instr = manifest.get("_instructions", "")
    assert "Shop analytics model" in instr  # from ai_context.instructions
    assert "total_revenue" in instr  # from metrics-as-notes


# ── Integration: build_json_from_osi (camelCase + layoutVersion) ──────────


def test_build_json_emits_camel_case_and_layout_version():
    json_manifest, _ = build_json_from_osi(
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
    json_manifest, _ = build_json_from_osi(
        _fixture("minimal.yaml"), data_source="postgres"
    )
    assert "_instructions" in json_manifest
    assert "Instructions" not in json_manifest  # the bug we're guarding against
    assert "Shop analytics model" in json_manifest["_instructions"]


# ── Integration: TPC-DS full fixture (exercises every warning path) ───────


def test_build_tpcds_full_runs():
    manifest, errors = build_manifest_from_osi(
        _fixture("tpcds_full.yaml"), data_source="postgres"
    )
    hard = [e for e in errors if e.level == "error"]
    assert hard == [], [str(e) for e in hard]
    assert len(manifest["models"]) == 5
    assert len(manifest["relationships"]) == 4


def test_build_tpcds_composite_pk_warning():
    """store_sales has composite PK [ss_item_sk, ss_ticket_number]."""
    _, errors = build_manifest_from_osi(
        _fixture("tpcds_full.yaml"), data_source="postgres"
    )
    composite_warns = [e for e in errors if "composite primary_key" in e.message]
    assert len(composite_warns) == 1
    assert "store_sales" in composite_warns[0].path
    # Snippet must guide the user to override
    assert 'data: \'{"primary_key"' in composite_warns[0].message


def test_build_tpcds_untyped_field_warnings_include_snippets():
    """No WREN column_types provided → every dataset triggers a typed warning
    with a copy-pasteable snippet."""
    _, errors = build_manifest_from_osi(
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
    _, errors = build_manifest_from_osi(
        _fixture("tpcds_full.yaml"), data_source="postgres"
    )
    cross = [e for e in errors if "references 2 datasets" in e.message]
    assert len(cross) == 2
    names = " ".join(e.path for e in cross)
    assert "customer_lifetime_value" in names
    assert "store_productivity" in names


def test_build_tpcds_time_dimension_inferred_as_timestamp():
    """date_dim has dimension.is_time fields — should default to TIMESTAMP, not VARCHAR."""
    manifest, _ = build_manifest_from_osi(
        _fixture("tpcds_full.yaml"), data_source="postgres"
    )
    date_dim = next(m for m in manifest["models"] if m["name"] == "date_dim")
    d_year = next(c for c in date_dim["columns"] if c["name"] == "d_year")
    assert d_year["type"] == "TIMESTAMP"


# ── Integration: ref_sql source detection ────────────────────────────────


def test_ref_sql_source_detected():
    manifest, errors = build_manifest_from_osi(
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
    _, errors = build_manifest_from_osi(
        _fixture("multi_semantic_model.yaml"), data_source="postgres"
    )
    hard = [e for e in errors if e.level == "error"]
    assert hard, "should error when multiple semantic_models and none picked"
    assert any("2 semantic_models" in e.message for e in hard)


def test_multi_semantic_model_with_flag_succeeds():
    manifest, errors = build_manifest_from_osi(
        _fixture("multi_semantic_model.yaml"),
        data_source="postgres",
        semantic_model="model_b",
    )
    hard = [e for e in errors if e.level == "error"]
    assert hard == [], [str(e) for e in hard]
    assert manifest["models"][0]["name"] == "t2"


# ── Integration: lint_osi_file ─────────────────────────────────────────────


def test_lint_missing_data_source_errors():
    errors = lint_osi_file(_fixture("minimal.yaml"), data_source=None)
    assert errors and errors[0].level == "error"
    assert "--data-source" in errors[0].message


def test_lint_missing_file_errors(tmp_path):
    errors = lint_osi_file(tmp_path / "nonexistent.yaml", data_source="postgres")
    assert errors and errors[0].level == "error"
    assert "not found" in errors[0].message


def test_lint_minimal_clean():
    errors = lint_osi_file(_fixture("minimal.yaml"), data_source="postgres")
    hard = [e for e in errors if e.level == "error"]
    assert hard == []


# ── Regression: malformed inputs surface as ValidationError ──────────────


def test_build_manifest_malformed_yaml_returns_error(tmp_path: Path):
    """Broken YAML must produce a structured error, not a raw exception."""
    p = tmp_path / "bad.yaml"
    p.write_text("semantic_model: [\n")  # unterminated flow sequence
    manifest, errors = build_manifest_from_osi(p, data_source="postgres")
    assert manifest == {}
    assert any(e.level == "error" for e in errors)
    assert any("failed to read OSI file" in e.message for e in errors)


def test_lint_malformed_yaml_does_not_raise(tmp_path: Path):
    """lint_osi_file likewise reports parse failure cleanly."""
    p = tmp_path / "bad.yaml"
    p.write_text("not: [a, b,")
    errors = lint_osi_file(p, data_source="postgres")
    assert errors and errors[0].level == "error"
    assert "failed to read OSI file" in errors[0].message


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
    _, errors = build_manifest_from_osi(p, data_source="postgres")
    rel_errs = [e for e in errors if "relationship 'a_to_b'" in e.path]
    assert rel_errs and rel_errs[0].level == "error"
    assert "non-empty strings" in rel_errs[0].message


# ── CLI integration ──────────────────────────────────────────────────────


runner = CliRunner()


def test_cli_build_from_osi(tmp_path: Path):
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
    assert out.exists()
    data = json.loads(out.read_text())
    assert data["dataSource"] == "postgres"
    assert data["layoutVersion"] == 2
    assert {m["name"] for m in data["models"]} == {"orders", "customers"}


def test_cli_build_from_osi_requires_data_source(tmp_path: Path):
    result = runner.invoke(
        app,
        [
            "context",
            "build",
            "--from-osi",
            str(_fixture("minimal.yaml")),
            "--output",
            str(tmp_path / "mdl.json"),
        ],
    )
    assert result.exit_code == 1
    assert "--data-source" in result.output


def test_cli_build_from_osi_missing_file(tmp_path: Path):
    result = runner.invoke(
        app,
        [
            "context",
            "build",
            "--from-osi",
            str(tmp_path / "nonexistent.yaml"),
            "--data-source",
            "postgres",
        ],
    )
    assert result.exit_code == 1
    assert "not found" in result.output


def test_cli_build_from_osi_aborts_on_hard_error(tmp_path: Path):
    """multi-semantic_model without --semantic-model should hard-error."""
    result = runner.invoke(
        app,
        [
            "context",
            "build",
            "--from-osi",
            str(_fixture("multi_semantic_model.yaml")),
            "--data-source",
            "postgres",
            "--output",
            str(tmp_path / "mdl.json"),
        ],
    )
    assert result.exit_code == 1
    assert "semantic_models" in result.output


def test_cli_validate_from_osi_clean():
    result = runner.invoke(
        app,
        [
            "context",
            "validate",
            "--from-osi",
            str(_fixture("minimal.yaml")),
            "--data-source",
            "postgres",
        ],
    )
    assert result.exit_code == 0, result.output
    assert "Valid" in result.output


def test_cli_validate_from_osi_surfaces_warnings():
    """TPC-DS fixture has no WREN column_types → warnings printed."""
    result = runner.invoke(
        app,
        [
            "context",
            "validate",
            "--from-osi",
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


def test_cli_validate_from_osi_strict_fails_on_warning():
    result = runner.invoke(
        app,
        [
            "context",
            "validate",
            "--from-osi",
            str(_fixture("tpcds_full.yaml")),
            "--data-source",
            "postgres",
            "--strict",
        ],
    )
    assert result.exit_code == 1


def test_cli_show_from_osi_summary():
    result = runner.invoke(
        app,
        [
            "context",
            "show",
            "--from-osi",
            str(_fixture("minimal.yaml")),
            "--data-source",
            "postgres",
        ],
    )
    assert result.exit_code == 0, result.output
    assert "orders" in result.output
    assert "customers" in result.output
    assert "MANY_TO_ONE" in result.output


def test_cli_show_from_osi_json():
    result = runner.invoke(
        app,
        [
            "context",
            "show",
            "--from-osi",
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
    # snake→camel pass, same as build_json_from_osi.
    assert "_instructions" in data
    assert "Instructions" not in data
    assert "Shop analytics model" in data["_instructions"]


# ── CLI: init --from-osi (one-way migration) ─────────────────────────────


def test_cli_init_from_osi_scaffolds_project(tmp_path: Path):
    """OSI → wren project layout, ready for the standard build flow."""
    proj = tmp_path / "migrated"
    result = runner.invoke(
        app,
        [
            "context",
            "init",
            "--from-osi",
            str(_fixture("minimal.yaml")),
            "--data-source",
            "postgres",
            "--path",
            str(proj),
        ],
    )
    assert result.exit_code == 0, result.output
    assert "Migrated OSI" in result.output
    # Standard wren project layout
    assert (proj / "wren_project.yml").exists()
    assert (proj / "models" / "orders" / "metadata.yml").exists()
    assert (proj / "models" / "customers" / "metadata.yml").exists()
    assert (proj / "relationships.yml").exists()
    assert (proj / "instructions.md").exists()
    assert (proj / "AGENTS.md").exists()
    # The OSI semantic_model.name flowed into wren_project.yml
    import yaml as _yaml  # noqa: PLC0415

    cfg = _yaml.safe_load((proj / "wren_project.yml").read_text())
    assert cfg["name"] == "shop"
    assert cfg["data_source"] == "postgres"


def test_cli_init_from_osi_roundtrip_matches_direct_build(tmp_path: Path):
    """init --from-osi then context build should produce a manifest with the
    same models / relationships as a direct build --from-osi."""
    proj = tmp_path / "migrated"
    _invoke = lambda args: runner.invoke(app, args)  # noqa: E731

    init = _invoke(
        [
            "context",
            "init",
            "--from-osi",
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
            "--from-osi",
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


def test_cli_init_from_osi_requires_data_source(tmp_path: Path):
    result = runner.invoke(
        app,
        [
            "context",
            "init",
            "--from-osi",
            str(_fixture("minimal.yaml")),
            "--path",
            str(tmp_path / "p"),
        ],
    )
    assert result.exit_code == 1
    assert "--data-source" in result.output


def test_cli_init_from_osi_missing_file(tmp_path: Path):
    result = runner.invoke(
        app,
        [
            "context",
            "init",
            "--from-osi",
            str(tmp_path / "nonexistent.yaml"),
            "--data-source",
            "postgres",
            "--path",
            str(tmp_path / "p"),
        ],
    )
    assert result.exit_code == 1
    assert "not found" in result.output


def test_cli_init_from_osi_mutually_exclusive_with_from_mdl(tmp_path: Path):
    """--from-mdl and --from-osi cannot be combined — bail before either runs."""
    fake_mdl = tmp_path / "fake.json"
    fake_mdl.write_text("{}")
    result = runner.invoke(
        app,
        [
            "context",
            "init",
            "--from-mdl",
            str(fake_mdl),
            "--from-osi",
            str(_fixture("minimal.yaml")),
            "--data-source",
            "postgres",
            "--path",
            str(tmp_path / "p"),
        ],
    )
    assert result.exit_code == 1
    assert "mutually exclusive" in result.output


def test_cli_init_from_osi_refuses_overwrite_without_force(tmp_path: Path):
    """Without --force, an existing wren_project.yml blocks the migration."""
    proj = tmp_path / "existing"
    proj.mkdir()
    (proj / "wren_project.yml").write_text("name: prior\n")
    result = runner.invoke(
        app,
        [
            "context",
            "init",
            "--from-osi",
            str(_fixture("minimal.yaml")),
            "--data-source",
            "postgres",
            "--path",
            str(proj),
        ],
    )
    assert result.exit_code == 1
    assert "already exists" in result.output


def test_cli_init_from_osi_force_overwrites(tmp_path: Path):
    proj = tmp_path / "existing"
    proj.mkdir()
    (proj / "wren_project.yml").write_text("name: prior\n")
    result = runner.invoke(
        app,
        [
            "context",
            "init",
            "--from-osi",
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


def test_cli_init_from_osi_aborts_on_hard_error(tmp_path: Path):
    """Ambiguous semantic_model selection is a hard error — migration must
    bail without touching the target directory."""
    proj = tmp_path / "p"
    result = runner.invoke(
        app,
        [
            "context",
            "init",
            "--from-osi",
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


def test_cli_init_from_osi_with_semantic_model_picks_one(tmp_path: Path):
    proj = tmp_path / "migrated_b"
    result = runner.invoke(
        app,
        [
            "context",
            "init",
            "--from-osi",
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
