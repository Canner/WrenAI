"""Typer sub-app for ``wren genbi`` — locally-served Streamlit data apps."""

from __future__ import annotations

import json as _json
import uuid
from pathlib import Path
from typing import Annotated, Optional

import typer
import yaml

from wren.genbi import catalog, check, runstate, runtime

genbi_app = typer.Typer(
    name="genbi",
    help="Agent-generated, locally-served Streamlit data apps.",
)

_TEMPLATE = Path(__file__).parent / "templates" / "app.py.tmpl"

NameArg = Annotated[str, typer.Argument(help="App name (folder under apps/).")]
JsonOpt = Annotated[bool, typer.Option("--json", help="Machine-readable output.")]


def _project() -> Path:
    from wren.context import discover_project_path  # noqa: PLC0415

    return discover_project_path()


def _app_dir(project: Path, name: str) -> Path:
    return catalog.apps_dir(project) / name


def _entry_for(project: Path, name: str) -> Path:
    """Return the absolute app entry file, from the catalog or the default."""
    for e in catalog.read_index(project):
        if e.name == name:
            return catalog.apps_dir(project) / e.entry
    return _app_dir(project, name) / "app.py"


def _panels_path(project: Path, name: str) -> Path:
    return _app_dir(project, name) / "panels.yml"


def _load_panel_specs(project: Path, name: str) -> list[check.PanelSpec]:
    """Read declared cube panels from the app's optional panels.yml sidecar."""
    path = _panels_path(project, name)
    if not path.exists():
        return []
    data = yaml.safe_load(path.read_text()) or {}
    specs = []
    for row in data.get("panels", []):
        specs.append(
            check.PanelSpec(
                cube=row["cube"],
                measures=row.get("measures", []),
                dimensions=row.get("dimensions", []),
                time_dimensions=row.get("time_dimensions", []),
            )
        )
    return specs


def _load_manifest_dict(project: Path) -> dict:
    target = project / "target" / "mdl.json"
    if not target.exists():
        return {}
    return _json.loads(target.read_text())


# ── create ──────────────────────────────────────────────────────────────────


@genbi_app.command()
def create(
    name: NameArg,
    description: Annotated[str, typer.Option("--description", "-d")] = "",
    cube: Annotated[Optional[str], typer.Option("--cube")] = None,
    force: Annotated[bool, typer.Option("--force")] = False,
) -> None:
    """Scaffold a runnable app stub and register it in the catalog."""
    project = _project()

    # Cube precheck: an interactive (cube-backed) app needs the cube to exist.
    # This is a data prerequisite, not a pip dependency — guide, don't fail hard.
    manifest = _load_manifest_dict(project)
    cube_names = {
        c.get("name") for c in (manifest.get("cubes") or []) if isinstance(c, dict)
    }
    if cube is not None and manifest and cube not in cube_names:
        typer.echo(
            f"Error: cube '{cube}' is not defined in this project's MDL.\n"
            "  Interactive apps bind widgets to a cube. Define one first — e.g. "
            "via the `wren-enrich-context` cube flow — then rebuild "
            "(`wren context build`) and retry.",
            err=True,
        )
        raise typer.Exit(1)
    if cube is None and not cube_names:
        typer.echo(
            "Note: no cubes defined. This app can show static (raw-SQL) panels; "
            "for interactive dimension/filter widgets, add a cube first "
            "(e.g. `wren-enrich-context`)."
        )

    app_dir = _app_dir(project, name)
    entry_file = app_dir / "app.py"
    if entry_file.exists() and not force:
        typer.echo(f"Error: {entry_file} already exists. Use --force.", err=True)
        raise typer.Exit(1)
    app_dir.mkdir(parents=True, exist_ok=True)
    entry_file.write_text(_TEMPLATE.read_text().replace("{name}", name))
    catalog.add_entry(
        project,
        catalog.AppEntry(
            name=name, entry=f"{name}/app.py", description=description, cube=cube
        ),
    )
    typer.echo(f"Created app '{name}' at {entry_file}")


# ── serve ───────────────────────────────────────────────────────────────────


@genbi_app.command()
def serve(
    name: NameArg,
    port: Annotated[Optional[int], typer.Option("--port")] = None,
    json_out: JsonOpt = False,
) -> None:
    """Start (or attach to) the app and print its localhost URL."""
    project = _project()
    entry_file = _entry_for(project, name)
    if not entry_file.exists():
        typer.echo(f"Error: app '{name}' not found ({entry_file}).", err=True)
        raise typer.Exit(1)

    # MDL drift guard: refuse to serve an app whose declared panels no longer
    # match the manifest, naming exactly what's missing.
    specs = _load_panel_specs(project, name)
    if specs:
        issues = check.check_panels(specs, _load_manifest_dict(project))
        if issues:
            typer.echo("Error: app is out of sync with the MDL:", err=True)
            for i in issues:
                typer.echo(f"  - {i.message}", err=True)
            typer.echo("  Fix the app or rebuild the MDL, then retry.", err=True)
            raise typer.Exit(1)

    # Idempotent start-or-attach: reuse a healthy existing process.
    existing = runstate.load(project, name)
    if (
        existing
        and runtime.is_alive(existing.pid)
        and runtime.wait_healthy(existing.port, timeout=2, interval=0.2)
    ):
        _emit_url(existing.port, json_out, attached=True)
        return

    chosen = port or runtime.free_port()
    log_path = _app_dir(project, name) / ".wren-app.log"
    handle = runtime.spawn(
        runtime.streamlit_command(entry_file, chosen),
        cwd=project,
        log_path=log_path,
    )
    if not runtime.wait_healthy(chosen, timeout=30):
        runtime.stop(handle)
        tail = log_path.read_text()[-2000:] if log_path.exists() else ""
        typer.echo(f"Error: app '{name}' failed to start.\n{tail}", err=True)
        raise typer.Exit(1)

    runstate.save(
        project, name, handle=handle, port=chosen, start_token=uuid.uuid4().hex
    )
    _emit_url(chosen, json_out, attached=False)


def _emit_url(port: int, json_out: bool, *, attached: bool) -> None:
    url = f"http://localhost:{port}"
    if json_out:
        typer.echo(_json.dumps({"url": url, "port": port, "attached": attached}))
    else:
        verb = "Already running at" if attached else "Serving at"
        typer.echo(f"{verb} {url}")


# ── stop ────────────────────────────────────────────────────────────────────


@genbi_app.command()
def stop(
    name: Annotated[
        Optional[str], typer.Argument(help="App name. Omit with --all.")
    ] = None,
    all_: Annotated[
        bool, typer.Option("--all", help="Stop every running app.")
    ] = False,
) -> None:
    """Stop a running app (or all of them) and clear its run state."""
    project = _project()
    if all_:
        names = [e.name for e in catalog.read_index(project)]
    elif name:
        names = [name]
    else:
        typer.echo("Error: provide an app name or --all.", err=True)
        raise typer.Exit(1)

    stopped = 0
    for n in names:
        state = runstate.load(project, n)
        if not state:
            continue
        runtime.stop(runtime.ServeHandle(pid=state.pid, pgid=state.pgid))
        runstate.clear(project, n)
        stopped += 1
        typer.echo(f"Stopped '{n}'.")
    if stopped == 0:
        typer.echo("No running apps to stop.")


# ── list ────────────────────────────────────────────────────────────────────


@genbi_app.command(name="list")
def list_apps(json_out: JsonOpt = False) -> None:
    """List catalogued apps and whether each is currently running."""
    project = _project()
    entries = catalog.read_index(project)
    rows = []
    for e in entries:
        state = runstate.load(project, e.name)
        running = bool(
            state
            and runtime.is_alive(state.pid)
            and runtime.wait_healthy(state.port, timeout=1, interval=0.2)
        )
        rows.append(
            {
                "name": e.name,
                "description": e.description,
                "cube": e.cube,
                "running": running,
                "url": f"http://localhost:{state.port}" if running else None,
            }
        )
    recon = catalog.reconcile(project)
    if json_out:
        typer.echo(
            _json.dumps(
                {
                    "apps": rows,
                    "unregistered": recon.unregistered,
                    "missing_dir": recon.missing_dir,
                }
            )
        )
        return
    if not rows:
        typer.echo("No apps. Create one with `wren genbi create <name>`.")
    for r in rows:
        status = f"running {r['url']}" if r["running"] else "stopped"
        typer.echo(f"  {r['name']:20} {status:30} {r['description']}")
    for u in recon.unregistered:
        typer.echo(f"  (unregistered folder: {u})")
    for m in recon.missing_dir:
        typer.echo(f"  (missing files for: {m})")


# ── logs ────────────────────────────────────────────────────────────────────


@genbi_app.command()
def logs(
    name: NameArg,
    tail: Annotated[int, typer.Option("--tail", "-n")] = 50,
) -> None:
    """Show the tail of an app's captured stdout/stderr."""
    project = _project()
    log_path = _app_dir(project, name) / ".wren-app.log"
    if not log_path.exists():
        typer.echo(f"No log for '{name}' (has it been served?).")
        return
    lines = log_path.read_text().splitlines()
    for line in lines[-tail:]:
        typer.echo(line)


# ── check ───────────────────────────────────────────────────────────────────


@genbi_app.command(name="check")
def check_app(
    name: Annotated[Optional[str], typer.Argument()] = None,
    all_: Annotated[bool, typer.Option("--all")] = False,
    json_out: JsonOpt = False,
) -> None:
    """Validate declared cube panels against the current MDL (drift check)."""
    project = _project()
    manifest = _load_manifest_dict(project)
    names = (
        [e.name for e in catalog.read_index(project)]
        if all_
        else ([name] if name else [])
    )
    if not names:
        typer.echo("Error: provide an app name or --all.", err=True)
        raise typer.Exit(1)

    all_issues: dict[str, list] = {}
    for n in names:
        specs = _load_panel_specs(project, n)
        issues = check.check_panels(specs, manifest)
        if issues:
            all_issues[n] = [i.message for i in issues]

    if json_out:
        typer.echo(_json.dumps(all_issues))
    elif not all_issues:
        typer.echo("OK — no drift.")
    else:
        for n, msgs in all_issues.items():
            typer.echo(f"{n}:")
            for m in msgs:
                typer.echo(f"  - {m}")
    if all_issues:
        raise typer.Exit(1)
