"""Integration tests for the ``wren profile`` CLI sub-app."""

from __future__ import annotations

import io
import json
from pathlib import Path

import pytest
import typer
from typer.testing import CliRunner

import wren.profile as profile_mod
from wren.profile_cli import profile_app

runner = CliRunner()


def _capture_typer_echo(monkeypatch) -> io.StringIO:
    """Redirect ``typer.echo`` into a buffer for assertions."""
    buf = io.StringIO()
    monkeypatch.setattr(typer, "echo", lambda msg="", **kw: buf.write(str(msg) + "\n"))
    return buf


@pytest.fixture(autouse=True)
def isolated_profiles(tmp_path, monkeypatch):
    """Redirect all profile I/O to a temp directory."""
    profiles_file = tmp_path / "profiles.yml"
    monkeypatch.setattr(profile_mod, "_WREN_HOME", tmp_path)
    monkeypatch.setattr(profile_mod, "_PROFILES_FILE", profiles_file)
    return profiles_file


# ── list ──────────────────────────────────────────────────────────────────────


def test_list_empty():
    result = runner.invoke(profile_app, ["list"])
    assert result.exit_code == 0
    assert "No profiles configured" in result.output


def test_add_then_list():
    runner.invoke(profile_app, ["add", "pg", "--datasource", "postgres"])
    result = runner.invoke(profile_app, ["list"])
    assert result.exit_code == 0
    assert "pg" in result.output
    assert "postgres" in result.output
    assert "*" in result.output  # active marker


def test_list_marks_active_only():
    runner.invoke(profile_app, ["add", "pg", "--datasource", "postgres"])
    runner.invoke(profile_app, ["add", "duck", "--datasource", "duckdb"])
    result = runner.invoke(profile_app, ["list"])
    lines = result.output.splitlines()
    active_lines = [line for line in lines if "*" in line]
    assert len(active_lines) == 1
    assert "pg" in active_lines[0]


# ── add ───────────────────────────────────────────────────────────────────────


def test_add_requires_datasource_or_flag():
    result = runner.invoke(profile_app, ["add", "pg"])
    assert result.exit_code != 0
    assert "--datasource" in result.output or "Error" in result.output


def test_add_from_json_file(tmp_path):
    conn_file = tmp_path / "conn.json"
    conn_file.write_text(
        json.dumps({"datasource": "postgres", "host": "db.local", "port": 5432})
    )
    result = runner.invoke(profile_app, ["add", "pg", "--from-file", str(conn_file)])
    assert result.exit_code == 0
    assert "added" in result.output
    profiles = profile_mod.list_profiles()
    assert profiles["pg"]["host"] == "db.local"


def test_add_from_yaml_file(tmp_path):
    conn_file = tmp_path / "conn.yml"
    conn_file.write_text("datasource: mysql\nhost: mysql.local\nport: 3306\n")
    result = runner.invoke(profile_app, ["add", "my", "--from-file", str(conn_file)])
    assert result.exit_code == 0
    profiles = profile_mod.list_profiles()
    assert profiles["my"]["datasource"] == "mysql"


def test_add_from_file_normalizes_properties_envelope(tmp_path):
    """MCP/web envelope {datasource, properties: {...}} should be flattened."""
    conn_file = tmp_path / "conn.json"
    conn_file.write_text(
        json.dumps(
            {
                "datasource": "duckdb",
                "properties": {"url": "/tmp/warehouse", "format": "duckdb"},
            }
        )
    )
    result = runner.invoke(profile_app, ["add", "duck", "--from-file", str(conn_file)])
    assert result.exit_code == 0
    profiles = profile_mod.list_profiles()
    # After normalization, 'url' should be a top-level key, not nested under 'properties'
    assert "properties" not in profiles["duck"]
    assert profiles["duck"]["url"] == "/tmp/warehouse"
    assert profiles["duck"]["datasource"] == "duckdb"


def test_add_from_file_rejects_connection_envelope(tmp_path):
    """`connection:` envelope is not legacy MCP/web shape — reject so the
    user fixes it instead of having a half-broken profile."""
    conn_file = tmp_path / "conn.yml"
    conn_file.write_text(
        "datasource: mysql\nconnection:\n  host: db.local\n  port: '3306'\n"
    )
    result = runner.invoke(profile_app, ["add", "my", "--from-file", str(conn_file)])
    assert result.exit_code == 1
    assert (
        "connection" in result.output.lower()
        or "unexpected nested" in result.output.lower()
    )


def test_add_from_file_rejects_config_envelope(tmp_path):
    conn_file = tmp_path / "conn.yml"
    conn_file.write_text(
        "datasource: postgres\nconfig:\n  host: pg.local\n  port: 5432\n"
    )
    result = runner.invoke(profile_app, ["add", "pg", "--from-file", str(conn_file)])
    assert result.exit_code == 1
    assert (
        "config" in result.output.lower()
        or "unexpected nested" in result.output.lower()
    )


def test_add_from_file_rejects_unknown_nested_keys(tmp_path):
    """Unknown nested dicts are rejected rather than silently saved."""
    conn_file = tmp_path / "conn.yml"
    conn_file.write_text("datasource: mysql\nmystery:\n  host: db.local\n")
    result = runner.invoke(profile_app, ["add", "my", "--from-file", str(conn_file)])
    assert result.exit_code == 1
    assert (
        "mystery" in result.output.lower()
        or "unexpected nested" in result.output.lower()
    )


def test_add_from_file_allows_kwargs_nested(tmp_path):
    """`kwargs` / `settings` are legitimate nested dicts (MySQL, ClickHouse)."""
    conn_file = tmp_path / "conn.yml"
    conn_file.write_text(
        "datasource: mysql\nhost: db.local\nport: '3306'\n"
        "kwargs:\n  ssl_disabled: 'true'\n"
    )
    result = runner.invoke(profile_app, ["add", "my", "--from-file", str(conn_file)])
    assert result.exit_code == 0, result.output
    saved = profile_mod.list_profiles()["my"]
    assert saved["kwargs"] == {"ssl_disabled": "true"}


def test_add_from_file_not_found():
    result = runner.invoke(
        profile_app, ["add", "pg", "--from-file", "/nonexistent/file.json"]
    )
    assert result.exit_code != 0
    assert "not found" in result.output


def test_add_from_file_missing_datasource(tmp_path):
    conn_file = tmp_path / "conn.json"
    conn_file.write_text(json.dumps({"host": "localhost", "port": 5432}))
    result = runner.invoke(profile_app, ["add", "pg", "--from-file", str(conn_file)])
    assert result.exit_code != 0
    assert "datasource" in result.output


def test_add_with_activate_flag():
    runner.invoke(profile_app, ["add", "first", "--datasource", "duckdb"])
    runner.invoke(
        profile_app, ["add", "second", "--datasource", "postgres", "--activate"]
    )
    assert profile_mod.get_active_name() == "second"


# ── import dbt ────────────────────────────────────────────────────────────────


def _write_dbt_project(tmp_path: Path) -> tuple[Path, Path]:
    project_dir = tmp_path / "jaffle_shop"
    project_dir.mkdir()
    (project_dir / "dbt_project.yml").write_text(
        "name: jaffle_shop\nprofile: jaffle_shop\n"
    )
    profiles_path = tmp_path / "profiles.yml"
    profiles_path.write_text(
        "jaffle_shop:\n"
        "  target: dev\n"
        "  outputs:\n"
        "    dev:\n"
        "      type: duckdb\n"
        "      path: /tmp/jaffle.duckdb\n"
    )
    return project_dir, profiles_path


def test_import_dbt_duckdb_profile(tmp_path, monkeypatch):
    project_dir, profiles_path = _write_dbt_project(tmp_path)
    profiles_path.write_text(
        "jaffle_shop:\n"
        "  target: dev\n"
        "  outputs:\n"
        "    dev:\n"
        "      type: duckdb\n"
        "      path: \"{{ env_var('JAFFLE_DUCKDB_PATH') }}\"\n"
    )
    monkeypatch.setenv("JAFFLE_DUCKDB_PATH", "/tmp/jaffle.duckdb")

    result = runner.invoke(
        profile_app,
        [
            "import",
            "dbt",
            "--project-dir",
            str(project_dir),
            "--profiles-path",
            str(profiles_path),
        ],
    )

    assert result.exit_code == 0, result.output
    profiles = profile_mod.list_profiles()
    assert "jaffle-shop-dev" in profiles
    assert profiles["jaffle-shop-dev"]["datasource"] == "duckdb"
    assert profiles["jaffle-shop-dev"]["url"] == "/tmp"
    assert profiles["jaffle-shop-dev"]["format"] == "duckdb"
    assert profile_mod.get_active_name() == "jaffle-shop-dev"


def test_import_dbt_duckdb_relative_path_uses_project_dir(tmp_path):
    project_dir, profiles_path = _write_dbt_project(tmp_path)
    profiles_path.write_text(
        "jaffle_shop:\n"
        "  target: dev\n"
        "  outputs:\n"
        "    dev:\n"
        "      type: duckdb\n"
        "      path: warehouse/jaffle.duckdb\n"
    )

    result = runner.invoke(
        profile_app,
        [
            "import",
            "dbt",
            "--project-dir",
            str(project_dir),
            "--profiles-path",
            str(profiles_path),
        ],
    )

    assert result.exit_code == 0, result.output
    profiles = profile_mod.list_profiles()
    assert profiles["jaffle-shop-dev"]["url"] == str(project_dir / "warehouse")


def test_import_dbt_postgres_profile_custom_name_no_activate(tmp_path):
    project_dir, profiles_path = _write_dbt_project(tmp_path)
    profiles_path.write_text(
        "jaffle_shop:\n"
        "  target: dev\n"
        "  outputs:\n"
        "    dev:\n"
        "      type: postgres\n"
        "      host: localhost\n"
        "      port: 5432\n"
        "      dbname: analytics\n"
        "      user: postgres\n"
        "      password: secret\n"
    )
    runner.invoke(profile_app, ["add", "existing", "--datasource", "duckdb"])

    result = runner.invoke(
        profile_app,
        [
            "import",
            "dbt",
            "--project-dir",
            str(project_dir),
            "--profiles-path",
            str(profiles_path),
            "--name",
            "pg-from-dbt",
            "--no-activate",
        ],
    )

    assert result.exit_code == 0, result.output
    profiles = profile_mod.list_profiles()
    assert profiles["pg-from-dbt"]["datasource"] == "postgres"
    assert profiles["pg-from-dbt"]["database"] == "analytics"
    assert profile_mod.get_active_name() == "existing"


def test_import_dbt_unsupported_source(tmp_path):
    project_dir, profiles_path = _write_dbt_project(tmp_path)
    profiles_path.write_text("{}\n")

    result = runner.invoke(
        profile_app,
        [
            "import",
            "airbyte",
            "--project-dir",
            str(project_dir),
            "--profiles-path",
            str(profiles_path),
        ],
    )

    assert result.exit_code != 0
    assert "Only 'dbt' is supported" in result.output


def test_import_dbt_validation_error(tmp_path):
    project_dir, profiles_path = _write_dbt_project(tmp_path)
    profiles_path.write_text(
        "jaffle_shop:\n"
        "  target: dev\n"
        "  outputs:\n"
        "    dev:\n"
        "      type: postgres\n"
        "      host: localhost\n"
    )

    result = runner.invoke(
        profile_app,
        [
            "import",
            "dbt",
            "--project-dir",
            str(project_dir),
            "--profiles-path",
            str(profiles_path),
        ],
    )

    assert result.exit_code != 0
    assert "missing required field" in result.output


# ── switch ────────────────────────────────────────────────────────────────────


def test_switch_updates_active():
    runner.invoke(profile_app, ["add", "pg", "--datasource", "postgres"])
    runner.invoke(profile_app, ["add", "duck", "--datasource", "duckdb"])
    result = runner.invoke(profile_app, ["switch", "duck"])
    assert result.exit_code == 0
    assert "duck" in result.output
    assert profile_mod.get_active_name() == "duck"

    # list should show * on duck
    list_result = runner.invoke(profile_app, ["list"])
    lines = list_result.output.splitlines()
    duck_line = next(line for line in lines if "duck" in line)
    assert "*" in duck_line


def test_switch_not_found():
    result = runner.invoke(profile_app, ["switch", "ghost"])
    assert result.exit_code != 0
    assert "not found" in result.output


# ── rm ────────────────────────────────────────────────────────────────────────


def test_rm_with_force():
    runner.invoke(profile_app, ["add", "pg", "--datasource", "postgres"])
    result = runner.invoke(profile_app, ["rm", "pg", "--force"])
    assert result.exit_code == 0
    assert "removed" in result.output
    assert "pg" not in profile_mod.list_profiles()


def test_rm_not_found():
    result = runner.invoke(profile_app, ["rm", "ghost", "--force"])
    assert result.exit_code != 0
    assert "not found" in result.output


# ── debug ─────────────────────────────────────────────────────────────────────


def test_debug_output():
    profile_mod.add_profile(
        "pg",
        {
            "datasource": "postgres",
            "host": "db.example.com",
            "password": "topsecret",
        },
    )
    result = runner.invoke(profile_app, ["debug"])
    assert result.exit_code == 0
    data = json.loads(result.output)
    assert data["name"] == "pg"
    assert data["config"]["host"] == "db.example.com"
    assert data["config"]["password"] == "***"


def test_debug_no_active_profile():
    result = runner.invoke(profile_app, ["debug"])
    assert result.exit_code != 0
    assert "Error" in result.output


def test_debug_named_profile():
    profile_mod.add_profile("a", {"datasource": "duckdb", "path": ":memory:"})
    profile_mod.add_profile("b", {"datasource": "postgres", "password": "pw"})
    result = runner.invoke(profile_app, ["debug", "b"])
    assert result.exit_code == 0
    data = json.loads(result.output)
    assert data["name"] == "b"
    assert data["config"]["password"] == "***"


# ── add --validate ────────────────────────────────────────────────────────────


def test_add_minimal_skips_validation():
    """Minimal profiles have no connection fields — nothing to validate."""
    result = runner.invoke(profile_app, ["add", "pg", "--datasource", "postgres"])
    assert result.exit_code == 0
    assert "Validating connection" not in result.output
    assert "Next: wren context init" in result.output


def test_add_from_file_runs_validation_by_default(tmp_path, monkeypatch):
    """When a non-minimal profile lands, validation runs automatically."""
    import wren.profile_cli as profile_cli  # noqa: PLC0415

    calls: list[str] = []

    def fake_validate(name):
        calls.append(name)
        return True

    monkeypatch.setattr(profile_cli, "_validate_connection", fake_validate)

    conn_file = tmp_path / "conn.json"
    conn_file.write_text(
        json.dumps(
            {
                "datasource": "duckdb",
                "url": str(tmp_path),
                "format": "duckdb",
            }
        )
    )
    result = runner.invoke(profile_app, ["add", "duck", "--from-file", str(conn_file)])
    assert result.exit_code == 0
    assert calls == ["duck"]
    assert "Next: wren context init" in result.output


def test_add_from_file_suppresses_next_hint_on_validation_failure(
    tmp_path, monkeypatch
):
    """When validation fails, the misleading ``Next: wren context init``
    hint must not be printed — otherwise users proceed with a broken
    profile because the warning above it is easy to miss."""
    import wren.profile_cli as profile_cli  # noqa: PLC0415

    monkeypatch.setattr(profile_cli, "_validate_connection", lambda name: False)

    conn_file = tmp_path / "conn.json"
    conn_file.write_text(
        json.dumps(
            {
                "datasource": "duckdb",
                "url": str(tmp_path),
                "format": "duckdb",
            }
        )
    )
    result = runner.invoke(profile_app, ["add", "duck", "--from-file", str(conn_file)])
    assert result.exit_code == 0
    assert "Next: wren context init" not in result.output


def test_add_from_file_respects_no_validate(tmp_path, monkeypatch):
    import wren.profile_cli as profile_cli  # noqa: PLC0415

    calls: list[str] = []
    monkeypatch.setattr(
        profile_cli, "_validate_connection", lambda name: calls.append(name)
    )

    conn_file = tmp_path / "conn.json"
    conn_file.write_text(json.dumps({"datasource": "postgres", "host": "db.local"}))

    result = runner.invoke(
        profile_app,
        ["add", "pg", "--from-file", str(conn_file), "--no-validate"],
    )
    assert result.exit_code == 0
    assert calls == [], "validation should not be invoked with --no-validate"
    # Next hint is still shown
    assert "Next: wren context init" in result.output


def test_validate_success(tmp_path, monkeypatch):
    """Directly exercise _validate_connection with a fake connector."""
    from wren import profile_cli  # noqa: PLC0415

    profile_mod.add_profile(
        "duck", {"datasource": "duckdb", "url": str(tmp_path), "format": "duckdb"}
    )

    class FakeConnector:
        def dry_run(self, sql):
            assert sql == "SELECT 1"

    monkeypatch.setattr(
        "wren.connector.factory.get_connector", lambda ds, info: FakeConnector()
    )

    buf = _capture_typer_echo(monkeypatch)
    profile_cli._validate_connection("duck")
    output = buf.getvalue()
    assert "Validating connection" in output
    assert "Connection validated" in output


def test_validate_failure_prints_warning(monkeypatch):
    from wren import profile_cli  # noqa: PLC0415

    # Full set of required postgres fields — we're exercising the "driver
    # connects but the DB refuses" path, not the "profile is incomplete"
    # path covered by test_validate_invalid_connection_info below.
    profile_mod.add_profile(
        "pg",
        {
            "datasource": "postgres",
            "host": "db.local",
            "port": "5432",
            "database": "wren",
            "user": "PaulChen79",
            "password": "paultest",
        },
    )

    def failing_get_connector(ds, info):
        raise RuntimeError("connection refused")

    monkeypatch.setattr("wren.connector.factory.get_connector", failing_get_connector)

    buf = _capture_typer_echo(monkeypatch)
    profile_cli._validate_connection("pg")
    output = buf.getvalue()
    assert "Connection failed: connection refused" in output
    assert "wren profile debug" in output
    assert "wren profile add pg --ui" in output


def test_validate_invalid_connection_info(monkeypatch):
    """Missing required fields surface the Pydantic error, not a dict
    AttributeError swallowed by the generic except clause."""
    from wren import profile_cli  # noqa: PLC0415

    profile_mod.add_profile(
        "pg",
        {
            "datasource": "postgres",
            # deliberately missing port / database / user
            "host": "db.local",
        },
    )

    # get_connector should never be reached — we expect the Pydantic
    # conversion to fail first.
    def should_not_be_called(ds, info):
        raise AssertionError("get_connector called despite invalid profile")

    monkeypatch.setattr("wren.connector.factory.get_connector", should_not_be_called)

    buf = _capture_typer_echo(monkeypatch)
    profile_cli._validate_connection("pg")
    output = buf.getvalue()
    assert "invalid connection info" in output
    assert "Field required" in output or "field required" in output.lower()


def test_validate_unknown_datasource(monkeypatch):
    from wren import profile_cli  # noqa: PLC0415

    profile_mod.add_profile("junk", {"datasource": "not-a-db"})

    buf = _capture_typer_echo(monkeypatch)
    profile_cli._validate_connection("junk")
    output = buf.getvalue()
    assert "Cannot validate" in output
    assert "unknown datasource" in output


def test_interactive_add_does_not_offer_connection_url(monkeypatch):
    """The interactive "Data source" prompt must not offer ``connection_url``.

    It is a field-registry entry but not a DataSource, so picking it saves a
    profile whose datasource no connector can resolve.
    """
    import wren.profile_cli as cli_mod

    captured = {}

    def fake_prompt(text, **kwargs):
        captured["choices"] = list(kwargs["type"].choices)
        raise RuntimeError("stop after the datasource prompt")

    monkeypatch.setattr(cli_mod.typer, "prompt", fake_prompt)

    with pytest.raises(RuntimeError):
        cli_mod._interactive_add(None)

    assert "connection_url" not in captured["choices"]
    # Reverse anchor: real datasources must still be offered.
    assert "postgres" in captured["choices"]
    assert "bigquery" in captured["choices"]
