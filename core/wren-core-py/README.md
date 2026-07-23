# Wren Core Python Binding

Python bindings for [wren-core](../wren-core), the Rust semantic engine behind [Wren Engine](https://github.com/Canner/WrenAI). Built with [PyO3](https://github.com/PyO3/pyo3) and [Maturin](https://github.com/PyO3/maturin).

Wren Engine translates SQL queries through a semantic layer (MDL - Modeling Definition Language) and executes them against 22+ data sources (PostgreSQL, BigQuery, Snowflake, etc.).

## Installation

```bash
pip install wren-core-py
```

Requires Python >= 3.11.

Pre-built wheels are available for:
- Linux x86_64
- macOS x86_64 / ARM64 (Apple Silicon)
- Windows x86_64

Linux ARM64 wheels are not yet available. To use on that platform, build from source (requires Rust toolchain).

## Quick Start

```python
from wren_core import SessionContext

# Create a session context from a base64-encoded MDL JSON string
base64_mdl_json = "<your-base64-encoded-mdl-json>"
ctx = SessionContext(base64_mdl_json)

# Transform a SQL query through the semantic layer
planned_sql = ctx.transform_sql("SELECT * FROM my_model")
```

### Registering local files (Parquet/CSV)

Physical files can back MDL models via two-phase initialization — register the
files, then load the MDL so models resolve to them:

```python
from wren_core import SessionContext

base64_mdl_json = "<your-base64-encoded-mdl-json>"

ctx = SessionContext()
ctx.register_parquet("customer", "/data/customer.parquet")
ctx.register_csv("orders", "/data/orders.csv")
ctx.load_mdl(base64_mdl_json)  # MDL models now resolve to the files

# Query by the MDL's catalog.schema.model name; returns Arrow IPC stream bytes
ipc_bytes = ctx.query("SELECT * FROM my_catalog.my_schema.customer")
```

Visibility contract:

- Tables land in the pre-existing default catalog (`datafusion`.`public`). An
  MDL model resolves to a registered file only if its `tableReference` is
  `{"catalog": "datafusion", "schema": "public", "table": "<registered name>"}`
  and the columns it declares exist in the file.
- Registering after the context was created still works: the internals of
  pre-existing catalogs are live-shared with derived contexts, so the table is
  visible to `query`, `dry_run`, and `list_tables`.
- Brand-new *top-level* catalogs are the exception — they must exist before
  MDL construction, `load_mdl`, or a transform, each of which snapshots the
  top-level catalog list.
- `load_mdl` must not overlap other calls on the same context; overlapping
  calls raise `RuntimeError`.

For complete runnable examples (fixture files, matching manifests, decoding
the returned bytes), see `tests/test_physical_tables.py`.

## Developer Guide

### Environment Setup

- Install [Rust](https://www.rust-lang.org/tools/install) and [Cargo](https://doc.rust-lang.org/cargo/getting-started/installation.html)
- Install [Python](https://www.python.org/downloads/)
- Install [uv](https://github.com/astral-sh/uv)
- Install [casey/just](https://github.com/casey/just)

### Test and Build

After installing `casey/just`, you can use the following commands:

- `just install` — Create Python venv and install dependencies.
- `just develop` — Build the Rust package for local development (**required before running Python tests**).
- `just test-rs` — Run Rust tests only.
- `just test-py` — Run Python tests only.
- `just test` — Run both Rust and Python tests.
- `just build` — Build the Python wheel. Output goes to `target/wheels/`.

### Coding Style

Format via `just format`.

### Publishing

See `scripts/publish.sh` for local publishing to PyPI/TestPyPI:

```bash
./scripts/publish.sh --build    # Build wheel only
./scripts/publish.sh --test     # Build + publish to TestPyPI
./scripts/publish.sh            # Build + publish to PyPI
```

## License

Apache-2.0
