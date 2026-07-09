# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Wren is an open-source semantic engine for MCP clients and AI agents. It translates SQL queries through a semantic layer (MDL — Modeling Definition Language) and executes them against 22+ data sources (PostgreSQL, BigQuery, Snowflake, Spark, etc.). The Rust engine is powered by Apache DataFusion (upstream, crates.io v53).

The previous WrenAI services (`wren-ui/`, `wren-ai-service/`, `wren-launcher/`, `docker/`, `deployment/`) were moved to the `legacy/v1` branch (tag `v1-final`) as of the wren-engine import. Active development is focused on the Open Context Engine.

## Repository Structure

```
core/
├── wren-core/        Rust semantic engine (Cargo workspace; crates.io: wren-semantic-core, lib name wren_core)
├── wren-core-base/   Shared Rust crate — manifest types (Model, Column, Metric, Relationship, View) + ManifestBuilder (crates.io: wren-core-base)
├── wren-core-py/     PyO3 bindings exposing wren-core to Python (PyPI: wren-core)
├── wren-core-wasm/   WebAssembly build of wren-core for in-browser semantic SQL (npm: wren-core-wasm)
├── wren/             Python SDK and CLI — `wren` command, profile/context/memory management (PyPI: wrenai)
└── wren-mdl/         MDL JSON schema definition

docs/core/            Module documentation
examples/             Example projects (placeholder — to be populated)
skills/               CLI-based agent skills (wren-generate-mdl, wren-usage, wren-dlt-connector, wren-onboarding)
scripts/              Repo helper scripts
```

## Build & Development Commands

### core/wren-core (Rust)
```bash
cd core/wren-core
cargo check --all-targets                                  # compile check
cargo test --lib --tests --bins                            # tests (set RUST_MIN_STACK=8388608)
cargo fmt --all                                            # format
cargo clippy --all-targets --all-features -- -D warnings   # lint
taplo fmt                                                  # format Cargo.toml files
```

Most unit tests live in `core/wren-core/core/src/mdl/mod.rs`. SQL end-to-end tests use sqllogictest files in `core/wren-core/sqllogictest/test_files/`.

### core/wren-core-py (Python bindings)
```bash
cd core/wren-core-py
just install      # uv sync (deps only; --no-install-project)
just develop      # build dev wheel with maturin
just test-rs      # Rust tests (cargo test --no-default-features)
just test-py      # Python tests (pytest)
just test         # both
just format       # cargo fmt + ruff + taplo
```

### core/wren-core-wasm (WASM)
```bash
cd core/wren-core-wasm
just build        # wasm-pack build (browser target)
just test         # wasm-pack test
```
Outputs a ~68 MB WASM binary; distributed via npm and unpkg (jsDelivr's 50 MB per-file CDN limit blocks it).

### core/wren (SDK & CLI)
```bash
cd core/wren
just install              # uv sync (locked prebuilt wren-core-py wheel from PyPI; no Rust build)
just install-all          # with all optional extras (incl. memory)
just install-extra <e>    # e.g. just install-extra postgres
just install-memory       # memory extra (lancedb + sentence-transformers)
just install-local        # engine dev: uv sync + build local wheel + overlay
just use-local-core       # rebuild + re-overlay after Rust changes
just dev                  # run `wren` CLI
just test                 # pytest tests/
just test-memory          # memory-specific tests
just lint                 # ruff format --check + ruff check
just format               # ruff auto-fix
just build                # uv build (produces wheel)
```

Uses `uv` (not Poetry). `pyproject.toml` uses `hatchling` as build backend. Optional extras: `postgres`, `mysql`, `bigquery`, `snowflake`, `clickhouse`, `trino`, `mssql`, `databricks`, `redshift`, `spark`, `athena`, `oracle`, `memory`, `all`, `dev`.

## Architecture: Query Flow

```
SQL query
  → wren CLI / wren-core-py
  → wren-core (Rust): MDL analysis → logical plan → optimization
  → DataFusion (query planning, upstream crates.io v53)
  → connector-specific SQL (Ibis / sqlglot)
  → native execution on the target data source
```

## Key Architecture Details

**wren-core internals** (`core/wren-core/core/src/`):
- `mdl/` — Core MDL processing: `WrenMDL` (manifest + symbol table), `AnalyzedWrenMDL` (with lineage), function definitions per dialect (scalar/aggregate/window), type planning
- `logical_plan/analyze/` — DataFusion analyzer rules: `ModelAnalyzeRule` (TableScan → ModelPlanNode), scope tracking, access control (RLAC/CLAC), view expansion, relationship chain resolution
- `logical_plan/optimize/` — Optimization passes: type coercion, timestamp simplification
- `sql/` — SQL parsing and analysis

**Manifest types** (`core/wren-core-base/src/mdl/`):
- `manifest.rs` — `Manifest`, `Model`, `Column`, `Metric`, `Relationship`, `View`, `RowLevelAccessControl`, `ColumnLevelAccessControl`
- `builder.rs` — Fluent `ManifestBuilder` API
- Uses `wren-manifest-macro` for auto-generating Pydantic-compatible Python classes

## Known wren-core Limitations

**ModelAnalyzeRule — correlated subquery column resolution**: cannot resolve outer column references inside correlated subqueries; only sees the subquery's own table scope. Affects TPCH Q2, Q4, Q15, Q17, Q20, Q21, Q22.

## Conventions

- **Commits**: Conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`, `perf:`, `deps:`). Releases are automated via release-please with independent release lines per module.
- **Rust**: format with `cargo fmt`, lint with `clippy -D warnings`, TOML with `taplo`.
- **Python**: format and lint with `ruff` (line-length 88, target Python 3.11). Both `core/wren-core-py` and `core/wren` use uv.
- **DataFusion**: upstream `datafusion` v53 from crates.io (no longer the Canner fork).
- **Snapshot testing**: wren-core uses `insta` for Rust snapshot tests.
- **CI**: Per-module path-filtered workflows trigger only on changes inside that module.
