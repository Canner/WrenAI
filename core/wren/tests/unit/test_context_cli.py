"""Integration tests for the `wren context` CLI sub-app."""

from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

from wren.cli import app

runner = CliRunner()


# ── Helpers ────────────────────────────────────────────────────────────────


def _make_valid_project(tmp_path: Path) -> Path:
    """Write a minimal valid v2 project in tmp_path."""
    (tmp_path / "wren_project.yml").write_text(
        'schema_version: 2\nname: test_proj\nversion: "1.0"\n'
        "catalog: wren\nschema: public\ndata_source: postgres\n"
    )
    model_dir = tmp_path / "models" / "orders"
    model_dir.mkdir(parents=True)
    (model_dir / "metadata.yml").write_text(
        "name: orders\n"
        'table_reference:\n  catalog: ""\n  schema: public\n  table: orders\n'
        "columns:\n"
        "  - name: id\n    type: INTEGER\n    is_calculated: false\n    not_null: true\n    properties: {}\n"
        "  - name: total\n    type: DECIMAL\n    is_calculated: false\n    not_null: false\n    properties: {}\n"
        "primary_key: id\ncached: false\nproperties:\n  description: Orders table\n"
    )
    view_dir = tmp_path / "views" / "summary"
    view_dir.mkdir(parents=True)
    (view_dir / "metadata.yml").write_text(
        "name: summary\nproperties:\n  description: test view\n"
    )
    (view_dir / "sql.yml").write_text(
        "statement: SELECT id, total FROM wren.public.orders\n"
    )
    (tmp_path / "relationships.yml").write_text("relationships: []\n")
    return tmp_path


# ── wren context init ─────────────────────────────────────────────────────


def test_init_creates_scaffold(tmp_path):
    result = runner.invoke(app, ["context", "init", "--path", str(tmp_path)])
    assert result.exit_code == 0, result.output
    assert (tmp_path / "wren_project.yml").exists()
    assert (tmp_path / "models" / "example" / "metadata.yml").exists()
    assert (tmp_path / "views" / "example_view" / "metadata.yml").exists()
    assert (tmp_path / "views" / "example_view" / "sql.yml").exists()
    assert (tmp_path / "relationships.yml").exists()
    assert (tmp_path / "instructions.md").exists()

    # Verify wren_project.yml contains namespace clarification comments and defaults
    project_yml = (tmp_path / "wren_project.yml").read_text()
    assert "catalog: wren" in project_yml
    assert "schema: public" in project_yml
    assert "data_source: postgres" in project_yml
    assert "NOT your database" in project_yml

    # Verify example model metadata contains table_reference annotation
    model_meta = (tmp_path / "models" / "example" / "metadata.yml").read_text()
    assert "table_reference" in model_meta
    assert "ACTUAL database" in model_meta


def test_init_refuses_existing(tmp_path):
    (tmp_path / "wren_project.yml").write_text("name: existing\n")
    result = runner.invoke(app, ["context", "init", "--path", str(tmp_path)])
    assert result.exit_code == 1
    assert "already exists" in result.output


def test_print_warnings_collapses_beyond_threshold(capsys):
    """Noisy "missing description" lists collapse into grouped counts."""
    from wren import context_cli  # noqa: PLC0415

    # 15 "missing description" + 3 "missing primary_key" — total 18,
    # comfortably above the summary threshold of 10.
    warnings = [
        f"model 'orders_{i}': missing description" for i in range(15)
    ] + [f"model 'log_{i}': missing primary_key" for i in range(3)]

    context_cli._print_warnings(warnings, verbose=False)
    out = capsys.readouterr().out

    # Summary line mentions the total and hint
    assert "Warnings: 18 total" in out
    assert "--verbose" in out

    # Individual models collapsed away
    for i in range(15):
        assert f"orders_{i}" not in out

    # Exactly two category buckets (not 18 unique lines)
    assert "missing description: 15" in out
    assert "missing primary_key: 3" in out


def test_print_warnings_verbose_prints_every_line(capsys):
    from wren import context_cli  # noqa: PLC0415

    warnings = [f"model 'orders_{i}': missing description" for i in range(15)]
    context_cli._print_warnings(warnings, verbose=True)
    out = capsys.readouterr().out
    for i in range(15):
        assert f"orders_{i}" in out
    assert "15 warning(s)" in out


def test_print_warnings_below_threshold_prints_each(capsys):
    from wren import context_cli  # noqa: PLC0415

    warnings = [f"model 'orders_{i}': missing description" for i in range(3)]
    context_cli._print_warnings(warnings, verbose=False)
    out = capsys.readouterr().out
    for i in range(3):
        assert f"orders_{i}" in out


def test_init_empty_skips_example_model_and_view(tmp_path):
    result = runner.invoke(
        app, ["context", "init", "--path", str(tmp_path), "--empty"]
    )
    assert result.exit_code == 0, result.output
    # Directories exist but are empty
    assert (tmp_path / "models").is_dir()
    assert (tmp_path / "views").is_dir()
    assert list((tmp_path / "models").iterdir()) == []
    assert list((tmp_path / "views").iterdir()) == []
    # Other scaffold files are still produced
    assert (tmp_path / "wren_project.yml").exists()
    assert (tmp_path / "relationships.yml").exists()
    assert (tmp_path / "AGENTS.md").exists()
    assert (tmp_path / "queries.yml").exists()
    # Summary mentions empty rather than the example paths
    assert "empty" in result.output


# ── wren context validate ─────────────────────────────────────────────────


def test_validate_pass(tmp_path):
    _make_valid_project(tmp_path)
    result = runner.invoke(app, ["context", "validate", "--path", str(tmp_path)])
    assert result.exit_code == 0, result.output
    assert "Valid" in result.output


def test_validate_fail(tmp_path):
    # Missing data_source in project config
    (tmp_path / "wren_project.yml").write_text("schema_version: 2\nname: broken\n")
    result = runner.invoke(app, ["context", "validate", "--path", str(tmp_path)])
    assert result.exit_code == 1
    assert "ERROR" in result.output


def test_validate_strict_warns(tmp_path):
    _make_valid_project(tmp_path)
    # Add a relationship with missing join_type (warning)
    (tmp_path / "relationships.yml").write_text(
        "relationships:\n  - name: r\n    models: [orders]\n    condition: a = b\n"
    )
    # Without --strict: exit 0
    result = runner.invoke(app, ["context", "validate", "--path", str(tmp_path)])
    assert result.exit_code == 0

    # With --strict: exit 1
    result = runner.invoke(
        app, ["context", "validate", "--path", str(tmp_path), "--strict"]
    )
    assert result.exit_code == 1


# ── wren context build ────────────────────────────────────────────────────


def test_build_creates_target(tmp_path):
    _make_valid_project(tmp_path)
    result = runner.invoke(app, ["context", "build", "--path", str(tmp_path)])
    assert result.exit_code == 0, result.output
    out_file = tmp_path / "target" / "mdl.json"
    assert out_file.exists()
    data = json.loads(out_file.read_text())
    assert data["catalog"] == "wren"
    assert data["models"][0]["tableReference"]["table"] == "orders"


def test_build_validation_error(tmp_path):
    # Model with both table_reference and ref_sql
    (tmp_path / "wren_project.yml").write_text(
        "schema_version: 2\nname: test\ndata_source: postgres\ncatalog: wren\nschema: public\n"
    )
    d = tmp_path / "models" / "bad"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text(
        "name: bad\ntable_reference:\n  table: t\nref_sql: SELECT 1\ncolumns: []\n"
    )
    result = runner.invoke(app, ["context", "build", "--path", str(tmp_path)])
    assert result.exit_code == 1
    assert "aborted" in result.output


def test_build_no_validate(tmp_path):
    # Model with neither tref nor ref_sql — would normally fail validation
    (tmp_path / "wren_project.yml").write_text(
        "schema_version: 2\nname: test\ndata_source: postgres\ncatalog: wren\nschema: public\n"
    )
    d = tmp_path / "models" / "empty_model"
    d.mkdir(parents=True)
    (d / "metadata.yml").write_text("name: empty_model\ncolumns: []\n")
    result = runner.invoke(
        app, ["context", "build", "--path", str(tmp_path), "--no-validate"]
    )
    assert result.exit_code == 0
    out_file = tmp_path / "target" / "mdl.json"
    assert out_file.exists()


# ── wren context show ─────────────────────────────────────────────────────


def test_show_summary(tmp_path):
    _make_valid_project(tmp_path)
    result = runner.invoke(app, ["context", "show", "--path", str(tmp_path)])
    assert result.exit_code == 0, result.output
    assert "test_proj" in result.output
    assert "orders" in result.output


def test_show_json(tmp_path):
    _make_valid_project(tmp_path)
    result = runner.invoke(
        app, ["context", "show", "--path", str(tmp_path), "--output", "json"]
    )
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)
    assert "models" in data
    assert data["models"][0]["tableReference"]["table"] == "orders"


def test_show_yaml(tmp_path):
    _make_valid_project(tmp_path)
    result = runner.invoke(
        app, ["context", "show", "--path", str(tmp_path), "--output", "yaml"]
    )
    assert result.exit_code == 0, result.output
    import yaml  # noqa: PLC0415

    data = yaml.safe_load(result.output)
    assert "models" in data


# ── wren context instructions ─────────────────────────────────────────────


def test_instructions_prints_content(tmp_path):
    _make_valid_project(tmp_path)
    (tmp_path / "instructions.md").write_text("## Rule 1\nAlways use UTC.\n")
    result = runner.invoke(app, ["context", "instructions", "--path", str(tmp_path)])
    assert result.exit_code == 0, result.output
    assert "Rule 1" in result.output
    assert "UTC" in result.output


def test_instructions_empty_when_missing(tmp_path):
    _make_valid_project(tmp_path)
    result = runner.invoke(app, ["context", "instructions", "--path", str(tmp_path)])
    assert result.exit_code == 0
    assert result.output.strip() == ""


def test_instructions_discovers_project(tmp_path):
    _make_valid_project(tmp_path)
    (tmp_path / "instructions.md").write_text("custom rule here")
    result = runner.invoke(app, ["context", "instructions", "--path", str(tmp_path)])
    assert result.exit_code == 0
    assert "custom rule here" in result.output


# ── wren context upgrade ─────────────────────────────────────────────────


def _make_v1_project(tmp_path: Path) -> Path:
    (tmp_path / "wren_project.yml").write_text(
        "schema_version: 1\nname: test\ndata_source: postgres\ncatalog: wren\nschema: public\n"
    )
    models_dir = tmp_path / "models"
    models_dir.mkdir()
    (models_dir / "orders.yml").write_text(
        "name: orders\ntable_reference:\n  table: orders\n"
        "columns:\n  - name: id\n    type: INTEGER\nprimary_key: id\n"
    )
    (tmp_path / "relationships.yml").write_text("relationships: []\n")
    return tmp_path


def test_upgrade_cli_v2_to_v3(tmp_path):
    _make_valid_project(tmp_path)
    result = runner.invoke(app, ["context", "upgrade", "--path", str(tmp_path)])
    assert result.exit_code == 0, result.output
    assert "Upgrade complete" in result.output
    import yaml

    config = yaml.safe_load((tmp_path / "wren_project.yml").read_text())
    assert config["schema_version"] == 3


def test_upgrade_cli_dry_run(tmp_path):
    _make_v1_project(tmp_path)
    result = runner.invoke(
        app, ["context", "upgrade", "--path", str(tmp_path), "--dry-run"]
    )
    assert result.exit_code == 0, result.output
    assert "Dry run" in result.output
    assert "Would create" in result.output
    # Verify no files were actually changed
    assert not (tmp_path / "models" / "orders" / "metadata.yml").exists()
    import yaml

    config = yaml.safe_load((tmp_path / "wren_project.yml").read_text())
    assert config["schema_version"] == 1


def test_upgrade_cli_already_current(tmp_path):
    (tmp_path / "wren_project.yml").write_text(
        "schema_version: 3\nname: test\ndata_source: postgres\n"
    )
    result = runner.invoke(app, ["context", "upgrade", "--path", str(tmp_path)])
    assert result.exit_code == 0
    assert "Already at" in result.output


def test_upgrade_cli_explicit_to_version(tmp_path):
    _make_v1_project(tmp_path)
    result = runner.invoke(
        app, ["context", "upgrade", "--path", str(tmp_path), "--to", "2"]
    )
    assert result.exit_code == 0, result.output
    assert "Upgrade complete" in result.output
    import yaml

    config = yaml.safe_load((tmp_path / "wren_project.yml").read_text())
    assert config["schema_version"] == 2


# ── wren context set-profile ──────────────────────────────────────────────


def _isolate_profiles(home_dir: Path, monkeypatch) -> None:
    """Redirect ~/.wren profile I/O to ``home_dir`` for the duration of a test."""
    import wren.profile as profile_mod  # noqa: PLC0415

    home_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(profile_mod, "_WREN_HOME", home_dir)
    monkeypatch.setattr(profile_mod, "_PROFILES_FILE", home_dir / "profiles.yml")


def _invoke_ok(args):
    """Run the CLI and assert exit_code 0. Use for setup invocations so a
    failed scaffold/init is surfaced immediately instead of masking the
    real assertion failure later in the test."""
    result = runner.invoke(app, args)
    assert result.exit_code == 0, result.output
    return result


def test_set_profile_writes_profile_field(tmp_path, monkeypatch):
    import wren.profile as profile_mod  # noqa: PLC0415

    _isolate_profiles(tmp_path / "wren-home", monkeypatch)
    profile_mod.add_profile("loans_local", {"datasource": "duckdb"})

    proj = tmp_path / "myproj"
    _invoke_ok(["context", "init", "--empty", "--path", str(proj)])

    result = runner.invoke(
        app, ["context", "set-profile", "loans_local", "--path", str(proj)]
    )
    assert result.exit_code == 0, result.output

    import yaml  # noqa: PLC0415

    config = yaml.safe_load((proj / "wren_project.yml").read_text())
    assert config["profile"] == "loans_local"
    assert config["data_source"] == "duckdb"


def test_set_profile_overwrites_placeholder_data_source(tmp_path, monkeypatch):
    """init writes `data_source: postgres` placeholder; set-profile overwrites it
    with the bound profile's datasource (no --force needed for first bind)."""
    import wren.profile as profile_mod  # noqa: PLC0415

    _isolate_profiles(tmp_path / "wren-home", monkeypatch)
    profile_mod.add_profile("duck_one", {"datasource": "duckdb"})

    proj = tmp_path / "myproj"
    _invoke_ok(["context", "init", "--empty", "--path", str(proj)])

    result = runner.invoke(
        app, ["context", "set-profile", "duck_one", "--path", str(proj)]
    )
    assert result.exit_code == 0, result.output

    import yaml  # noqa: PLC0415

    config = yaml.safe_load((proj / "wren_project.yml").read_text())
    assert config["data_source"] == "duckdb"


def test_set_profile_rebind_overwrites(tmp_path, monkeypatch):
    """Re-binding from X to Y: both profile and data_source update."""
    import wren.profile as profile_mod  # noqa: PLC0415

    _isolate_profiles(tmp_path / "wren-home", monkeypatch)
    profile_mod.add_profile("X", {"datasource": "postgres"})
    profile_mod.add_profile("Y", {"datasource": "duckdb"})

    proj = tmp_path / "myproj"
    _invoke_ok(["context", "init", "--empty", "--path", str(proj)])
    _invoke_ok(["context", "set-profile", "X", "--path", str(proj)])

    result = runner.invoke(
        app, ["context", "set-profile", "Y", "--path", str(proj)]
    )
    assert result.exit_code == 0, result.output

    import yaml  # noqa: PLC0415

    config = yaml.safe_load((proj / "wren_project.yml").read_text())
    assert config["profile"] == "Y"
    assert config["data_source"] == "duckdb"


def test_set_profile_errors_when_profile_not_found(tmp_path, monkeypatch):
    import wren.profile as profile_mod  # noqa: PLC0415

    _isolate_profiles(tmp_path / "wren-home", monkeypatch)
    profile_mod.add_profile("real", {"datasource": "duckdb"})

    proj = tmp_path / "myproj"
    _invoke_ok(["context", "init", "--empty", "--path", str(proj)])

    result = runner.invoke(
        app, ["context", "set-profile", "ghost", "--path", str(proj)]
    )
    assert result.exit_code != 0
    assert "ghost" in result.output
    assert "real" in result.output  # available profiles listed in error


def test_set_profile_errors_cleanly_when_list_profiles_fails(
    tmp_path, monkeypatch
):
    """If list_profiles() raises (e.g. malformed profiles.yml), set-profile
    should exit cleanly with an error message — not crash with a traceback."""
    proj = tmp_path / "myproj"
    _invoke_ok(["context", "init", "--empty", "--path", str(proj)])

    import wren.profile as profile_mod  # noqa: PLC0415

    def _broken(*_args, **_kwargs):
        raise OSError("simulated permission denied")

    monkeypatch.setattr(profile_mod, "list_profiles", _broken)

    result = runner.invoke(
        app, ["context", "set-profile", "anything", "--path", str(proj)]
    )
    assert result.exit_code != 0
    assert not isinstance(result.exception, OSError), (
        f"OSError leaked from list_profiles(): {result.exception!r}"
    )


def test_set_profile_errors_cleanly_when_save_fails(tmp_path, monkeypatch):
    """If save_project_config() fails (disk full / permission denied),
    set-profile should exit with a clean error rather than a traceback."""
    import wren.profile as profile_mod  # noqa: PLC0415

    _isolate_profiles(tmp_path / "wren-home", monkeypatch)
    profile_mod.add_profile("real", {"datasource": "duckdb"})

    proj = tmp_path / "myproj"
    _invoke_ok(["context", "init", "--empty", "--path", str(proj)])

    import wren.context as context_mod  # noqa: PLC0415

    def _broken_save(*_args, **_kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(context_mod, "save_project_config", _broken_save)

    result = runner.invoke(
        app, ["context", "set-profile", "real", "--path", str(proj)]
    )
    assert result.exit_code != 0
    assert not isinstance(result.exception, OSError), (
        f"OSError leaked from save_project_config(): {result.exception!r}"
    )


def test_set_profile_errors_when_profile_has_no_datasource(tmp_path, monkeypatch):
    """The third validation gate in set_profile — profile exists but has
    no datasource field — exits non-zero with a helpful message."""
    import wren.profile as profile_mod  # noqa: PLC0415

    _isolate_profiles(tmp_path / "wren-home", monkeypatch)
    profile_mod.add_profile("incomplete", {})  # no datasource key

    proj = tmp_path / "myproj"
    _invoke_ok(["context", "init", "--empty", "--path", str(proj)])

    result = runner.invoke(
        app, ["context", "set-profile", "incomplete", "--path", str(proj)]
    )
    assert result.exit_code != 0
    assert "datasource" in result.output.lower()


def test_set_profile_errors_when_no_project(tmp_path, monkeypatch):
    import wren.profile as profile_mod  # noqa: PLC0415

    _isolate_profiles(tmp_path / "wren-home", monkeypatch)
    profile_mod.add_profile("real", {"datasource": "duckdb"})

    empty_dir = tmp_path / "no-project"
    empty_dir.mkdir()

    result = runner.invoke(
        app, ["context", "set-profile", "real", "--path", str(empty_dir)]
    )
    assert result.exit_code != 0
    assert "wren_project.yml" in result.output


def test_set_profile_preserves_other_fields(tmp_path, monkeypatch):
    """Binding doesn't touch unrelated fields (name, catalog, schema, schema_version)."""
    import wren.profile as profile_mod  # noqa: PLC0415

    _isolate_profiles(tmp_path / "wren-home", monkeypatch)
    profile_mod.add_profile("duck", {"datasource": "duckdb"})

    proj = tmp_path / "myproj"
    _invoke_ok(["context", "init", "--empty", "--path", str(proj)])

    result = runner.invoke(
        app, ["context", "set-profile", "duck", "--path", str(proj)]
    )
    assert result.exit_code == 0, result.output

    import yaml  # noqa: PLC0415

    config = yaml.safe_load((proj / "wren_project.yml").read_text())
    assert config["name"] == "my_project"
    assert config["catalog"] == "wren"
    assert config["schema"] == "public"
    assert config["schema_version"] == 3


def test_set_profile_preserves_custom_fields(tmp_path, monkeypatch):
    """Unknown / custom fields in wren_project.yml must survive set-profile.
    save_project_config appends out-of-order keys at the end; this test
    locks that contract so a future shuffle of _PROJECT_FIELD_ORDER can't
    silently drop user-added metadata."""
    import wren.profile as profile_mod  # noqa: PLC0415

    _isolate_profiles(tmp_path / "wren-home", monkeypatch)
    profile_mod.add_profile("duck", {"datasource": "duckdb"})

    proj = tmp_path / "myproj"
    _invoke_ok(["context", "init", "--empty", "--path", str(proj)])

    # Inject a custom field the CLI doesn't know about
    import yaml  # noqa: PLC0415

    config = yaml.safe_load((proj / "wren_project.yml").read_text())
    config["tags"] = ["analytics", "experimental"]
    config["owner"] = "data-platform"
    (proj / "wren_project.yml").write_text(yaml.safe_dump(config))

    result = runner.invoke(
        app, ["context", "set-profile", "duck", "--path", str(proj)]
    )
    assert result.exit_code == 0, result.output

    # Round-trip: custom keys survive the rewrite
    config_after = yaml.safe_load((proj / "wren_project.yml").read_text())
    assert config_after["tags"] == ["analytics", "experimental"]
    assert config_after["owner"] == "data-platform"
    # And the binding fields landed correctly
    assert config_after["profile"] == "duck"
    assert config_after["data_source"] == "duckdb"


def test_set_profile_warns_about_stale_mdl_when_datasource_changes(
    tmp_path, monkeypatch
):
    """Re-binding to a profile with a different datasource leaves
    target/mdl.json built for the old dialect. Surface that risk so the
    user knows to rebuild before querying."""
    import wren.profile as profile_mod  # noqa: PLC0415

    _isolate_profiles(tmp_path / "wren-home", monkeypatch)
    profile_mod.add_profile("ds_pg", {"datasource": "postgres"})
    profile_mod.add_profile("ds_duck", {"datasource": "duckdb"})

    proj = tmp_path / "myproj"
    _invoke_ok(["context", "init", "--empty", "--path", str(proj)])
    _invoke_ok(["context", "set-profile", "ds_pg", "--path", str(proj)])

    # Simulate that the user has built MDL against the previous dialect.
    target = proj / "target"
    target.mkdir(exist_ok=True)
    (target / "mdl.json").write_text("{}")

    result = runner.invoke(
        app, ["context", "set-profile", "ds_duck", "--path", str(proj)]
    )
    assert result.exit_code == 0, result.output
    assert "wren context build" in result.output
    # Mention either the old dialect or the word 'rebuild'/'regenerate' so
    # the warning context is clear.
    msg = result.output.lower()
    assert "postgres" in msg or "rebuild" in msg or "regenerate" in msg


def test_set_profile_no_stale_mdl_warning_when_datasource_unchanged(
    tmp_path, monkeypatch
):
    """If datasource doesn't change on rebind, the stale-MDL warning
    shouldn't appear — there's no actual stale state."""
    import wren.profile as profile_mod  # noqa: PLC0415

    _isolate_profiles(tmp_path / "wren-home", monkeypatch)
    profile_mod.add_profile("a", {"datasource": "duckdb"})
    profile_mod.add_profile("b", {"datasource": "duckdb"})

    proj = tmp_path / "myproj"
    _invoke_ok(["context", "init", "--empty", "--path", str(proj)])
    _invoke_ok(["context", "set-profile", "a", "--path", str(proj)])

    target = proj / "target"
    target.mkdir(exist_ok=True)
    (target / "mdl.json").write_text("{}")

    result = runner.invoke(
        app, ["context", "set-profile", "b", "--path", str(proj)]
    )
    assert result.exit_code == 0, result.output
    assert "wren context build" not in result.output


def test_set_profile_prints_summary_with_arrow_when_data_source_changes(
    tmp_path, monkeypatch
):
    """When binding overwrites data_source, summary shows the transition."""
    import wren.profile as profile_mod  # noqa: PLC0415

    _isolate_profiles(tmp_path / "wren-home", monkeypatch)
    profile_mod.add_profile("duck", {"datasource": "duckdb"})

    proj = tmp_path / "myproj"
    _invoke_ok(["context", "init", "--empty", "--path", str(proj)])

    result = runner.invoke(
        app, ["context", "set-profile", "duck", "--path", str(proj)]
    )
    assert result.exit_code == 0, result.output
    # init wrote postgres placeholder; we're binding duck (duckdb)
    assert "postgres" in result.output
    assert "duckdb" in result.output


# ── wren context validate — profile binding hint ──────────────────────────


def test_validate_hints_when_no_profile_bound(tmp_path, monkeypatch):
    """No `profile:` field → friendly info pointing to set-profile."""
    _isolate_profiles(tmp_path / "wren-home", monkeypatch)
    _make_valid_project(tmp_path)  # no profile field

    result = runner.invoke(app, ["context", "validate", "--path", str(tmp_path)])
    assert result.exit_code == 0, result.output
    assert "set-profile" in result.output
    # Wording should make it clear it's a hint, not an error.
    assert "fall back" in result.output.lower() or "fallback" in result.output.lower()


def test_validate_warns_when_pinned_profile_missing(tmp_path, monkeypatch):
    """`profile: ghost` but ghost doesn't exist → warning, exit 0 without --strict."""
    import wren.profile as profile_mod  # noqa: PLC0415

    _isolate_profiles(tmp_path / "wren-home", monkeypatch)
    profile_mod.add_profile("real", {"datasource": "postgres"})
    _make_valid_project(tmp_path)
    import yaml  # noqa: PLC0415

    config = yaml.safe_load((tmp_path / "wren_project.yml").read_text())
    config["profile"] = "ghost"
    (tmp_path / "wren_project.yml").write_text(yaml.safe_dump(config))

    result = runner.invoke(app, ["context", "validate", "--path", str(tmp_path)])
    assert result.exit_code == 0, result.output
    assert "ghost" in result.output


def test_validate_no_profile_hint_when_correctly_bound(tmp_path, monkeypatch):
    """`profile: real` + real exists → no profile hint noise in output."""
    import wren.profile as profile_mod  # noqa: PLC0415

    _isolate_profiles(tmp_path / "wren-home", monkeypatch)
    profile_mod.add_profile("real", {"datasource": "postgres"})
    _make_valid_project(tmp_path)
    import yaml  # noqa: PLC0415

    config = yaml.safe_load((tmp_path / "wren_project.yml").read_text())
    config["profile"] = "real"
    (tmp_path / "wren_project.yml").write_text(yaml.safe_dump(config))

    result = runner.invoke(app, ["context", "validate", "--path", str(tmp_path)])
    assert result.exit_code == 0, result.output
    # No hint text triggered when binding is correct.
    assert "set-profile" not in result.output


def test_validate_handles_list_profiles_exception(tmp_path, monkeypatch):
    """If list_profiles() raises (e.g. permission denied on profiles.yml),
    validate must surface it as a warning, not crash with a raw traceback."""
    _make_valid_project(tmp_path)
    import yaml  # noqa: PLC0415

    config = yaml.safe_load((tmp_path / "wren_project.yml").read_text())
    config["profile"] = "anything"  # triggers the binding check
    (tmp_path / "wren_project.yml").write_text(yaml.safe_dump(config))

    import wren.profile as profile_mod  # noqa: PLC0415

    def _broken(*_args, **_kwargs):
        raise OSError("simulated permission denied")

    monkeypatch.setattr(profile_mod, "list_profiles", _broken)

    result = runner.invoke(app, ["context", "validate", "--path", str(tmp_path)])
    # The binding check must catch the exception internally — letting the
    # OSError propagate would crash the CLI with a Python traceback in real
    # use (CliRunner swallows it into result.exception, but real users see
    # the traceback on stderr).
    assert not isinstance(result.exception, OSError), (
        f"OSError leaked from list_profiles(): {result.exception!r}\n"
        "Wrap the binding check in try/except so validate degrades gracefully."
    )
    # Lock the contract: warning-only path exits 0 so users can pipe / script
    # validate without a probe-failure becoming a hard failure.
    assert result.exit_code == 0, result.output
    # Validate should still surface the failure to the user somewhere visible.
    assert "permission denied" in result.output.lower() or "anything" in result.output

    # And under --strict the same warning becomes a hard error (exit 1) — keep
    # both ends of the contract pinned so neither direction silently flips.
    strict_result = runner.invoke(
        app, ["context", "validate", "--path", str(tmp_path), "--strict"]
    )
    assert strict_result.exit_code == 1, strict_result.output


def test_validate_hint_shown_even_when_warnings_present(tmp_path, monkeypatch):
    """The no-pin hint should fire whenever the project lacks a binding,
    not only on perfectly clean projects. A project with warnings still
    benefits from the nudge — arguably more, since it's actively being
    worked on."""
    _isolate_profiles(tmp_path / "wren-home", monkeypatch)
    _make_valid_project(tmp_path)

    # Inject a synthetic semantic warning without breaking the manifest.
    # Using a real warning trigger (e.g. broken relationship) inevitably
    # also surfaces a hard error, which would mask what we're testing.
    from wren import context as context_mod  # noqa: PLC0415

    original = context_mod.validate_manifest

    def _with_warning(*args, **kwargs):
        result = original(*args, **kwargs)
        result["warnings"] = list(result.get("warnings", [])) + [
            "synthetic warning for hint test"
        ]
        return result

    monkeypatch.setattr(context_mod, "validate_manifest", _with_warning)

    result = runner.invoke(app, ["context", "validate", "--path", str(tmp_path)])
    # The hint must appear regardless of warning count — gating it on a
    # pristine project hides it from the people who most need to see it.
    assert "set-profile" in result.output
    # And the warning we injected should still be visible (sanity check
    # that we actually got into the warning-bearing code path).
    assert "synthetic warning" in result.output


def test_validate_hint_suppressed_when_hard_errors(tmp_path, monkeypatch):
    """When validation has hard errors, the no-pin hint must not pile on
    extra noise — the user should fix the real problem first."""
    _isolate_profiles(tmp_path / "wren-home", monkeypatch)
    # Project missing data_source → hard error
    (tmp_path / "wren_project.yml").write_text(
        "schema_version: 2\nname: broken\n"
    )

    result = runner.invoke(app, ["context", "validate", "--path", str(tmp_path)])
    assert result.exit_code == 1
    # hint must not appear when there are hard errors
    assert "set-profile" not in result.output


def test_validate_strict_fails_on_missing_pinned_profile(tmp_path, monkeypatch):
    """--strict treats the missing-pin warning as an error."""
    import wren.profile as profile_mod  # noqa: PLC0415

    _isolate_profiles(tmp_path / "wren-home", monkeypatch)
    profile_mod.add_profile("real", {"datasource": "postgres"})
    _make_valid_project(tmp_path)
    import yaml  # noqa: PLC0415

    config = yaml.safe_load((tmp_path / "wren_project.yml").read_text())
    config["profile"] = "ghost"
    (tmp_path / "wren_project.yml").write_text(yaml.safe_dump(config))

    result = runner.invoke(
        app, ["context", "validate", "--path", str(tmp_path), "--strict"]
    )
    assert result.exit_code == 1
    assert "ghost" in result.output
