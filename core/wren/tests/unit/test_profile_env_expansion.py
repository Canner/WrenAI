"""Unit tests for ``wren.profile.expand_profile_secrets`` and ``.env`` discovery.

The loader is cross-platform by construction — python-dotenv normalises
line endings, ``pathlib`` handles the path separator, and
``string.Template`` does the substitution purely in Python.  Tests run
the same on Windows, macOS, and Linux.
"""

from __future__ import annotations

import pytest

from wren import profile as profile_mod
from wren.profile import (
    MissingSecretError,
    _reset_env_loaded_for_tests,
    expand_profile_secrets,
)

pytestmark = pytest.mark.unit


@pytest.fixture(autouse=True)
def _reset_dotenv_cache():
    """Force ``.env`` re-discovery between tests."""
    _reset_env_loaded_for_tests()
    yield
    _reset_env_loaded_for_tests()


# ── Basic substitution ──────────────────────────────────────────────────────


def test_plain_string_unchanged():
    # No ${...} → passes through untouched.
    assert expand_profile_secrets({"password": "plain-text"}) == {
        "password": "plain-text"
    }


def test_expands_simple_var(monkeypatch):
    monkeypatch.setenv("PG_PASSWORD", "s3cr3t")
    assert expand_profile_secrets({"password": "${PG_PASSWORD}"}) == {
        "password": "s3cr3t"
    }


def test_expands_inside_larger_string(monkeypatch):
    monkeypatch.setenv("USER_NAME", "paul")
    monkeypatch.setenv("HOST_NAME", "db.local")
    assert expand_profile_secrets({"url": "postgres://${USER_NAME}@${HOST_NAME}/x"}) == {
        "url": "postgres://paul@db.local/x"
    }


def test_undefined_var_raises(monkeypatch):
    monkeypatch.delenv("NOT_SET", raising=False)
    with pytest.raises(MissingSecretError) as excinfo:
        expand_profile_secrets({"password": "${NOT_SET}"})
    assert "NOT_SET" in str(excinfo.value)


# ── Case / escape / pattern rules ──────────────────────────────────────────


def test_lowercase_ref_not_treated_as_var(monkeypatch):
    """``${foo}`` (lowercase) is not a valid identifier, so it stays literal."""
    monkeypatch.setenv("foo", "x")
    # string.Template raises on a malformed identifier; we wrap it as
    # MissingSecretError with a "malformed reference" message.
    with pytest.raises(MissingSecretError):
        expand_profile_secrets({"password": "${foo}"})


def test_double_dollar_escapes_to_literal():
    # ``$$`` in a value becomes ``$`` — users with a literal $ in passwords
    # can escape once to avoid the substitution pass.
    assert expand_profile_secrets({"password": "a$$b"}) == {"password": "a$b"}


def test_mixed_escape_and_var(monkeypatch):
    monkeypatch.setenv("X", "v")
    assert expand_profile_secrets({"k": "$${literal}-${X}"}) == {
        "k": "${literal}-v"
    }


# ── Nested structures ──────────────────────────────────────────────────────


def test_expands_inside_nested_dict(monkeypatch):
    monkeypatch.setenv("PG_PW", "hunter2")
    profile = {
        "datasource": "mysql",
        "host": "db.local",
        "kwargs": {"password": "${PG_PW}", "ssl_disabled": "true"},
    }
    expanded = expand_profile_secrets(profile)
    assert expanded["kwargs"]["password"] == "hunter2"
    assert expanded["kwargs"]["ssl_disabled"] == "true"
    assert expanded["host"] == "db.local"


def test_non_string_values_preserved(monkeypatch):
    profile = {"port": 5432, "ssl": True, "tags": ["a", "b"]}
    assert expand_profile_secrets(profile) == profile


def test_list_of_strings_expanded(monkeypatch):
    monkeypatch.setenv("A", "x")
    monkeypatch.setenv("B", "y")
    assert expand_profile_secrets({"names": ["${A}", "${B}"]}) == {
        "names": ["x", "y"]
    }


# ── .env file loading ──────────────────────────────────────────────────────


def test_dotenv_fallback_when_shell_lacks_var(tmp_path, monkeypatch):
    monkeypatch.delenv("FROM_DOTENV", raising=False)
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".env").write_text("FROM_DOTENV=from_file\n")
    assert expand_profile_secrets({"k": "${FROM_DOTENV}"}) == {"k": "from_file"}


def test_shell_export_beats_dotenv(tmp_path, monkeypatch):
    """Process environment must win so ops can override per-invocation."""
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".env").write_text("CONTEST=from_file\n")
    monkeypatch.setenv("CONTEST", "from_shell")
    assert expand_profile_secrets({"k": "${CONTEST}"}) == {"k": "from_shell"}


def test_user_global_env_is_used(tmp_path, monkeypatch):
    """``~/.wren/.env`` provides a fallback for operators sharing secrets
    across multiple projects."""
    monkeypatch.delenv("GLOBAL_VAR", raising=False)
    wren_home = tmp_path / ".wren"
    wren_home.mkdir()
    (wren_home / ".env").write_text("GLOBAL_VAR=global\n")
    monkeypatch.setattr(profile_mod, "_WREN_HOME", wren_home)
    monkeypatch.chdir(tmp_path)  # no project-local .env
    assert expand_profile_secrets({"k": "${GLOBAL_VAR}"}) == {"k": "global"}


def test_project_root_env_loaded_when_cwd_is_subdir(tmp_path, monkeypatch):
    """A .env at the project root is picked up even when cwd is a subfolder
    (mirrors the typical ``cd subdir && wren --sql`` usage)."""
    monkeypatch.delenv("PROJECT_VAR", raising=False)
    (tmp_path / "wren_project.yml").write_text("name: test\n")
    (tmp_path / ".env").write_text("PROJECT_VAR=from_root\n")
    subdir = tmp_path / "sub"
    subdir.mkdir()
    monkeypatch.chdir(subdir)
    assert expand_profile_secrets({"k": "${PROJECT_VAR}"}) == {"k": "from_root"}


# ── Debug must not expand ──────────────────────────────────────────────────


def test_debug_profile_returns_literal_placeholder(tmp_path, monkeypatch):
    """``wren profile debug`` shows the ``${VAR}`` text, never the real value."""
    profiles_file = tmp_path / "profiles.yml"
    monkeypatch.setattr(profile_mod, "_WREN_HOME", tmp_path)
    monkeypatch.setattr(profile_mod, "_PROFILES_FILE", profiles_file)

    profile_mod.add_profile(
        "pg",
        {
            "datasource": "postgres",
            "host": "db.local",
            "password": "${PG_PW}",
        },
    )
    monkeypatch.setenv("PG_PW", "would_leak_if_expanded")

    info = profile_mod.debug_profile("pg")
    assert info["config"]["password"] == "***"  # masked by debug, not expanded
    # The raw stored value should also still be the placeholder
    raw = profile_mod._load_raw()["profiles"]["pg"]
    assert raw["password"] == "${PG_PW}"


def test_debug_masks_registry_sensitive_fields(tmp_path, monkeypatch):
    """Fields the connection-field registry marks SecretStr, but whose names match
    no substring in the local heuristic (``pat``, ``connection_url``, ``dsn``,
    ``ssl_ca``, and the camelCase alias ``clientId``), must still be masked when a
    literal value is stored. ``debug`` must not diverge from the field registry —
    the single source of truth for field sensitivity."""
    monkeypatch.setattr(profile_mod, "_WREN_HOME", tmp_path)
    monkeypatch.setattr(profile_mod, "_PROFILES_FILE", tmp_path / "profiles.yml")

    cases = [
        ("canner_p", {"datasource": "canner", "host": "h", "pat": "SECRET"}, "pat"),
        (
            "url_p",
            {"datasource": "postgres", "connection_url": "postgresql://u:PW@h/db"},
            "connection_url",
        ),
        ("oracle_p", {"datasource": "oracle", "dsn": "admin/PW@h:1521/db"}, "dsn"),
        ("mysql_p", {"datasource": "mysql", "ssl_ca": "CERT"}, "ssl_ca"),
        ("dbx_p", {"datasource": "databricks", "clientId": "abc"}, "clientId"),
    ]
    for name, prof, key in cases:
        profile_mod.add_profile(name, prof)
        assert profile_mod.debug_profile(name)["config"][key] == "***", key


def test_debug_masks_nested_sensitive_fields(tmp_path, monkeypatch):
    """Secrets nested under ``kwargs``/``settings`` must be masked too.

    ``expand_profile_secrets`` walks dicts and lists recursively so
    ``kwargs: {password: ${PG_PW}}`` resolves; masking must cover the same
    shape, or ``debug`` under-masks exactly the values expansion supports.
    """
    monkeypatch.setattr(profile_mod, "_WREN_HOME", tmp_path)
    monkeypatch.setattr(profile_mod, "_PROFILES_FILE", tmp_path / "profiles.yml")

    profile_mod.add_profile(
        "pg",
        {
            "datasource": "postgres",
            "host": "db.local",
            "password": "TOP",
            "kwargs": {"password": "NESTED", "connection_url": "postgresql://u:PW@h"},
            "settings": {"deep": {"token": "DEEP"}},
            "extras": [{"secret": "IN_LIST"}],
        },
    )

    cfg = profile_mod.debug_profile("pg")["config"]
    assert cfg["password"] == "***"
    assert cfg["kwargs"]["password"] == "***"
    assert cfg["kwargs"]["connection_url"] == "***"  # registry-sensitive, nested
    assert cfg["settings"]["deep"]["token"] == "***"  # arbitrary depth
    assert cfg["extras"][0]["secret"] == "***"  # dicts inside lists


def test_debug_leaves_nested_benign_fields_intact(tmp_path, monkeypatch):
    """Recursive masking must not over-mask: benign nested values survive.

    Reverse anchor for ``test_debug_masks_nested_sensitive_fields`` — walking
    nested containers must not turn every nested value into ``***``.
    """
    monkeypatch.setattr(profile_mod, "_WREN_HOME", tmp_path)
    monkeypatch.setattr(profile_mod, "_PROFILES_FILE", tmp_path / "profiles.yml")

    profile_mod.add_profile(
        "pg",
        {
            "datasource": "postgres",
            "host": "db.local",
            "kwargs": {"sslmode": "require", "connect_timeout": 10},
            "extras": [{"retries": 3}],
        },
    )

    cfg = profile_mod.debug_profile("pg")["config"]
    assert cfg["kwargs"]["sslmode"] == "require"
    assert cfg["kwargs"]["connect_timeout"] == 10
    assert cfg["extras"][0]["retries"] == 3
