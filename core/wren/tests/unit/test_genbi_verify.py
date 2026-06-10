"""Behavior tests for `wren genbi verify` and `wren genbi open`."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml
from typer.testing import CliRunner

from wren.cli import app
from wren.genbi.verify import verify_app

runner = CliRunner()

pytestmark = pytest.mark.unit


def _make_project_with_app(
    tmp_path: Path,
    *,
    register: bool = True,
    data_mode: str = "snapshot",
    index_html: bool = True,
    mdl_json: bool = True,
    data_asset: bool = True,
) -> Path:
    (tmp_path / "wren_project.yml").write_text(
        'schema_version: 2\nname: test_proj\nversion: "1.0"\n'
        "catalog: wren\nschema: public\ndata_source: duckdb\n"
    )
    app_dir = tmp_path / "apps" / "myapp"
    app_dir.mkdir(parents=True)
    if index_html:
        (app_dir / "index.html").write_text("<html><body>GenBI</body></html>")
    if mdl_json:
        (app_dir / "mdl.json").write_text(
            json.dumps({"catalog": "wren", "schema": "public", "models": [{}]})
        )
    if data_asset:
        (app_dir / "data").mkdir()
        (app_dir / "data" / "orders.parquet").write_bytes(b"PAR1fake")
    if register:
        result = runner.invoke(
            app,
            [
                "genbi",
                "register",
                "myapp",
                "--data-mode",
                data_mode,
                "-p",
                str(tmp_path),
            ],
        )
        assert result.exit_code == 0, result.output
    return tmp_path


def _status(project: Path) -> str:
    index = yaml.safe_load((project / ".wren" / "apps.yml").read_text())
    return index["apps"]["myapp"]["status"]


# ── Tracer bullet ──────────────────────────────────────────────────────────


def test_verify_passes_and_flips_status_to_built(tmp_path: Path) -> None:
    project = _make_project_with_app(tmp_path)

    result = runner.invoke(app, ["genbi", "verify", "myapp", "-p", str(project)])

    assert result.exit_code == 0, result.output
    assert _status(project) == "built"


def test_verify_fails_on_missing_index_html(tmp_path: Path) -> None:
    project = _make_project_with_app(tmp_path, index_html=False)

    result = runner.invoke(app, ["genbi", "verify", "myapp", "-p", str(project)])

    assert result.exit_code != 0
    assert "index.html" in result.output
    assert _status(project) == "scaffolded"  # not flipped


def test_verify_fails_on_invalid_mdl_json(tmp_path: Path) -> None:
    project = _make_project_with_app(tmp_path, mdl_json=False)
    (project / "apps" / "myapp" / "mdl.json").write_text("{not json")

    result = runner.invoke(app, ["genbi", "verify", "myapp", "-p", str(project)])

    assert result.exit_code != 0
    assert "mdl.json" in result.output
    assert _status(project) == "scaffolded"


def test_verify_snapshot_requires_data_asset(tmp_path: Path) -> None:
    project = _make_project_with_app(tmp_path, data_asset=False)

    result = runner.invoke(app, ["genbi", "verify", "myapp", "-p", str(project)])

    assert result.exit_code != 0
    assert "data asset" in result.output
    assert _status(project) == "scaffolded"


def test_verify_unregistered_app_errors(tmp_path: Path) -> None:
    project = _make_project_with_app(tmp_path, register=False)

    result = runner.invoke(app, ["genbi", "verify", "myapp", "-p", str(project)])

    assert result.exit_code != 0
    assert "not registered" in result.output


def test_open_unregistered_app_errors(tmp_path: Path) -> None:
    project = _make_project_with_app(tmp_path, register=False)

    result = runner.invoke(app, ["genbi", "open", "myapp", "-p", str(project)])

    assert result.exit_code != 0
    assert "not registered" in result.output


def test_verify_live_app_does_not_require_data_asset(tmp_path: Path) -> None:
    project = _make_project_with_app(tmp_path, data_mode="live", data_asset=False)

    result = runner.invoke(app, ["genbi", "verify", "myapp", "-p", str(project)])

    assert result.exit_code == 0, result.output
    assert _status(project) == "built"


def test_verify_fails_on_inlined_connection_credentials(tmp_path: Path) -> None:
    project = _make_project_with_app(tmp_path, data_mode="live", data_asset=False)
    (project / "apps" / "myapp" / "config.js").write_text(
        'const DB = "postgres://admin:s3cretpw@db.internal:5432/prod";'
    )

    result = runner.invoke(app, ["genbi", "verify", "myapp", "-p", str(project)])

    assert result.exit_code != 0
    assert "secret" in result.output.lower() or "credential" in result.output.lower()
    assert "config.js" in result.output
    assert _status(project) == "scaffolded"


def test_verify_fails_on_inlined_password_assignment(tmp_path: Path) -> None:
    project = _make_project_with_app(tmp_path, data_mode="live", data_asset=False)
    (project / "apps" / "myapp" / "settings.json").write_text(
        '{"host": "db.internal", "password": "hunter2hunter2"}'
    )

    result = runner.invoke(app, ["genbi", "verify", "myapp", "-p", str(project)])

    assert result.exit_code != 0
    assert "settings.json" in result.output
    assert _status(project) == "scaffolded"


def test_verify_snapshot_app_with_secret_also_fails(tmp_path: Path) -> None:
    project = _make_project_with_app(tmp_path)  # snapshot, complete
    (project / "apps" / "myapp" / "index.html").write_text(
        '<script>const k = "AKIAIOSFODNN7EXAMPLE";</script>'
    )

    result = runner.invoke(app, ["genbi", "verify", "myapp", "-p", str(project)])

    assert result.exit_code != 0
    assert "index.html" in result.output


def test_verify_fails_closed_on_unknown_data_mode(tmp_path: Path) -> None:
    # a typo'd mode must NOT silently skip the snapshot data-asset check
    result = verify_app(tmp_path, data_mode="snapsho")
    assert not result.passed
    assert any("unknown data_mode" in f for f in result.failures)


def _otherwise_valid_snapshot_app(tmp_path: Path) -> Path:
    (tmp_path / "index.html").write_text("<html></html>")
    (tmp_path / "mdl.json").write_text('{"models": []}')
    (tmp_path / "data.parquet").write_bytes(b"PAR1")  # snapshot asset
    return tmp_path


@pytest.mark.parametrize(
    "filename, contents",
    [
        # .ts / .yaml are NOT in any web allowlist but are scanned (default-deny)
        ("config.ts", 'export const DB = "postgres://user:p4ssword@host/db";\n'),
        ("settings.yaml", 'password: "s3cretValue123"\n'),
    ],
)
def test_verify_scans_non_weblike_files_for_secrets(
    tmp_path: Path, filename: str, contents: str
) -> None:
    app = _otherwise_valid_snapshot_app(tmp_path)
    (app / filename).write_text(contents)

    result = verify_app(app, data_mode="snapshot")

    assert not result.passed
    assert any(filename in f for f in result.failures), result.failures


def test_verify_rejects_dotenv_by_presence(tmp_path: Path) -> None:
    # a .env file must fail the gate on presence alone — even content the
    # narrow patterns wouldn't recognize, and even though wrangler would
    # otherwise ship the whole folder.
    app = _otherwise_valid_snapshot_app(tmp_path)
    (app / ".env").write_text("API_KEY=plain_unquoted_value\n")

    result = verify_app(app, data_mode="snapshot")

    assert not result.passed
    assert any(".env" in f for f in result.failures), result.failures


def test_verify_does_not_scan_binary_data_assets(tmp_path: Path) -> None:
    # a parquet whose bytes happen to contain a secret-like run must not be
    # read/flagged — binary/data formats are skipped to avoid false positives.
    app = _otherwise_valid_snapshot_app(tmp_path)
    (app / "data.parquet").write_bytes(b'password="s3cretValue123"\x00PAR1')

    result = verify_app(app, data_mode="snapshot")

    assert result.passed, result.failures
