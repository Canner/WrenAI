"""Typer sub-app for ``wren context`` commands."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, Optional

import typer

context_app = typer.Typer(
    name="context",
    help=(
        "Manage MDL context — models, views, relationships, and instructions.\n\n"
        "Bind a profile (or pass --data-source to init) before finalizing "
        "a project. Finalizing after writing/editing YAML is exactly two "
        "commands, in this order: `validate` then `build`. `build` is the "
        "one command that compiles everything into target/mdl.json (the "
        "artifact the engine reads) — no other subcommand is needed to "
        "finish/compile a project. `upgrade` is unrelated (schema_version "
        "migration only)."
    ),
)


ProjectPathOpt = Annotated[
    Optional[str],
    typer.Option(
        "--path",
        "-p",
        help="Project directory. Auto-detected via WREN_PROJECT_HOME, cwd walk, or ~/.wren/config.yml.",
    ),
]

FromOsiOpt = Annotated[
    Optional[str],
    typer.Option(
        "--from-osi",
        help=(
            "Use an Open Semantic Interchange (OSI) YAML file as the source "
            "of truth instead of a wren YAML project. The OSI file is read "
            "as-is; --data-source must be supplied separately."
        ),
    ),
]

DataSourceOpt = Annotated[
    Optional[str],
    typer.Option(
        "--data-source",
        help=(
            "Target data source (postgres, snowflake, bigquery, ...). "
            "Required when --from-osi is used; optional otherwise — sets "
            "the scaffolded project's data_source instead of leaving it "
            "blank."
        ),
    ),
]

SemanticModelOpt = Annotated[
    Optional[str],
    typer.Option(
        "--semantic-model",
        help=(
            "Name of the semantic_model to convert when --from-osi is used "
            "and the OSI file contains more than one."
        ),
    ),
]


@context_app.command("import")
def import_cmd(
    source: Annotated[str, typer.Argument(help="Import source (currently: dbt)")],
    path: ProjectPathOpt = None,
    project_dir: Annotated[
        Optional[str],
        typer.Option(
            "--project-dir",
            help="dbt project directory containing dbt_project.yml.",
        ),
    ] = None,
    profiles_path: Annotated[
        Optional[str],
        typer.Option("--profiles-path", help="Path to dbt profiles.yml."),
    ] = None,
    profile_name: Annotated[
        Optional[str],
        typer.Option("--profile", help="dbt profile name override."),
    ] = None,
    target_name: Annotated[
        Optional[str],
        typer.Option("--target", help="dbt target name override."),
    ] = None,
    dry_run: Annotated[
        bool,
        typer.Option("--dry-run", help="Preview generated files without writing."),
    ] = False,
    force: Annotated[
        bool,
        typer.Option("--force", help="Overwrite generated Wren project files."),
    ] = False,
) -> None:
    """Import a Wren project from an external source."""
    if source != "dbt":
        typer.echo(
            f"Error: unsupported import source '{source}'. Only 'dbt' is supported.",
            err=True,
        )
        raise typer.Exit(1)

    from wren.context import write_project_files  # noqa: PLC0415
    from wren.dbt import (  # noqa: PLC0415
        DbtLoadError,
        convert_dbt_project_to_wren_project,
    )

    dbt_project_dir = project_dir or "."
    output_path = Path(path).expanduser() if path else Path.cwd()

    try:
        imported = convert_dbt_project_to_wren_project(
            dbt_project_dir,
            output_dir=output_path,
            profiles_path=profiles_path,
            profile_name=profile_name,
            target_name=target_name,
        )
    except DbtLoadError as exc:
        typer.echo(f"Error: {exc}", err=True)
        raise typer.Exit(1)

    if dry_run:
        typer.echo("Dry run — files that would be written:")
        for project_file in imported.files:
            typer.echo(f"  {project_file.relative_path}")
    else:
        try:
            write_project_files(imported.files, output_path, force=force)
        except SystemExit as exc:
            typer.echo(str(exc), err=True)
            raise typer.Exit(1)
        typer.echo(f"Imported dbt project to Wren project at {output_path}/")

    typer.echo(
        f"  {imported.model_count} dbt models, {imported.source_count} sources, "
        f"{imported.relationship_count} relationships"
    )
    if imported.skipped_ephemeral:
        typer.echo(f"  skipped {imported.skipped_ephemeral} ephemeral model(s)")
    if imported.skipped_without_columns:
        typer.echo(
            f"  skipped {imported.skipped_without_columns} node(s) without catalog columns"
        )
    if dry_run:
        return

    typer.echo("\nNext steps:")
    typer.echo(f"  wren context validate --path {output_path}")
    typer.echo(f"  wren context build --path {output_path}")


@context_app.command()
def init(
    path: ProjectPathOpt = None,
    from_mdl: Annotated[
        Optional[str],
        typer.Option("--from-mdl", help="Import from MDL JSON file (camelCase)."),
    ] = None,
    from_osi: Annotated[
        Optional[str],
        typer.Option(
            "--from-osi",
            help=(
                "Migrate from an Open Semantic Interchange (OSI) YAML file. "
                "One-way conversion: produces a native wren project; the "
                "OSI file is no longer referenced afterwards. Requires "
                "--data-source."
            ),
        ),
    ] = None,
    data_source: DataSourceOpt = None,
    semantic_model: SemanticModelOpt = None,
    force: Annotated[
        bool,
        typer.Option("--force", help="Overwrite existing project files."),
    ] = False,
    empty: Annotated[
        bool,
        typer.Option(
            "--empty",
            help=(
                "Skip the placeholder example model and view. "
                "Useful when an AI agent (or a subsequent --from-mdl import) "
                "will populate models/ itself."
            ),
        ),
    ] = False,
    profile: Annotated[
        Optional[str],
        typer.Option(
            "--profile",
            help=(
                "Pin this named profile (see `wren profile list`) to the new "
                "project immediately and explicitly, instead of guessing "
                "from ambient state."
            ),
        ),
    ] = None,
) -> None:
    """Initialize a new Wren project.

    Without --from-mdl / --from-osi: scaffolds the project. Pass ``--empty``
    to leave ``models/`` and ``views/`` untouched (no placeholder example).

    With --from-mdl: imports an existing MDL JSON.

    With --from-osi: migrates from an OSI semantic_model file. Use this when
    you want to leave the OSI flow and own the YAML going forward; for
    keeping OSI as the source of truth, use ``wren context build --from-osi``
    instead.

    This command only scaffolds/imports files — it does not compile the
    project. Bind a profile (or pass ``--data-source``) before writing or
    validating models/views/relationships, then finalize with ``wren context
    validate`` followed by ``wren context build``. Run this once per project
    directory; do not re-run it to "finish" a project — that's what ``build``
    is for.
    """
    if from_mdl and from_osi:
        typer.echo(
            "Error: --from-mdl and --from-osi are mutually exclusive.",
            err=True,
        )
        raise typer.Exit(1)

    project_path = Path(path).expanduser() if path else Path.cwd()

    if from_osi:
        _init_from_osi(
            from_osi=from_osi,
            data_source=data_source,
            semantic_model=semantic_model,
            project_path=project_path,
            force=force,
        )
        return

    if from_mdl:
        # ── Import from MDL JSON ──────────────────────────────
        from wren.context import (  # noqa: PLC0415
            convert_mdl_to_project,
            write_project_files,
        )

        mdl_path = Path(from_mdl).expanduser()
        if not mdl_path.exists():
            typer.echo(f"Error: {mdl_path} not found.", err=True)
            raise typer.Exit(1)

        mdl_json = json.loads(mdl_path.read_text(encoding="utf-8"))
        files = convert_mdl_to_project(mdl_json)
        try:
            write_project_files(files, project_path, force=force)
        except SystemExit as e:
            typer.echo(str(e), err=True)
            raise typer.Exit(1)

        model_count = len(mdl_json.get("models", []))
        view_count = len(mdl_json.get("views", []))
        rel_count = len(mdl_json.get("relationships", []))

        typer.echo(f"Imported MDL to YAML project at {project_path}/")
        typer.echo(
            f"  {model_count} models, {view_count} views, {rel_count} relationships"
        )
        typer.echo("\nNext steps:")
        typer.echo(f"  wren context validate --path {project_path}")
        typer.echo(f"  wren context build --path {project_path}")
        return

    # ── Scaffold empty project (existing behavior) ────────────
    from wren.context import PROJECT_FILE  # noqa: PLC0415

    project_file = project_path / PROJECT_FILE
    agents_file = project_path / "AGENTS.md"
    conflicts = [f for f in (project_file, agents_file) if f.exists()]
    if conflicts and not force:
        names = ", ".join(f"'{c.name}'" for c in conflicts)
        typer.echo(
            f"Error: {names} already exists. Use --force to overwrite.",
            err=True,
        )
        raise typer.Exit(1)

    # Create directory structure
    (project_path / "models").mkdir(parents=True, exist_ok=True)
    (project_path / "views").mkdir(parents=True, exist_ok=True)
    (project_path / "cubes").mkdir(parents=True, exist_ok=True)

    # wren_project.yml
    #
    # data_source is intentionally left blank unless --data-source was
    # given: a placeholder like "postgres" would look like a deliberate
    # choice to maybe_pin_new_profile_to_project's compatibility guard
    # (see wren.context), which would then refuse to auto-pin any other
    # datasource's profile for every non-postgres user starting from a
    # bare `wren context init`. An empty/absent data_source is the "no
    # choice made yet" signal the guard already treats as safe to pin.
    data_source_line = (
        f"data_source: {data_source}\n"
        if data_source
        else "data_source:  # not set yet — `wren profile add`/`set-profile` will fill this in\n"
    )
    project_yml = (
        "schema_version: 5\n"
        "name: my_project\n"
        'version: "1.0"\n'
        "\n"
        "# Wren Engine namespace (NOT your database's catalog/schema).\n"
        "# These identify this MDL project within the engine.\n"
        "# Your database's actual catalog/schema goes in each model's table_reference.\n"
        "catalog: wren\n"
        "schema: public\n"
        "\n" + data_source_line
    )
    project_file.write_text(project_yml)

    # Empty relationships.yml (shared between empty and full scaffold)
    rels = (
        "relationships: []\n"
        "# Example:\n"
        "# relationships:\n"
        "#   - name: orders_customers\n"
        "#     models:\n"
        "#       - orders\n"
        "#       - customers\n"
        "#     join_type: MANY_TO_ONE\n"
        "#     condition: orders.customer_id = customers.customer_id\n"
    )
    (project_path / "relationships.yml").write_text(rels)

    if not empty:
        # Scaffold example model (table_reference mode)
        example_model_dir = project_path / "models" / "example"
        example_model_dir.mkdir(parents=True, exist_ok=True)
        (example_model_dir / "metadata.yml").write_text(
            "# Example model — replace with your actual table\n"
            "name: example\n"
            "# table_reference points to the ACTUAL database table location\n"
            "table_reference:\n"
            '  catalog: ""        # your database catalog (empty if N/A)\n'
            "  schema: public      # your database schema\n"
            "  table: example      # your database table name\n"
            "columns:\n"
            "  - name: id\n"
            "    type: INTEGER\n"
            "    is_calculated: false\n"
            "    not_null: true\n"
            "    is_primary_key: true\n"
            "    properties: {}\n"
            "  - name: name\n"
            "    type: VARCHAR\n"
            "    is_calculated: false\n"
            "    not_null: false\n"
            "    properties: {}\n"
            "primary_key: id\n"
            "cached: false\n"
            "properties: {}\n"
        )

        # Scaffold example view
        example_view_dir = project_path / "views" / "example_view"
        example_view_dir.mkdir(parents=True, exist_ok=True)
        (example_view_dir / "metadata.yml").write_text(
            "# Example view — replace with your actual view\n"
            "name: example_view\n"
            "properties:\n"
            '  description: "An example view"\n'
        )
        (example_view_dir / "sql.yml").write_text(
            "statement: >\n  SELECT * FROM example LIMIT 100\n"
        )

    # ── knowledge/ skeleton (first-class business context) ──
    from wren.context import (  # noqa: PLC0415
        _AGENTS_MD_TEMPLATE,
        create_knowledge_skeleton,
    )

    create_knowledge_skeleton(project_path)
    general_rules = project_path / "knowledge" / "rules" / "general.md"
    if force or not general_rules.exists():
        general_rules.write_text(
            "# Business rules\n\n"
            "Add custom rules or guidelines for LLM-based query generation here.\n"
        )

    # ── AGENTS.md ──
    (project_path / "AGENTS.md").write_text(_AGENTS_MD_TEMPLATE)

    # NL→SQL pairs live in knowledge/sql/ (written by `wren memory store`),
    # so no queries.yml is scaffolded.

    # ── Pin a connection profile, if we can do so unambiguously ──
    # Closes the gap where a project can end up with a connection but no
    # `profile:` pin. Preference order:
    #   1. --profile <name>: explicit and deterministic.
    #   2. exactly one profile in the whole store: nothing to guess between
    #      (see auto_pin_active_profile's docstring for why this is kept
    #      narrow rather than guessing at whichever profile is active).
    #   3. otherwise: no pin written here. `wren profile add` pinning
    #      itself into this project (see maybe_pin_new_profile_to_project)
    #      is the primary mechanism and is expected to have already handled
    #      the common case when the recommended onboarding order is
    #      followed; this is only the init-first fallback.
    from wren.context import auto_pin_active_profile, pin_profile  # noqa: PLC0415

    pinned_profile: str | None = None
    pin_reason: str | None = None
    if profile:
        from wren.profile import list_profiles  # noqa: PLC0415

        prof_dict = list_profiles().get(profile)
        if prof_dict is None:
            typer.echo(
                f"Error: profile '{profile}' not found. Run `wren profile "
                "list` to see available profiles.",
                err=True,
            )
            raise typer.Exit(1)
        prof_datasource = prof_dict.get("datasource")
        if not prof_datasource:
            typer.echo(f"Error: profile '{profile}' has no datasource set.", err=True)
            raise typer.Exit(1)
        pin_profile(project_path, profile, prof_datasource)
        pinned_profile = profile
        pin_reason = "--profile"
    else:
        pinned_profile = auto_pin_active_profile(project_path)
        if pinned_profile:
            pin_reason = "the only profile in the store"

    typer.echo(f"Wren project initialized: {project_path}")
    typer.echo(
        "  wren_project.yml            — project metadata (data_source is set by profile binding)"
    )
    if not empty:
        typer.echo("  models/example/             — example model (metadata.yml)")
        typer.echo(
            "  views/example_view/         — example view (metadata.yml + sql.yml)"
        )
    else:
        typer.echo("  models/                     — (empty; add your own models)")
        typer.echo("  views/                      — (empty; add your own views)")
    typer.echo("  relationships.yml           — define joins between models")
    typer.echo(
        "  knowledge/rules/            — business rules for LLM query generation"
    )
    typer.echo(
        "  knowledge/sql/              — confirmed NL-SQL pairs (wren memory store)"
    )
    typer.echo("  AGENTS.md                   — AI agent workflow guidance")
    if pinned_profile:
        typer.echo(
            f"  profile:                    — pinned to '{pinned_profile}' "
            f"({pin_reason}); verify this is the intended database (see "
            f"`wren context set-profile` to change)"
        )
    else:
        typer.echo(
            "  profile:                    — none pinned yet; run "
            "`wren profile add <name> --from-file <yaml> --activate` then "
            "`wren context set-profile <name>` before querying, or this "
            "project will error instead of silently using another profile."
        )
    # A pre-existing legacy queries.yml is still auto-loaded by `wren memory
    # index`; surface it so v4 and v5 pair sources don't silently mix.
    if (project_path / "queries.yml").exists():
        typer.echo(
            "Note: a legacy queries.yml is present. It's still loaded on "
            "`wren memory index`, but is deprecated — migrate its pairs into "
            "knowledge/sql/ (see the migration reference).",
            err=True,
        )
    typer.echo("")
    typer.echo(
        "Next: Install agent skills via "
        "`curl -fsSL https://raw.githubusercontent.com/Canner/WrenAI/main/skills/install.sh | bash`, "
        "then use the `wren-generate-mdl` skill in your agent to populate models/"
        " (or edit them manually)."
    )
    typer.echo("Next:")
    typer.echo(
        "  1. Create and bind a connection profile: `wren profile add <name> "
        "--from-file <connection.yml> --activate`. In a fresh project this "
        "binds automatically."
    )
    typer.echo(
        "     If the profile already exists or was not auto-bound, run "
        "`wren context set-profile <name>`."
    )
    typer.echo("  2. Populate models/ (with `wren-generate-mdl` or by editing YAML).")
    typer.echo(
        "  3. Finalize with `wren context validate` then `wren context build`. "
        "`build` compiles the project into target/mdl.json."
    )


# Threshold past which we collapse warnings into a grouped summary.
# Small schemas still show every line; large schemas get a one-line
# summary with a hint to re-run with --verbose.
_WARNING_SUMMARY_THRESHOLD = 10


@context_app.command()
def validate(
    path: ProjectPathOpt = None,
    from_osi: FromOsiOpt = None,
    data_source: DataSourceOpt = None,
    semantic_model: SemanticModelOpt = None,
    strict: Annotated[
        bool,
        typer.Option("--strict", help="Treat warnings as errors."),
    ] = False,
    level: Annotated[
        str,
        typer.Option(
            "--level",
            help="Semantic check depth: error (dry-plan only), warning (+ descriptions), strict (+ columns).",
        ),
    ] = "warning",
    verbose: Annotated[
        bool,
        typer.Option(
            "--verbose",
            "-v",
            help=(
                "Print every warning instead of the grouped summary that "
                f"kicks in past {_WARNING_SUMMARY_THRESHOLD} warnings."
            ),
        ),
    ] = False,
) -> None:
    """Validate MDL project: YAML structure + view SQL dry-plan + description checks.

    With --from-osi: lint the OSI file's conversion path. Requires --data-source.

    This is the recommended first half of the finalize sequence: run this,
    then run ``wren context build`` to actually compile target/mdl.json.
    Validation alone does not produce a build artifact — ``build`` also
    re-validates by default, so running it directly is safe even if you
    skip this step.
    """
    if from_osi:
        _validate_from_osi(
            from_osi=from_osi,
            data_source=data_source,
            semantic_model=semantic_model,
            strict=strict,
            verbose=verbose,
        )
        return

    import base64 as _b64  # noqa: PLC0415

    from wren.context import (  # noqa: PLC0415
        build_json,
        discover_project_path,
        load_models,
        load_project_config,
        load_relationships,
        load_views,
        validate_manifest,
        validate_project,
    )

    try:
        project_path = discover_project_path(path)
    except SystemExit as e:
        typer.echo(str(e), err=True)
        raise typer.Exit(1)

    # ── Structural validation ────────────────────────────────────────────
    struct_errors = validate_project(project_path)
    struct_warnings = [e for e in struct_errors if e.level == "warning"]
    struct_hard = [e for e in struct_errors if e.level == "error"]

    # Hard errors always print in full — they block the build.  Warnings
    # flow through the shared summariser with sem_warnings below.
    if struct_hard:
        for e in struct_hard:
            typer.echo(str(e), err=True)

    # ── Semantic validation (dry-plan + description checks) ──────────────
    sem_errors: list[str] = []
    sem_warnings: list[str] = []
    config = load_project_config(project_path)
    if not struct_hard:
        try:
            ds_str = config.get("data_source", "")
            manifest_json = build_json(project_path)
            manifest_str = _b64.b64encode(
                json.dumps(manifest_json, ensure_ascii=False).encode()
            ).decode()
            sem_result = validate_manifest(manifest_str, ds_str, level=level)
            sem_errors = sem_result["errors"]
            sem_warnings = sem_result["warnings"]
        except Exception as e:
            sem_errors = [f"Semantic validation failed: {e}"]

    # ── Profile binding check ─────────────────────────────────────────────
    # Pinned profile that no longer exists → warning (or error in --strict).
    # No pin at all → friendly info hint pointing to `set-profile`.
    profile_pin = config.get("profile") if isinstance(config, dict) else None
    resolved_profile: tuple[str | None, dict] | None = None
    if isinstance(profile_pin, str) and profile_pin.strip():
        # Guard the lookup: if profiles.yml itself is unreadable / malformed,
        # the user shouldn't see a raw traceback — surface it as a warning so
        # validate can still report the rest.
        try:
            from wren.profile import list_profiles  # noqa: PLC0415

            registered = list_profiles()
        except Exception as profile_exc:
            sem_warnings.append(
                f"could not check pinned profile '{profile_pin}': {profile_exc}"
            )
        else:
            pin_name = profile_pin.strip()
            if pin_name not in registered:
                sem_warnings.append(
                    f"project pins profile '{pin_name}' but it doesn't "
                    "exist in ~/.wren/profiles.yml. "
                    "Run `wren context set-profile <name>` to rebind."
                )
            else:
                resolved_profile = (pin_name, dict(registered[pin_name]))
    else:
        # No pin — fall back to whatever profile is globally active, same
        # as a real query would at runtime.
        try:
            from wren.profile import get_active_profile  # noqa: PLC0415

            active_name, active_conf = get_active_profile()
        except Exception:
            active_name, active_conf = None, {}
        if active_conf:
            resolved_profile = (active_name, active_conf)

    # ── Connectivity check (smoke query) ──────────────────────────────────
    # Schema-level checks above never touch the actual data source, so a
    # connection that's schema-valid but not queryable (wrong host, bad
    # credentials, a DuckDB URL pointing at a file instead of its directory,
    # ...) would otherwise pass validation and only fail once a real
    # question is asked. Run a trivial probe query through the resolved
    # profile's connector to catch that here instead.
    if resolved_profile is not None:
        conn_check = _check_connection(*resolved_profile)
        if conn_check is not None:
            is_error, message = conn_check
            (sem_errors if is_error else sem_warnings).append(message)

    if sem_errors:
        typer.echo("\nSemantic errors:")
        for msg in sem_errors:
            typer.echo(f"  \u2717 {msg}", err=True)

    all_warnings: list[str] = [str(w) for w in struct_warnings] + list(sem_warnings)
    error_count = len(struct_hard) + len(sem_errors)
    _print_warnings(all_warnings, verbose=verbose, error_count=error_count)
    if not all_warnings and error_count:
        typer.echo(f"\n0 warning(s), {error_count} error(s).")

    # ── Exit logic ──────────────────────────────────────────────────────────────────
    has_hard_error = bool(struct_hard or sem_errors)
    has_warning = bool(all_warnings)

    # No-pin info hint — surface whenever validation has no hard errors,
    # regardless of warning count. Gating it on a pristine project (the old
    # behavior) hid the nudge from the users most likely to need it: anyone
    # actively working through warnings. Placed BEFORE the exit raise so the
    # hint is still visible under --strict (where warnings become exit 1).
    # Hard errors still suppress so error output stays focused on the blocker.
    no_pin = not (isinstance(profile_pin, str) and profile_pin.strip())
    if no_pin and not has_hard_error:
        typer.echo(
            "\nNote: no profile bound to this project. Connection will fall "
            "back to the\n"
            "  globally active profile in ~/.wren/profiles.yml.\n"
            "  Run `wren context set-profile <name>` to pin one explicitly."
        )

    if has_hard_error or (strict and has_warning):
        raise typer.Exit(1)

    if not struct_errors and not sem_errors and not sem_warnings:
        models = load_models(project_path)
        views = load_views(project_path)
        rels = load_relationships(project_path)
        typer.echo(
            f"Valid — {len(models)} models, {len(views)} views, {len(rels)} relationships."
        )
        typer.echo(
            "Next: wren context build --path "
            f"{project_path} to compile target/mdl.json."
        )


def _check_connection(name: str | None, profile: dict) -> tuple[bool, str] | None:
    """Smoke-test *profile*'s connection with a trivial probe query.

    Returns ``(is_error, message)`` when there's something to report, or
    ``None`` when the connection is queryable (or there's nothing to check).
    ``is_error`` distinguishes a real connectivity failure (hard error —
    the connection was actually attempted and is genuinely broken) from an
    environment/config limitation that just means the probe couldn't be
    attempted here (missing secret, incomplete/skeletal profile, connector
    extra not installed) — reported as a warning instead, so e.g. running
    validate against a not-yet-configured profile, or without live
    credentials in CI, doesn't newly start failing builds that only need
    the schema-level checks.
    """
    from pydantic import ValidationError  # noqa: PLC0415

    from wren.connector import smoke_test  # noqa: PLC0415
    from wren.model.data_source import DataSource  # noqa: PLC0415
    from wren.model.error import ErrorCode, WrenError  # noqa: PLC0415
    from wren.profile import MissingSecretError, expand_profile_secrets  # noqa: PLC0415

    label = f"profile '{name}'" if name else "the active profile"
    ds_str = profile.get("datasource")
    if not isinstance(ds_str, str) or not ds_str:
        return None

    try:
        ds = DataSource(ds_str.lower())
    except ValueError:
        return True, f"{label}: unknown datasource '{ds_str}'"

    fields = {k: v for k, v in profile.items() if k != "datasource"}
    try:
        fields = expand_profile_secrets(fields)
    except MissingSecretError as exc:
        return False, f"{label}: could not check connectivity — {exc}"

    try:
        conn_info = ds.get_connection_info(fields)
    except (ValidationError, ValueError) as exc:
        return (
            False,
            f"{label} ({ds_str}): could not check connectivity — "
            f"incomplete connection info: {exc}",
        )

    try:
        smoke_test(ds, conn_info)
    except WrenError as exc:
        if exc.error_code == ErrorCode.NOT_IMPLEMENTED:
            return False, f"{label} ({ds_str}): could not check connectivity — {exc}"
        return True, f"{label} ({ds_str}): connection check failed — {exc}"
    except Exception as exc:  # noqa: BLE001 — surface whatever the driver raises
        return True, f"{label} ({ds_str}): connection check failed — {exc}"
    return None


def _print_warnings(
    warnings: list[str], *, verbose: bool, error_count: int = 0
) -> None:
    """Render warnings: every line below the threshold, grouped summary above.

    Agents and humans both read the first "Warnings:" line as a signal
    that something is wrong.  A 74-line flood of "missing description"
    messages is unhelpful and misleading, so past the threshold we
    bucket by warning-type prefix.  Pass ``--verbose`` to see every
    message anyway.
    """
    if not warnings:
        return

    total = len(warnings)
    if verbose or total <= _WARNING_SUMMARY_THRESHOLD:
        typer.echo("\nWarnings:")
        for msg in warnings:
            typer.echo(f"  \u26a0 {msg}")
        typer.echo(f"\n{total} warning(s), {error_count} error(s).")
        return

    # Bucket by warning *category* — the text after the last colon
    # (e.g. "missing description", "missing primary_key").  The target
    # prefix ("model 'orders'") is unique per row and would degenerate
    # to one bucket per line if we grouped on it.
    groups: dict[str, int] = {}
    for msg in warnings:
        category = msg.rsplit(":", 1)[-1].strip() if ":" in msg else msg
        groups[category] = groups.get(category, 0) + 1

    typer.echo(f"\nWarnings: {total} total (pass --verbose to see each line)")
    for category, count in sorted(groups.items(), key=lambda kv: -kv[1]):
        typer.echo(f"  \u26a0 {category}: {count}")


@context_app.command()
def build(
    path: ProjectPathOpt = None,
    from_osi: FromOsiOpt = None,
    data_source: DataSourceOpt = None,
    semantic_model: SemanticModelOpt = None,
    output: Annotated[
        Optional[str],
        typer.Option(
            "--output", "-o", help="Output path. Defaults to <project>/target/mdl.json."
        ),
    ] = None,
    validate_first: Annotated[
        bool,
        typer.Option(
            "--validate/--no-validate", help="Run validation before building."
        ),
    ] = True,
) -> None:
    """Build into target/mdl.json for the engine.

    This is THE finalize/compile step: the one command that turns a YAML
    project into the artifact the engine reads. Run it once after writing
    or editing anything under models/, views/, relationships.yml, or
    knowledge/ — no other subcommand is needed to finish a project.

    Default mode: reads wren_project.yml, models/*/metadata.yml (+ref_sql.sql),
    views/*/metadata.yml (+sql.yml), relationships.yml, and knowledge/.

    By default this also runs structural validation first (the same checks
    as ``wren context validate``) and aborts on hard errors, so it's safe
    to run directly without a separate validate call first. Pass
    ``--no-validate`` to skip that pre-check. It's also idempotent — re-run
    it any number of times as YAML changes.

    With --from-osi: reads an Open Semantic Interchange YAML file and emits
    MDL JSON directly. The OSI file stays as the single source of truth; no
    intermediate wren project is created. Requires --data-source.
    """
    if from_osi:
        _build_from_osi(
            from_osi=from_osi,
            data_source=data_source,
            semantic_model=semantic_model,
            output=output,
            validate_first=validate_first,
        )
        return

    from wren.context import (  # noqa: PLC0415
        build_json,
        discover_project_path,
        save_target,
        validate_project,
    )

    try:
        project_path = discover_project_path(path)
    except SystemExit as e:
        typer.echo(str(e), err=True)
        raise typer.Exit(1)

    if validate_first:
        errors = validate_project(project_path)
        hard_errors = [e for e in errors if e.level == "error"]
        if hard_errors:
            for e in hard_errors:
                typer.echo(str(e), err=True)
            typer.echo("\nBuild aborted due to validation errors.", err=True)
            raise typer.Exit(1)

    manifest_json = build_json(project_path)

    if output:
        out_path = Path(output).expanduser()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(manifest_json, indent=2, ensure_ascii=False))
    else:
        out_path = save_target(manifest_json, project_path)

    n_models = len(manifest_json.get("models", []))
    n_views = len(manifest_json.get("views", []))
    typer.echo(f"Built: {n_models} models, {n_views} views → {out_path}")
    typer.echo("")
    typer.echo("Next: wren --sql 'SELECT ...' to query your data.")
    # Soft nudge toward semantic memory once the schema crosses the threshold
    # where embedding search starts to pay off.
    if n_models >= 200:
        typer.echo(
            f"\nYour schema has {n_models} models — consider enabling semantic memory:\n"
            '  pip install "wrenai[memory]"\n'
            "  wren memory index"
        )


@context_app.command()
def show(
    path: ProjectPathOpt = None,
    from_osi: FromOsiOpt = None,
    data_source: DataSourceOpt = None,
    semantic_model: SemanticModelOpt = None,
    output: Annotated[
        str,
        typer.Option("--output", "-o", help="Output format: json|yaml|summary"),
    ] = "summary",
) -> None:
    """Show the current project context (models, views, relationships).

    Read-only inspector — it does not compile or write anything. To
    finalize a project after writing/editing YAML, use
    ``wren context validate`` then ``wren context build`` instead.

    With --from-osi: show what the OSI file would produce. Requires --data-source.
    """
    if from_osi:
        _show_from_osi(
            from_osi=from_osi,
            data_source=data_source,
            semantic_model=semantic_model,
            output=output,
        )
        return

    import yaml as _yaml  # noqa: PLC0415

    from wren.context import (  # noqa: PLC0415
        build_json,
        build_manifest,
        discover_project_path,
        load_project_config,
        load_rules,
    )

    try:
        project_path = discover_project_path(path)
    except SystemExit as e:
        typer.echo(str(e), err=True)
        raise typer.Exit(1)

    if output == "json":
        # JSON output uses camelCase
        manifest_json = build_json(project_path)
        typer.echo(json.dumps(manifest_json, indent=2, ensure_ascii=False))
    elif output == "yaml":
        # YAML output uses snake_case (native)
        manifest = build_manifest(project_path)
        typer.echo(
            _yaml.dump(
                manifest, default_flow_style=False, sort_keys=False, allow_unicode=True
            )
        )
    else:
        # Summary view
        config = load_project_config(project_path)
        manifest = build_manifest(project_path)
        models = manifest.get("models", [])
        views = manifest.get("views", [])
        rels = manifest.get("relationships", [])
        instr_content, used_legacy_instructions = load_rules(project_path)

        typer.echo(
            f"Project: {config.get('name', '?')} (v{config.get('version', '?')})"
        )
        typer.echo(f"Data source: {config.get('data_source', '?')}")
        typer.echo(f"Path: {project_path}\n")

        if models:
            typer.echo(f"Models ({len(models)}):")
            for m in models:
                n_cols = len(m.get("columns", []))
                pk = m.get("primary_key", "—")
                source = "ref_sql" if m.get("ref_sql") else "table"
                typer.echo(f"  {m['name']}  ({source}, {n_cols} columns, pk={pk})")

        if views:
            typer.echo(f"\nViews ({len(views)}):")
            for v in views:
                typer.echo(f"  {v['name']}")

        if rels:
            typer.echo(f"\nRelationships ({len(rels)}):")
            for r in rels:
                models_str = " ↔ ".join(r.get("models") or [])
                jt = r.get("join_type", "?")
                typer.echo(f"  {r.get('name', '?')}  ({models_str}, {jt})")

        if instr_content:
            lines = instr_content.strip().split("\n")
            typer.echo(f"\nBusiness rules: {len(lines)} lines")
        if used_legacy_instructions:
            typer.echo(
                "  (instructions.md is deprecated — move it into knowledge/rules/*.md)"
            )

        if not models and not views:
            typer.echo(
                "Empty project. Run `wren context init` to get started, then "
                "`wren context validate` + `wren context build` to finalize "
                "once models/ has content."
            )


@context_app.command()
def instructions(
    path: ProjectPathOpt = None,
) -> None:
    """Print business rules (knowledge/rules/ + legacy instructions.md) for LLM consumption."""
    from wren.context import discover_project_path, load_rules  # noqa: PLC0415

    try:
        project_path = discover_project_path(path)
    except SystemExit as e:
        typer.echo(str(e), err=True)
        raise typer.Exit(1)

    content, used_legacy = load_rules(project_path)
    if used_legacy:
        typer.echo(
            "Warning: instructions.md is deprecated — move its content into "
            "knowledge/rules/*.md.",
            err=True,
        )
    if content:
        typer.echo(content)


@context_app.command(name="set-profile")
def set_profile(
    name: Annotated[str, typer.Argument(help="Profile name to bind to this project.")],
    path: ProjectPathOpt = None,
) -> None:
    """Bind a connection profile to this project.

    Writes ``profile: <name>`` and ``data_source: <profile.datasource>`` into
    ``wren_project.yml``. Future CLI commands and the SDK use the bound
    profile regardless of which profile is globally active.
    """
    from wren.context import (  # noqa: PLC0415
        discover_project_path,
        load_project_config,
        pin_profile,
    )
    from wren.profile import list_profiles  # noqa: PLC0415

    try:
        project_path = discover_project_path(path)
    except SystemExit as e:
        typer.echo(str(e), err=True)
        raise typer.Exit(1)

    # discover_project_path() with explicit --path returns it un-checked, so
    # confirm the project actually exists before binding a profile to nothing.
    from wren.context import PROJECT_FILE  # noqa: PLC0415

    if not (project_path / PROJECT_FILE).exists():
        typer.echo(
            f"Error: no {PROJECT_FILE} found at {project_path}.\n"
            "  Run `wren context init` to scaffold a project first.",
            err=True,
        )
        raise typer.Exit(1)

    try:
        profiles = list_profiles()
    except Exception as exc:
        typer.echo(
            f"Error: could not read ~/.wren/profiles.yml: {exc}",
            err=True,
        )
        raise typer.Exit(1)

    if name not in profiles:
        avail = ", ".join(sorted(profiles)) or "(none)"
        typer.echo(
            f"Error: profile '{name}' not found in ~/.wren/profiles.yml.\n"
            f"  Available profiles: {avail}\n"
            f"  Run `wren profile add {name} --datasource <ds>` to create it.",
            err=True,
        )
        raise typer.Exit(1)

    new_ds = profiles[name].get("datasource")
    if not new_ds:
        typer.echo(
            f"Error: profile '{name}' has no datasource field. "
            "Edit ~/.wren/profiles.yml or recreate it via `wren profile add`.",
            err=True,
        )
        raise typer.Exit(1)

    config = load_project_config(project_path)
    old_ds = config.get("data_source")
    project_name = config.get("name") or "<unnamed>"
    try:
        pin_profile(project_path, name, new_ds)
    except OSError as exc:
        typer.echo(
            f"Error: could not write {project_path / PROJECT_FILE}: {exc}",
            err=True,
        )
        raise typer.Exit(1)

    typer.echo(f"✓ Bound profile '{name}' to project {project_name}")
    typer.echo(f"  profile:     {name}")
    if old_ds and old_ds != new_ds:
        typer.echo(f"  data_source: {old_ds} -> {new_ds}")
    else:
        typer.echo(f"  data_source: {new_ds}")

    # Stale-MDL warning: if datasource changed AND a built manifest already
    # exists, it was emitted for the previous dialect and queries will break
    # against the new connection until the user rebuilds.
    if old_ds and old_ds != new_ds and (project_path / "target" / "mdl.json").exists():
        typer.echo(
            f"\n⚠ MDL was built for {old_ds}. Run `wren context build` "
            "to regenerate before querying."
        )


@context_app.command()
def upgrade(
    path: ProjectPathOpt = None,
    to: Annotated[
        Optional[int],
        typer.Option("--to", help="Target schema_version (default: latest)."),
    ] = None,
    dry_run: Annotated[
        bool,
        typer.Option("--dry-run", help="Preview changes without writing."),
    ] = False,
) -> None:
    """Upgrade project schema_version to enable new features.

    This is unrelated to compiling/finalizing a project — it only migrates
    wren_project.yml (and accompanying scaffold files, e.g. knowledge/)
    between schema_version numbers, and it's a no-op if the project is
    already on the latest version. If you're trying to finish a project
    after writing/editing YAML, use ``wren context validate`` then
    ``wren context build`` instead — this command does not build
    target/mdl.json.
    """
    from wren.context import (  # noqa: PLC0415
        UpgradeError,
        apply_upgrade,
        discover_project_path,
        get_schema_version,
        plan_upgrade,
    )

    try:
        project_path = discover_project_path(path)
    except SystemExit as e:
        typer.echo(str(e), err=True)
        raise typer.Exit(1)

    current = get_schema_version(project_path)

    try:
        result = plan_upgrade(project_path, target_version=to)
    except UpgradeError as e:
        typer.echo(f"Error: {e}", err=True)
        raise typer.Exit(1)

    if (
        not result.files_created
        and not result.files_deleted
        and not result.files_modified
    ):
        typer.echo(
            f"Already at schema_version {current}. Nothing to do.\n"
            "If you're trying to finish/compile the project, this isn't the "
            "command for that — run `wren context build` instead."
        )
        return

    if result.from_version == result.to_version:
        typer.echo(
            f"Already at schema_version {current}. Nothing to do.\n"
            "If you're trying to finish/compile the project, this isn't the "
            "command for that — run `wren context build` instead."
        )
        return

    if dry_run:
        typer.echo("Dry run — no files will be changed.\n")
        if result.files_created:
            typer.echo("Would create:")
            for f in result.files_created:
                typer.echo(f"  {f}")
        if result.files_deleted:
            typer.echo("Would delete:")
            for f in result.files_deleted:
                typer.echo(f"  {f}")
        if result.files_modified:
            typer.echo("Would modify:")
            for f in result.files_modified:
                typer.echo(
                    f"  {f} (schema_version {result.from_version} -> {result.to_version})"
                )
        return

    typer.echo(
        f"Upgrading project from schema_version {result.from_version} -> {result.to_version}..."
    )

    apply_upgrade(project_path, result)

    for f in result.files_created:
        typer.echo(f"  + {f}")
    for f in result.files_deleted:
        typer.echo(f"  - {f}")
    for f in result.files_modified:
        typer.echo(
            f"  * {f} (schema_version {result.from_version} -> {result.to_version})"
        )

    typer.echo(
        "\nUpgrade complete. Run `wren context validate` then "
        "`wren context build` to check and recompile the result."
    )


# ── OSI source helpers ────────────────────────────────────────────────────


def _resolve_osi_path(from_osi: str) -> Path:
    p = Path(from_osi).expanduser()
    if not p.exists():
        typer.echo(f"Error: OSI file not found: {p}", err=True)
        raise typer.Exit(1)
    return p


def _require_data_source(data_source: Optional[str]) -> str:
    if not data_source:
        typer.echo(
            "Error: --data-source is required when using --from-osi.\n"
            "  Pass one of: postgres, snowflake, bigquery, mysql, duckdb, ...",
            err=True,
        )
        raise typer.Exit(1)
    return data_source


def _init_from_osi(
    *,
    from_osi: str,
    data_source: Optional[str],
    semantic_model: Optional[str],
    project_path: Path,
    force: bool,
) -> None:
    """Migrate an OSI file to a native wren project (one-way).

    Reuses ``build_json_from_osi`` to produce the MDL, then
    ``convert_mdl_to_project`` + ``write_project_files`` to scaffold the
    full wren YAML layout. The OSI file is read once and never referenced
    again after this command — the wren project becomes the source of truth.
    """
    from wren.context import (  # noqa: PLC0415
        convert_mdl_to_project,
        write_project_files,
    )
    from wren.osi import build_json_from_osi  # noqa: PLC0415

    osi_path = _resolve_osi_path(from_osi)
    ds = _require_data_source(data_source)

    mdl_json, errors = build_json_from_osi(
        osi_path,
        data_source=ds,
        semantic_model=semantic_model,
    )

    hard_errors = [e for e in errors if e.level == "error"]
    if hard_errors:
        for e in hard_errors:
            typer.echo(str(e), err=True)
        typer.echo("\nMigration aborted due to OSI errors.", err=True)
        raise typer.Exit(1)

    warnings = [str(e) for e in errors if e.level == "warning"]

    files = convert_mdl_to_project(mdl_json)
    try:
        write_project_files(files, project_path, force=force)
    except SystemExit as e:
        typer.echo(str(e), err=True)
        raise typer.Exit(1)

    model_count = len(mdl_json.get("models", []))
    rel_count = len(mdl_json.get("relationships", []))

    typer.echo(f"Migrated OSI → wren project at {project_path}/")
    typer.echo(f"  {model_count} models, {rel_count} relationships")

    if warnings:
        typer.echo("")
        _print_warnings(warnings, verbose=False)
        typer.echo(
            "  Review the generated YAML — items above were defaulted "
            "or omitted and may need manual fixes."
        )

    typer.echo("\nNext steps:")
    typer.echo(f"  wren context validate --path {project_path}")
    typer.echo(f"  wren context build --path {project_path}")


def _build_from_osi(
    *,
    from_osi: str,
    data_source: Optional[str],
    semantic_model: Optional[str],
    output: Optional[str],
    validate_first: bool,
) -> None:
    """Build target/mdl.json directly from an OSI file."""
    from wren.osi import build_json_from_osi  # noqa: PLC0415

    osi_path = _resolve_osi_path(from_osi)
    ds = _require_data_source(data_source)

    manifest_json, errors = build_json_from_osi(
        osi_path,
        data_source=ds,
        semantic_model=semantic_model,
    )

    hard_errors = [e for e in errors if e.level == "error"]
    if hard_errors:
        for e in hard_errors:
            typer.echo(str(e), err=True)
        typer.echo("\nBuild aborted due to OSI errors.", err=True)
        raise typer.Exit(1)

    warnings = [str(e) for e in errors if e.level == "warning"]
    if validate_first and warnings:
        _print_warnings(warnings, verbose=False)

    # No project dir to anchor on — default to cwd/target/mdl.json.
    if output:
        out_path = Path(output).expanduser()
    else:
        out_path = Path.cwd() / "target" / "mdl.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(manifest_json, indent=2, ensure_ascii=False))

    n_models = len(manifest_json.get("models", []))
    n_rels = len(manifest_json.get("relationships", []))
    typer.echo(
        f"Built from OSI: {n_models} models, {n_rels} relationships → {out_path}"
    )


def _validate_from_osi(
    *,
    from_osi: str,
    data_source: Optional[str],
    semantic_model: Optional[str],
    strict: bool,
    verbose: bool,
) -> None:
    """Lint an OSI file against the WREN conversion rules."""
    from wren.osi import lint_osi_file  # noqa: PLC0415

    osi_path = _resolve_osi_path(from_osi)
    ds = _require_data_source(data_source)

    errors = lint_osi_file(
        osi_path,
        data_source=ds,
        semantic_model=semantic_model,
    )
    hard = [e for e in errors if e.level == "error"]
    warns = [str(e) for e in errors if e.level == "warning"]

    if hard:
        typer.echo("OSI errors:")
        for e in hard:
            typer.echo(f"  ✗ {e}", err=True)

    _print_warnings(warns, verbose=verbose)

    if hard or (strict and warns):
        raise typer.Exit(1)

    if not errors:
        typer.echo(f"Valid — {osi_path.name} converts cleanly.")


def _show_from_osi(
    *,
    from_osi: str,
    data_source: Optional[str],
    semantic_model: Optional[str],
    output: str,
) -> None:
    """Print the manifest the OSI file would produce."""
    import yaml as _yaml  # noqa: PLC0415

    from wren.osi import build_manifest_from_osi  # noqa: PLC0415

    osi_path = _resolve_osi_path(from_osi)
    ds = _require_data_source(data_source)

    manifest, errors = build_manifest_from_osi(
        osi_path,
        data_source=ds,
        semantic_model=semantic_model,
    )
    hard = [e for e in errors if e.level == "error"]
    if hard:
        for e in hard:
            typer.echo(str(e), err=True)
        raise typer.Exit(1)

    if output == "json":
        from wren.context import _convert_keys  # noqa: PLC0415

        # Mirror build_json_from_osi: shield `_instructions` from the
        # snake→camel pass so downstream tooling sees the exact key.
        instructions = manifest.pop("_instructions", None)
        manifest_json = _convert_keys(manifest)
        manifest_json["layoutVersion"] = 2
        if instructions:
            manifest_json["_instructions"] = instructions
        typer.echo(json.dumps(manifest_json, indent=2, ensure_ascii=False))
        return
    if output == "yaml":
        typer.echo(
            _yaml.dump(
                manifest, default_flow_style=False, sort_keys=False, allow_unicode=True
            )
        )
        return

    # Summary
    models = manifest.get("models", [])
    rels = manifest.get("relationships", [])
    typer.echo(f"OSI file: {osi_path}")
    typer.echo(f"Data source: {ds}")
    typer.echo(f"Catalog/schema: {manifest.get('catalog')}/{manifest.get('schema')}\n")
    if models:
        typer.echo(f"Models ({len(models)}):")
        for m in models:
            n_cols = len(m.get("columns", []))
            pk = m.get("primary_key", "—")
            source = "ref_sql" if m.get("ref_sql") else "table"
            typer.echo(f"  {m['name']}  ({source}, {n_cols} columns, pk={pk})")
    if rels:
        typer.echo(f"\nRelationships ({len(rels)}):")
        for r in rels:
            models_str = " ↔ ".join(r.get("models", []))
            typer.echo(f"  {r.get('name', '?')}  ({models_str}, MANY_TO_ONE)")
    if manifest.get("_instructions"):
        typer.echo("\nInstructions: present (from OSI ai_context + metrics)")
