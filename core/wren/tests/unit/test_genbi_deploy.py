"""Behavior tests for `wren genbi deploy` — token discovery + providers."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml
from typer.testing import CliRunner

import wren.genbi.providers.cloudflare as cloudflare
import wren.genbi.providers.vercel as vercel
from wren.cli import app
from wren.genbi.tokens import resolve_token

runner = CliRunner()

pytestmark = pytest.mark.unit


def _make_deployable_project(tmp_path: Path) -> Path:
    (tmp_path / "wren_project.yml").write_text(
        'schema_version: 2\nname: test_proj\nversion: "1.0"\n'
        "catalog: wren\nschema: public\ndata_source: duckdb\n"
    )
    app_dir = tmp_path / "apps" / "myapp"
    (app_dir / "data").mkdir(parents=True)
    (app_dir / "index.html").write_text("<html><body>GenBI</body></html>")
    (app_dir / "mdl.json").write_text(json.dumps({"models": [{}]}))
    (app_dir / "data" / "orders.parquet").write_bytes(b"PAR1fake")
    result = runner.invoke(app, ["genbi", "register", "myapp", "-p", str(tmp_path)])
    assert result.exit_code == 0, result.output
    return tmp_path


# ── TokenResolver ──────────────────────────────────────────────────────────


def test_token_from_environment_wins(tmp_path: Path, monkeypatch) -> None:
    (tmp_path / ".env").write_text("VERCEL_TOKEN=from-dotenv\n")
    monkeypatch.setenv("VERCEL_TOKEN", "from-env")

    assert resolve_token("VERCEL_TOKEN", tmp_path) == "from-env"


def test_token_falls_back_to_project_dotenv(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("VERCEL_TOKEN", raising=False)
    (tmp_path / ".env").write_text("VERCEL_TOKEN=from-dotenv\n")

    assert resolve_token("VERCEL_TOKEN", tmp_path) == "from-dotenv"


def test_token_absent_returns_none(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("VERCEL_TOKEN", raising=False)

    assert resolve_token("VERCEL_TOKEN", tmp_path) is None


# ── Vercel deploy ──────────────────────────────────────────────────────────


class _FakeTransport:
    """Captures provider HTTP requests and returns canned responses."""

    def __init__(self, response: dict) -> None:
        self.calls: list[dict] = []
        self.response = response

    def __call__(self, *, method: str, url: str, headers: dict, payload: dict) -> dict:
        self.calls.append(
            {"method": method, "url": url, "headers": headers, "payload": payload}
        )
        return self.response


def test_deploy_vercel_uploads_and_persists_state(tmp_path: Path, monkeypatch) -> None:
    project = _make_deployable_project(tmp_path)
    monkeypatch.setenv("VERCEL_TOKEN", "tok-123")
    fake = _FakeTransport(
        {"id": "dpl_1", "url": "myapp-abc.vercel.app", "projectId": "prj_9"}
    )
    monkeypatch.setattr(vercel, "_request", fake)

    result = runner.invoke(
        app, ["genbi", "deploy", "myapp", "--provider", "vercel", "-p", str(project)]
    )

    assert result.exit_code == 0, result.output
    assert "https://myapp-abc.vercel.app" in result.output
    # request construction
    call = fake.calls[0]
    assert "api.vercel.com" in call["url"]
    assert call["headers"]["Authorization"] == "Bearer tok-123"
    filenames = {f["file"] for f in call["payload"]["files"]}
    assert "index.html" in filenames and "mdl.json" in filenames
    assert call["payload"].get("target") != "production"  # preview by default
    # deploy state persisted
    index = yaml.safe_load((project / ".wren" / "apps.yml").read_text())
    entry = index["apps"]["myapp"]
    assert entry["status"] == "deployed"
    assert entry["deploy"]["provider"] == "vercel"
    assert entry["deploy"]["project_id"] == "prj_9"
    assert entry["deploy"]["last_url"] == "https://myapp-abc.vercel.app"
    assert entry["deploy"]["environment"] == "preview"
    # no secrets in the index
    assert "tok-123" not in (project / ".wren" / "apps.yml").read_text()


def test_deploy_prod_flag_targets_production(tmp_path: Path, monkeypatch) -> None:
    project = _make_deployable_project(tmp_path)
    monkeypatch.setenv("VERCEL_TOKEN", "tok-123")
    fake = _FakeTransport({"id": "dpl_1", "url": "myapp.vercel.app"})
    monkeypatch.setattr(vercel, "_request", fake)

    result = runner.invoke(
        app,
        [
            "genbi",
            "deploy",
            "myapp",
            "--provider",
            "vercel",
            "--prod",
            "-p",
            str(project),
        ],
    )

    assert result.exit_code == 0, result.output
    assert fake.calls[0]["payload"]["target"] == "production"
    index = yaml.safe_load((project / ".wren" / "apps.yml").read_text())
    assert index["apps"]["myapp"]["deploy"]["environment"] == "production"


def test_deploy_without_token_gives_actionable_error(tmp_path, monkeypatch) -> None:
    project = _make_deployable_project(tmp_path)
    monkeypatch.delenv("VERCEL_TOKEN", raising=False)

    result = runner.invoke(
        app, ["genbi", "deploy", "myapp", "--provider", "vercel", "-p", str(project)]
    )

    assert result.exit_code != 0
    assert "VERCEL_TOKEN" in result.output


def test_deploy_runs_verify_first_and_aborts_on_failure(tmp_path, monkeypatch) -> None:
    project = _make_deployable_project(tmp_path)
    (project / "apps" / "myapp" / "mdl.json").unlink()  # break the app
    monkeypatch.setenv("VERCEL_TOKEN", "tok-123")
    fake = _FakeTransport({"id": "dpl_1", "url": "x.vercel.app"})
    monkeypatch.setattr(vercel, "_request", fake)

    result = runner.invoke(
        app, ["genbi", "deploy", "myapp", "--provider", "vercel", "-p", str(project)]
    )

    assert result.exit_code != 0
    assert "mdl.json" in result.output
    assert fake.calls == []  # nothing was uploaded


def test_deploy_unregistered_app_errors(tmp_path, monkeypatch) -> None:
    project = _make_deployable_project(tmp_path)
    runner.invoke(app, ["genbi", "remove", "myapp", "-p", str(project)])
    monkeypatch.setenv("VERCEL_TOKEN", "tok-123")

    result = runner.invoke(
        app, ["genbi", "deploy", "myapp", "--provider", "vercel", "-p", str(project)]
    )

    assert result.exit_code != 0
    assert "not registered" in result.output


def test_deploy_unknown_provider_errors(tmp_path) -> None:
    project = _make_deployable_project(tmp_path)

    result = runner.invoke(
        app, ["genbi", "deploy", "myapp", "--provider", "bogus", "-p", str(project)]
    )

    assert result.exit_code != 0
    assert "provider" in result.output.lower()


# ── Cloudflare deploy ──────────────────────────────────────────────────────


def test_deploy_cloudflare_uploads_and_persists_state(tmp_path, monkeypatch) -> None:
    project = _make_deployable_project(tmp_path)
    monkeypatch.setenv("CLOUDFLARE_API_TOKEN", "cf-tok")
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "acct-42")
    fake = _FakeTransport(
        {"result": {"url": "https://abc123.myapp.pages.dev", "id": "dep_1"}}
    )
    monkeypatch.setattr(cloudflare, "_request", fake)

    result = runner.invoke(
        app,
        ["genbi", "deploy", "myapp", "--provider", "cloudflare", "-p", str(project)],
    )

    assert result.exit_code == 0, result.output
    assert "https://abc123.myapp.pages.dev" in result.output
    # request construction: account-scoped Pages endpoint + bearer token
    urls = [c["url"] for c in fake.calls]
    assert any("accounts/acct-42/pages/projects" in u for u in urls)
    for call in fake.calls:
        assert call["headers"]["Authorization"] == "Bearer cf-tok"
    # deploy state persisted with the account id
    index = yaml.safe_load((project / ".wren" / "apps.yml").read_text())
    entry = index["apps"]["myapp"]
    assert entry["status"] == "deployed"
    assert entry["deploy"]["provider"] == "cloudflare"
    assert entry["deploy"]["account_id"] == "acct-42"
    assert entry["deploy"]["last_url"] == "https://abc123.myapp.pages.dev"
    assert "cf-tok" not in (project / ".wren" / "apps.yml").read_text()


def test_deploy_cloudflare_requires_account_id(tmp_path, monkeypatch) -> None:
    project = _make_deployable_project(tmp_path)
    monkeypatch.setenv("CLOUDFLARE_API_TOKEN", "cf-tok")
    monkeypatch.delenv("CLOUDFLARE_ACCOUNT_ID", raising=False)

    result = runner.invoke(
        app,
        ["genbi", "deploy", "myapp", "--provider", "cloudflare", "-p", str(project)],
    )

    assert result.exit_code != 0
    assert "CLOUDFLARE_ACCOUNT_ID" in result.output
