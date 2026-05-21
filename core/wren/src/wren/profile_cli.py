"""Typer sub-app for ``wren profile`` commands."""

from __future__ import annotations

import json
from typing import Annotated, Optional

import typer
import yaml

profile_app = typer.Typer(
    name="profile",
    help="Manage connection profiles (~/.wren/profiles.yml).",
)


@profile_app.command("list")
def list_cmd() -> None:
    """List all profiles, highlighting the active one."""
    from wren.profile import get_active_name, list_profiles  # noqa: PLC0415

    try:
        profiles = list_profiles()
        active = get_active_name()
    except ValueError as exc:
        typer.echo(f"Error: {exc}", err=True)
        raise typer.Exit(1)
    if not profiles:
        typer.echo("No profiles configured. Run `wren profile add` to create one.")
        return
    for name, conf in profiles.items():
        marker = " *" if name == active else ""
        ds = conf.get("datasource", "?")
        typer.echo(f"  {name}{marker}  ({ds})")


@profile_app.command()
def add(
    name: Annotated[str, typer.Argument(help="Profile name")],
    datasource: Annotated[
        Optional[str],
        typer.Option("--datasource", "-d", help="Data source type"),
    ] = None,
    from_file: Annotated[
        Optional[str],
        typer.Option(
            "--from-file", "-f", help="Import from a JSON/YAML connection file"
        ),
    ] = None,
    activate: Annotated[
        bool, typer.Option("--activate", help="Set as active profile")
    ] = False,
    interactive: Annotated[
        bool, typer.Option("--interactive", "-i", help="Interactive prompts")
    ] = False,
    ui: Annotated[
        bool,
        typer.Option("--ui", help="Open browser-based form to fill connection fields"),
    ] = False,
    ui_port: Annotated[
        int, typer.Option("--port", help="Port for the UI server (0 = auto-select)")
    ] = 0,
    no_open: Annotated[
        bool, typer.Option("--no-open", help="Don't auto-open browser (just print URL)")
    ] = False,
    no_validate: Annotated[
        bool,
        typer.Option(
            "--no-validate",
            help="Skip the connection test after save (default: validate).",
        ),
    ] = False,
) -> None:
    """Add a new connection profile.

    Four modes: --ui (browser form), --from-file (import), --interactive
    (guided prompts), or inline --datasource (minimal profile).

    The saved profile is validated against its database by default — a
    failed validation is reported as a warning without deleting the
    profile, so the user can fix it with ``wren profile add --ui`` or
    by editing ``~/.wren/profiles.yml``.
    """
    from wren.profile import add_profile  # noqa: PLC0415

    selected_modes = sum(bool(flag) for flag in (ui, from_file, interactive))
    if selected_modes > 1:
        typer.echo(
            "Error: choose only one of --ui, --from-file, or --interactive.",
            err=True,
        )
        raise typer.Exit(1)

    if ui:
        # starlette / uvicorn / jinja2 ship with core wrenai so this
        # import normally succeeds; the except branch is defensive for
        # broken installs where the web stack got stripped.
        try:
            from wren.profile_web import start as web_start  # noqa: PLC0415
        except ImportError as e:
            if e.name not in {"starlette", "uvicorn", "jinja2"}:
                raise
            typer.echo(
                "Error: --ui requires the browser UI dependencies, which "
                "normally ship with wrenai.\n"
                "Reinstall wrenai, or use --interactive instead.",
                err=True,
            )
            raise typer.Exit(1)
        if not no_open:
            typer.echo("Opening browser... (press Ctrl+C to cancel)")
        result = web_start(
            name, activate=activate, port=ui_port, open_browser=not no_open
        )
        if result:
            typer.echo(
                f"Profile '{result['name']}' saved (datasource: {result['datasource']})"
            )
            if activate:
                typer.echo(f"  Profile '{result['name']}' is now active.")
            _post_add(result["name"], validate=not no_validate, minimal=False)
        else:
            typer.echo("Cancelled.", err=True)
            raise typer.Exit(1)
        return

    minimal = False
    if from_file:
        from pathlib import Path  # noqa: PLC0415

        path = Path(from_file).expanduser()
        if not path.exists():
            typer.echo(f"Error: file not found: {from_file}", err=True)
            raise typer.Exit(1)
        try:
            text = path.read_text()
            if path.suffix in (".yml", ".yaml"):
                raw = yaml.safe_load(text)
            else:
                raw = json.loads(text)
        except Exception as exc:
            typer.echo(f"Error: could not parse {from_file}: {exc}", err=True)
            raise typer.Exit(1)
        if not isinstance(raw, dict):
            typer.echo("Error: file must contain a JSON/YAML object.", err=True)
            raise typer.Exit(1)
        try:
            profile_data = _flatten_connection_envelope(raw)
        except ValueError as exc:
            typer.echo(f"Error: {exc}", err=True)
            raise typer.Exit(1)
    elif interactive:
        profile_data = _interactive_add(datasource)
    else:
        if not datasource:
            typer.echo(
                "Error: --datasource is required (or use --interactive / --from-file).",
                err=True,
            )
            raise typer.Exit(1)
        profile_data = {"datasource": datasource}
        typer.echo(
            f"Created minimal profile '{name}' with datasource={datasource}. "
            "Edit ~/.wren/profiles.yml to add connection fields."
        )
        minimal = True

    add_profile(name, profile_data, activate=activate)
    typer.echo(f"Profile '{name}' added.")
    _post_add(name, validate=not no_validate, minimal=minimal)


def _flatten_connection_envelope(raw: dict) -> dict:
    """Accept the few shapes users/agents actually produce and emit a flat dict.

    The CLI's internal profile format is flat — ``{datasource, host, port, …}``.
    We accept exactly two shapes:

    - flat:       ``{datasource: …, host: …, port: …}``
    - properties: ``{datasource: …, properties: {host: …, …}}`` (legacy
      MCP / web shape)

    Other guessed envelopes (``connection:``, ``config:``) are rejected
    with a message showing the expected flat form, so the user isn't
    left debugging a dict of dicts.
    """
    if isinstance(raw.get("properties"), dict):
        inner = dict(raw["properties"])
        # Merge top-level scalar keys (datasource, aliases) into the inner
        # dict; top-level keys win if both sides set the same name.
        outer = {k: v for k, v in raw.items() if k != "properties"}
        inner.update(outer)
        flat = inner
    else:
        # Reject stray nested dicts we don't know how to interpret — much
        # better than silently storing them and failing later.
        unknown_nested = [
            k
            for k, v in raw.items()
            if isinstance(v, dict) and k not in {"kwargs", "settings"}
        ]
        if unknown_nested:
            raise ValueError(
                f"Unexpected nested key(s) {unknown_nested!r}. "
                "Connection fields must be flat — see "
                "https://docs.getwren.ai/oss/engine/guide/profiles for the "
                "supported shapes."
            )
        flat = dict(raw)

    if not flat.get("datasource"):
        raise ValueError("imported file must contain a 'datasource' key.")
    return flat


def _post_add(name: str, *, validate: bool, minimal: bool) -> None:
    """Run validation (optional) and print the next-step hint.

    The hint is only printed when validation was skipped or succeeded;
    printing it after a ``⚠ Connection failed`` line would mislead the
    user into running ``wren context init`` against a broken profile.
    """
    ok = True
    if validate and not minimal:
        ok = _validate_connection(name)
    if ok:
        typer.echo("")
        typer.echo("Next: wren context init")


def _retry_hint(name: str) -> str:
    """Retry instruction shown after a validation warning.

    Mentions every way the user may have created the profile so the hint
    is correct whether they used ``--from-file``, ``--ui``, or the
    guided interactive flow.
    """
    return (
        f"  Fix .env / profile fields, then retry with your original method:\n"
        f"    wren profile add {name} --from-file <path>   # dotenv-driven\n"
        f"    wren profile add {name} --ui                 # browser form\n"
        f"    wren profile add {name} --interactive        # prompt-driven"
    )


def _validate_connection(name: str) -> bool:
    """Test the saved profile by running ``SELECT 1`` through its connector.

    Returns ``True`` on success and ``False`` on any warning path so the
    caller can suppress misleading next-step hints.  Connection failure
    is a warning, not an error — the profile stays on disk so the user
    can fix and retry.  We deliberately surface the raw driver error so
    they know what to change.

    Resolves ``${VAR}`` references just before handing the connection
    info to the connector; the stored profile keeps the placeholders.
    """
    from pydantic import ValidationError  # noqa: PLC0415

    from wren.connector.factory import get_connector  # noqa: PLC0415
    from wren.model.data_source import DataSource  # noqa: PLC0415
    from wren.profile import (  # noqa: PLC0415
        MissingSecretError,
        _load_raw,
        expand_profile_secrets,
    )

    profile = _load_raw().get("profiles", {}).get(name)
    if not profile:
        return False  # should not happen — profile was just added

    ds_str = profile.get("datasource")
    if not isinstance(ds_str, str) or not ds_str:
        typer.echo("⚠ Cannot validate: profile has no datasource.", err=True)
        return False
    typer.echo("→ Validating connection...")
    try:
        ds = DataSource(ds_str.lower())
    except ValueError:
        typer.echo(f"⚠ Cannot validate: unknown datasource {ds_str!r}", err=True)
        return False

    conn_info_dict = {k: v for k, v in profile.items() if k != "datasource"}
    try:
        conn_info_dict = expand_profile_secrets(conn_info_dict)
    except MissingSecretError as exc:
        typer.echo(f"⚠ Cannot validate: {exc}", err=True)
        typer.echo(_retry_hint(name), err=True)
        return False

    # Convert the flat dict into the datasource's typed ConnectionInfo
    # *before* calling get_connector.  Connectors read attributes like
    # ``info.kwargs`` / ``info.host`` and raise AttributeError on a plain
    # dict, which would swallow the actual driver error (e.g. MySQL 1044
    # Access Denied) and report "'dict' object has no attribute 'kwargs'"
    # instead.  WrenEngine does the same conversion when initialised from
    # a dict; we mirror that code path here.
    try:
        conn_info = ds.get_connection_info(conn_info_dict)
    except (ValidationError, ValueError) as exc:
        typer.echo(f"⚠ Cannot validate: invalid connection info: {exc}", err=True)
        typer.echo(_retry_hint(name), err=True)
        return False

    try:
        connector = get_connector(ds, conn_info)
        connector.dry_run("SELECT 1")
    except Exception as exc:  # noqa: BLE001 — surface whatever driver raises
        typer.echo(f"⚠ Connection failed: {exc}", err=True)
        typer.echo(
            "  The profile has been saved. To fix:\n"
            "    wren profile debug                 # show resolved config\n"
            f"    wren profile add {name} --ui       # edit and re-validate",
            err=True,
        )
        return False
    typer.echo("✓ Connection validated")
    return True


def _interactive_add(default_ds: str | None) -> dict:
    """Guided interactive profile creation using shared field registry."""
    import click  # noqa: PLC0415

    from wren.model.field_registry import (  # noqa: PLC0415
        get_datasource_options,
        get_fields,
        get_variants,
    )

    ds_choices = get_datasource_options()
    ds = typer.prompt(
        "Data source",
        default=default_ds,
        type=click.Choice(ds_choices, case_sensitive=False),
    )
    profile: dict = {"datasource": ds}

    # Handle datasources with subtypes (bigquery, redshift, databricks)
    variants = get_variants(ds)
    if variants:
        variant = typer.prompt(
            f"  Type ({', '.join(variants)})",
            type=click.Choice(variants, case_sensitive=False),
        )
        profile[f"{ds}_type"] = variant
    else:
        variant = None

    fields = get_fields(ds, variant=variant)

    for f in fields:
        # Hidden fields (e.g. duckdb format, discriminator fields) are injected automatically
        if f.input_type == "hidden":
            if f.default is not None:
                profile[f.name] = f.default
            continue
        # File fields: accept a path, read & base64-encode
        if f.input_type == "file_base64":
            path_str = typer.prompt(
                f"  {f.label} (file path)", default="", show_default=False
            )
            if path_str:
                import base64  # noqa: PLC0415
                from pathlib import Path  # noqa: PLC0415

                file_path = Path(path_str).expanduser()
                try:
                    content = file_path.read_bytes()
                    profile[f.name] = base64.b64encode(content).decode()
                except (FileNotFoundError, PermissionError) as e:
                    if f.required:
                        typer.echo(
                            f"  Error: required file not readable: {e}", err=True
                        )
                        raise typer.Exit(1)
                    typer.echo(f"  Warning: could not read file: {e}", err=True)
            elif f.required:
                typer.echo(f"  Error: {f.label} is required.", err=True)
                raise typer.Exit(1)
        # Sensitive fields: hide input
        elif f.sensitive or f.input_type == "password":
            value = typer.prompt(
                f"  {f.label}",
                default=f.default or "",
                show_default=False,
                hide_input=True,
            )
            if value:
                profile[f.name] = value
            elif f.required:
                typer.echo(f"  Error: {f.label} is required.", err=True)
                raise typer.Exit(1)
        # Normal text fields
        else:
            prompt_default = f.default or ""
            prompt_label = f"  {f.label}"
            if f.placeholder and not f.default:
                prompt_label += f" ({f.placeholder})"
            value = typer.prompt(
                prompt_label,
                default=prompt_default,
                show_default=bool(f.default),
            )
            if value:
                profile[f.name] = value
            elif f.required:
                typer.echo(f"  Error: {f.label} is required.", err=True)
                raise typer.Exit(1)
    return profile


@profile_app.command()
def rm(
    name: Annotated[str, typer.Argument(help="Profile name to remove")],
    force: Annotated[
        bool, typer.Option("--force", "-f", help="Skip confirmation")
    ] = False,
) -> None:
    """Remove a profile."""
    from wren.profile import remove_profile  # noqa: PLC0415

    if not force:
        confirm = typer.confirm(f"Remove profile '{name}'?")
        if not confirm:
            raise typer.Abort()
    try:
        found = remove_profile(name)
    except ValueError as exc:
        typer.echo(f"Error: {exc}", err=True)
        raise typer.Exit(1)
    if found:
        typer.echo(f"Profile '{name}' removed.")
    else:
        typer.echo(f"Error: profile '{name}' not found.", err=True)
        raise typer.Exit(1)


@profile_app.command()
def switch(
    name: Annotated[str, typer.Argument(help="Profile name to activate")],
) -> None:
    """Switch the active profile."""
    from wren.profile import switch_profile  # noqa: PLC0415

    try:
        found = switch_profile(name)
    except ValueError as exc:
        typer.echo(f"Error: {exc}", err=True)
        raise typer.Exit(1)
    if found:
        typer.echo(f"Active profile: {name}")
    else:
        typer.echo(f"Error: profile '{name}' not found.", err=True)
        raise typer.Exit(1)


@profile_app.command()
def debug(
    name: Annotated[
        Optional[str], typer.Argument(help="Profile name (default: active)")
    ] = None,
) -> None:
    """Show resolved profile config (sensitive fields masked)."""
    from wren.profile import debug_profile  # noqa: PLC0415

    try:
        info = debug_profile(name)
    except ValueError as exc:
        typer.echo(f"Error: {exc}", err=True)
        raise typer.Exit(1)
    if "error" in info:
        typer.echo(f"Error: {info['error']}", err=True)
        raise typer.Exit(1)
    typer.echo(json.dumps(info, indent=2, ensure_ascii=False))
