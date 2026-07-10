"""Tests for wren.profile_web — browser-based profile creation server."""

from __future__ import annotations

import json

import pytest

starlette = pytest.importorskip("starlette", reason="starlette not installed")

from starlette.testclient import TestClient  # noqa: E402

import wren.profile as profile_mod  # noqa: E402
from wren.profile_web import create_app  # noqa: E402


@pytest.fixture(autouse=True)
def isolated_profiles(tmp_path, monkeypatch):
    """Redirect profile I/O to a temp directory for test isolation."""
    profiles_file = tmp_path / "profiles.yml"
    monkeypatch.setattr(profile_mod, "_WREN_HOME", tmp_path)
    monkeypatch.setattr(profile_mod, "_PROFILES_FILE", profiles_file)
    return profiles_file


@pytest.fixture()
def client():
    """TestClient for a fresh app instance named 'test-profile'."""
    app, _, _ = create_app("test-profile")
    return TestClient(app, raise_server_exceptions=True)


# ── GET / ──────────────────────────────────────────────────────────────────────


def test_form_renders(client):
    """GET / returns 200 with the profile name in the page."""
    resp = client.get("/")
    assert resp.status_code == 200
    assert "test-profile" in resp.text


def test_form_contains_datasource_options(client):
    """GET / renders datasource dropdown with known options."""
    resp = client.get("/")
    assert resp.status_code == 200
    assert "postgres" in resp.text
    assert "bigquery" in resp.text
    assert "duckdb" in resp.text


def test_form_has_save_button(client):
    """GET / renders the Save Profile button."""
    resp = client.get("/")
    assert "Save Profile" in resp.text


# ── GET /fields ────────────────────────────────────────────────────────────────


def test_fields_endpoint_postgres(client):
    """GET /fields?datasource=postgres renders host/port/database inputs."""
    resp = client.get("/fields?datasource=postgres")
    assert resp.status_code == 200
    assert 'name="host"' in resp.text
    assert 'name="port"' in resp.text
    assert 'name="database"' in resp.text
    assert 'name="user"' in resp.text
    assert 'name="password"' in resp.text


def test_fields_endpoint_password_type(client):
    """Password fields use type=password."""
    resp = client.get("/fields?datasource=postgres")
    assert 'type="password"' in resp.text


def test_fields_endpoint_bigquery_file_input(client):
    """BigQuery credentials field renders as file_base64 (hidden + file inputs)."""
    resp = client.get("/fields?datasource=bigquery")
    assert resp.status_code == 200
    # file_base64 renders a file input and a hidden input for the encoded value
    assert 'type="file"' in resp.text
    assert 'name="credentials"' in resp.text
    assert ".json" in resp.text  # accept=".json"


def test_fields_with_variant_bigquery_project(client):
    """GET /fields?datasource=bigquery&_variant=project returns billing_project_id."""
    resp = client.get("/fields?datasource=bigquery&_variant=project")
    assert resp.status_code == 200
    assert "billing_project_id" in resp.text


def test_fields_with_variant_bigquery_dataset(client):
    """GET /fields?datasource=bigquery&_variant=dataset returns dataset_id."""
    resp = client.get("/fields?datasource=bigquery&_variant=dataset")
    assert resp.status_code == 200
    assert "dataset_id" in resp.text
    assert "billing_project_id" not in resp.text


def test_fields_variant_selector_rendered(client):
    """Multi-variant datasources show a variant <select> dropdown."""
    resp = client.get("/fields?datasource=bigquery")
    assert resp.status_code == 200
    assert 'name="_variant"' in resp.text
    assert "dataset" in resp.text
    assert "project" in resp.text


def test_fields_no_variant_selector_for_postgres(client):
    """Single-variant datasources do not show a variant selector."""
    resp = client.get("/fields?datasource=postgres")
    assert 'name="_variant"' not in resp.text


def test_fields_empty_datasource_returns_empty(client):
    """GET /fields without datasource param returns empty response."""
    resp = client.get("/fields")
    assert resp.status_code == 200
    assert resp.text == ""


def test_fields_duckdb_url_label(client):
    """DuckDB url field shows 'Directory Path' label."""
    resp = client.get("/fields?datasource=duckdb")
    assert "Directory Path" in resp.text


def test_fields_duckdb_format_hidden(client):
    """DuckDB format field is a hidden input with value 'duckdb'."""
    resp = client.get("/fields?datasource=duckdb")
    assert 'type="hidden"' in resp.text
    assert 'value="duckdb"' in resp.text


def test_fields_snowflake_schema_label(client):
    """Snowflake sf_schema renders with label 'Schema' (not 'Sf Schema')."""
    resp = client.get("/fields?datasource=snowflake")
    # The label "Schema" should appear
    assert "Schema" in resp.text
    assert "Sf Schema" not in resp.text


# ── POST /save ─────────────────────────────────────────────────────────────────


def test_save_creates_profile(isolated_profiles):
    """POST /save with valid form data creates a profile in profiles.yml."""
    app, result, _ = create_app("my-pg")
    client = TestClient(app, raise_server_exceptions=True)

    resp = client.post(
        "/save",
        data={
            "_profile_name": "my-pg",
            "datasource": "postgres",
            "host": "db.example.com",
            "port": "5432",
            "database": "mydb",
            "user": "admin",
            "password": "secret",
        },
    )
    assert resp.status_code == 200
    assert "saved" in resp.text.lower()

    profiles = profile_mod.list_profiles()
    assert "my-pg" in profiles
    assert profiles["my-pg"]["host"] == "db.example.com"
    assert profiles["my-pg"]["datasource"] == "postgres"


def test_save_populates_result_dict(isolated_profiles):
    """POST /save populates the result dict returned by create_app."""
    app, result, _ = create_app("my-ds")
    client = TestClient(app, raise_server_exceptions=True)

    client.post(
        "/save",
        data={"_profile_name": "my-ds", "datasource": "duckdb", "url": "/data"},
    )
    assert result == {"name": "my-ds", "datasource": "duckdb"}


def test_save_missing_datasource(client):
    """POST /save without datasource returns 400 with an error message."""
    resp = client.post("/save", data={"_profile_name": "test-profile"})
    assert resp.status_code == 400
    assert "✗" in resp.text
    assert "data source" in resp.text.lower()


def test_save_with_json_fallback(isolated_profiles):
    """POST /save with _json field parses the JSON into the profile."""
    app, result, _ = create_app("json-profile")
    client = TestClient(app, raise_server_exceptions=True)

    conn_json = json.dumps({"host": "localhost", "port": "5432", "database": "dev"})
    resp = client.post(
        "/save",
        data={
            "_profile_name": "json-profile",
            "datasource": "postgres",
            "_json": conn_json,
        },
    )
    assert resp.status_code == 200
    assert "saved" in resp.text.lower()

    profiles = profile_mod.list_profiles()
    assert profiles["json-profile"]["host"] == "localhost"
    assert profiles["json-profile"]["database"] == "dev"


def test_save_invalid_json_returns_error(client):
    """POST /save with invalid _json returns 400 with an error message."""
    resp = client.post(
        "/save",
        data={
            "_profile_name": "test-profile",
            "datasource": "postgres",
            "_json": "{not valid json}",
        },
    )
    assert resp.status_code == 400
    assert "✗" in resp.text


def test_save_with_variant(isolated_profiles):
    """POST /save with bigquery variant sets the bigquery_type key."""
    app, result, _ = create_app("bq-profile")
    client = TestClient(app, raise_server_exceptions=True)

    resp = client.post(
        "/save",
        data={
            "_profile_name": "bq-profile",
            "datasource": "bigquery",
            "_variant": "project",
            "billing_project_id": "my-billing",
            "region": "US",
            "credentials": "eyJabc==",
        },
    )
    assert resp.status_code == 200
    assert "saved" in resp.text.lower()

    profiles = profile_mod.list_profiles()
    assert profiles["bq-profile"]["bigquery_type"] == "project"
    assert profiles["bq-profile"]["billing_project_id"] == "my-billing"


def test_save_skips_empty_fields(isolated_profiles):
    """POST /save ignores blank field values."""
    app, result, _ = create_app("pg-empty")
    client = TestClient(app, raise_server_exceptions=True)

    client.post(
        "/save",
        data={
            "_profile_name": "pg-empty",
            "datasource": "postgres",
            "host": "localhost",
            "port": "",  # blank — should not be saved
            "database": "mydb",
        },
    )
    profiles = profile_mod.list_profiles()
    assert "host" in profiles["pg-empty"]
    assert "port" not in profiles["pg-empty"]


def test_save_activate_flag(isolated_profiles):
    """create_app activate=True sets the profile as active after save."""
    app, result, _ = create_app("active-profile", activate=True)
    client = TestClient(app, raise_server_exceptions=True)

    client.post(
        "/save",
        data={"_profile_name": "active-profile", "datasource": "duckdb", "url": "/tmp"},
    )
    assert profile_mod.get_active_name() == "active-profile"


def test_save_no_activate(isolated_profiles):
    """create_app activate=False does not force activation."""
    # Add a first profile so there is already an active one
    profile_mod.add_profile("existing", {"datasource": "postgres"})

    app, result, _ = create_app("new-profile", activate=False)
    client = TestClient(app, raise_server_exceptions=True)

    client.post(
        "/save",
        data={"_profile_name": "new-profile", "datasource": "duckdb", "url": "/tmp"},
    )
    # "existing" remains active because activate=False
    assert profile_mod.get_active_name() == "existing"
