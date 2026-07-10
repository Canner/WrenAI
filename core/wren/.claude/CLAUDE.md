# CLAUDE.md — wren package

Python SDK and CLI for Wren Engine. Wraps `wren-core-py` (PyO3 bindings) + Ibis connectors into a single installable package with YAML-based MDL project management, named connection profiles, and optional semantic memory.

## Build & Development

```bash
cd wren
just install          # uv sync — prebuilt wren-core-py wheel from PyPI (no Rust build)
just install-all      # with all optional extras (including memory)
just install-extra <extra>   # e.g. just install-extra postgres
just install-memory   # install memory extra (qdrant-client + openai -> Volcengine Ark)
just install-local    # engine dev: uv sync + build local wheel + overlay (needs Rust)
just use-local-core   # rebuild + re-overlay local wheel after a Rust change
just dev              # run `wren` CLI
just test             # pytest tests/
just test-memory      # memory-specific tests
just lint             # ruff format --check + ruff check
just format           # ruff auto-fix (also aliased as `just fmt`)
just build            # uv build (produces wheel)
```

`install`, `install-all`, `install-extra`, and `install-memory` use the locked prebuilt engine wheel and do not require Rust. Dev tools come from uv's default `dev` dependency group. Local engine testing is opt-in via `install-local`/`use-local-core`. Run recipes use `uv run --no-sync` so they don't revert an overlaid local wheel.

Uses `uv` (not Poetry). `pyproject.toml` uses `hatchling` as build backend.

## CLI Command Groups

- `wren query` / `wren dry-plan` / `wren validate` — Core query operations
- `wren context init|build|validate|show` — YAML MDL project management
- `wren profile add|list|show|remove|activate` — Named connection profiles
- `wren docs connection-info` — Generate connection field docs
- `wren utils parse-type` — SQL type normalization
- `wren memory index|fetch|store|recall` — Semantic memory (when `wren[memory]` installed)

## Key Design Points

- **WrenEngine** is the main entry point. It accepts a base64-encoded MDL JSON string, a `DataSource`, and a connection dict.
- **Query flow**: `_plan()` → wren-core `SessionContext.transform_sql()` → `_transpile()` via sqlglot → connector `.query()`.
- **Manifest extraction**: `_plan()` tries to extract a minimal sub-manifest scoped to the query's referenced tables before calling wren-core — this reduces planning overhead. Falls back to the full manifest on error.
- **`get_session_context` is `@cache`-decorated** — same `(manifest_str, function_path, properties, data_source)` tuple reuses the same SessionContext. Avoid mutating session state.
- **Write dialect mapping**: `canner` → `trino`; file sources (`local_file`, `s3_file`, `minio_file`, `gcs_file`) → `duckdb`. All others use `data_source.name` directly.
- **WrenEngine is a context manager** (`__enter__` / `__exit__` call `close()`).
- **Profile-based workflow**: When no explicit `--connection-*` flags are given, the CLI auto-discovers the active profile from `~/.wren/profiles.yml`. Profiles store datasource type + connection fields.
- **YAML MDL project**: `wren context build` compiles YAML model/view/relationship files from a project directory into `target/mdl.json`. `_require_mdl()` auto-discovers this target file.
- **Config system**: `~/.wren/config.json` with `strict_mode` (reject queries referencing non-MDL tables) and `denied_functions` (block specific SQL functions).
- **Field registry** (`model/field_registry.py`): Single source of truth for per-datasource connection fields, derived from Pydantic models. Used by CLI interactive prompts, MCP web UI forms, and documentation generation.

## Connectors

`connector/factory.py` dispatches on `DataSource` to return the right connector. Each connector wraps an Ibis backend and exposes `.query(sql, limit)` and `.dry_run(sql)`. Base class in `connector/base.py`; Ibis-backed connectors share `connector/ibis.py`.

- **Dedicated modules**: `postgres.py`, `mysql.py`, `mssql.py`, `bigquery.py`, `duckdb.py`, `oracle.py` (native oracledb, not Ibis), `redshift.py`, `spark.py`, `databricks.py`, `canner.py`
- **Shared Ibis module** (`ibis.py`): trino, clickhouse, snowflake, athena
- **File connectors**: `local_file`, `s3_file`, `minio_file`, `gcs_file` all map to duckdb
- **doris** maps to mysql connector (MySQL-compatible protocol)
- **canner** maps to postgres connector

## Memory Module (Optional)

`wren/src/wren/memory/` — Qdrant-backed semantic memory for schema and query retrieval. Install via `wren[memory]`.

- **`WrenMemory`** — Main API: `index_manifest()`, `get_context()`, `store_query()`, `recall_queries()`, `describe_schema()`, `schema_is_current()`, `status()`, `reset()`
- Uses Volcengine Ark (OpenAI-compatible) for embedding MDL schema items and NL↔SQL query pairs
- **Seed queries** (`seed_queries.py`): On index, generates canonical NL-SQL pairs from the MDL manifest to bootstrap the query history
- CLI: `wren memory index|fetch|store|recall` subcommands (auto-registered when extras installed)
- Backing store: Qdrant (remote server, configured via `QDRANT_URL`; embeddings via `VOLC_ARK_API_KEY`)

## Optional Extras

Install per data-source extras: `postgres`, `mysql`, `bigquery`, `snowflake`, `clickhouse`, `trino`, `mssql`, `databricks`, `redshift`, `spark`, `athena`, `oracle`, `memory`, `all`.

On macOS, `mysql` extra needs:
```bash
PKG_CONFIG_PATH="$(brew --prefix mysql-client)/lib/pkgconfig" just install-extra mysql
```

## Dependency on wren-core-py

By default the engine binding comes prebuilt from PyPI (pinned in `uv.lock`), so
ordinary `just install` needs no Rust toolchain. To test against local Rust
changes, `just use-local-core` builds the wheel from `../wren-core-py/` and
overlays it into `.venv` (via `uv pip install --reinstall --no-index
--find-links`). The run recipes use `uv run --no-sync` so a subsequent `uv run`
won't revert that overlay to the locked PyPI version.
