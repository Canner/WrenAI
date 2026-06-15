# Wren Core Python Binding

Python bindings for [wren-core](../wren-core), the Rust semantic engine behind [Wren Engine](https://github.com/Canner/wren-engine). Built with [PyO3](https://github.com/PyO3/pyo3) and [Maturin](https://github.com/PyO3/maturin).

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
from wren_core import SessionContext, to_manifest

# Load an MDL manifest from a base64-encoded JSON string
base64_mdl_json = "<your-base64-encoded-mdl-json>"
manifest = to_manifest(base64_mdl_json)

# Create a session context for query planning
ctx = SessionContext(manifest, remote_functions=[])

# Transform a SQL query through the semantic layer
planned_sql = ctx.transform_sql("SELECT * FROM my_model")
```

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
