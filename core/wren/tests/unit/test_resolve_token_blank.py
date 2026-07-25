from pathlib import Path

from wren.genbi.tokens import resolve_token


def test_resolve_token_treats_blank_env_as_missing(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("VERCEL_TOKEN", "   ")
    # Avoid loading real dotenv environment side effects: stub _ensure_env_loaded
    import wren.profile as profile

    monkeypatch.setattr(profile, "_ensure_env_loaded", lambda: None)
    assert resolve_token("VERCEL_TOKEN", tmp_path) is None


def test_resolve_token_strips(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("VERCEL_TOKEN", "  abc  ")
    import wren.profile as profile

    monkeypatch.setattr(profile, "_ensure_env_loaded", lambda: None)
    assert resolve_token("VERCEL_TOKEN", tmp_path) == "abc"


def test_resolve_token_blank_env_falls_back_to_standard_dotenv(
    monkeypatch, tmp_path: Path
):
    """A blank shell value must not shadow a valid token in $CWD/.env."""
    monkeypatch.setenv("VERCEL_TOKEN", "   ")
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".env").write_text("VERCEL_TOKEN=from-dotenv\n")

    # Exercise the real _ensure_env_loaded discovery (reset its one-shot latch).
    import wren.profile as profile

    monkeypatch.setattr(profile, "_env_loaded", False)
    assert resolve_token("VERCEL_TOKEN", tmp_path) == "from-dotenv"


def test_resolve_token_blank_in_project_env_is_missing(monkeypatch, tmp_path: Path):
    """A whitespace-only token in the explicit project .env normalizes to None."""
    import wren.profile as profile

    monkeypatch.delenv("VERCEL_TOKEN", raising=False)
    monkeypatch.setattr(profile, "_ensure_env_loaded", lambda: None)
    (tmp_path / ".env").write_text('VERCEL_TOKEN="   "\n')
    assert resolve_token("VERCEL_TOKEN", tmp_path) is None
