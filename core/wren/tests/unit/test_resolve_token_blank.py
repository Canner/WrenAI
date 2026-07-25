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
