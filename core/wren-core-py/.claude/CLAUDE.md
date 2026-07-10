# wren-core-py

PyO3 bindings exposing wren-core to Python. Built with Maturin. This is the bridge between the Rust semantic engine and the Python ibis-server.

## Key Source Files (`src/`)

- `lib.rs` — PyO3 module entry point
- `context.rs` — Python-facing session context wrapping wren-core
- `manifest.rs` — Python manifest types (auto-generated via `wren-manifest-macro`)
- `validation.rs` — Query validation exposed to Python
- `extractor.rs` — MDL extraction utilities
- `remote_functions.rs` — Remote function registration
- `errors.rs` — Error type conversions (Rust -> Python exceptions)

## Dev Commands

```bash
just install     # uv sync (deps only; --no-install-project)
just develop     # Build dev wheel with maturin (for local testing)
just build       # Build release wheel
just test-rs     # Rust tests only (cargo test --no-default-features)
just test-py     # Python tests only (pytest)
just test        # Both Rust and Python tests
just format      # cargo fmt + ruff format + ruff check --fix + taplo fmt
```

## Dependencies

- **wren-core** (path: `../wren-core/core`) — The Rust semantic engine
- **wren-core-base** (path: `../wren-core-base`, feature: `python-binding`) — Shared manifest types with PyO3 support
- **PyO3** with `abi3-py311` — Stable ABI targeting Python 3.11+
- **Maturin** — Build backend for Rust-Python packages

## Build Notes

- Uses PyO3 stable ABI (`abi3-py311`), so one wheel works across Python 3.11+
- The `extension-module` feature is the default and required for building as a Python extension
- For `--no-default-features` (used in `test-rs`), PyO3 extension module linking is disabled so pure Rust tests can run

## Conventions

- Format Rust with `cargo fmt`, Python with `ruff`
- CI runs on `wren-core-py/**` or `wren-core/**` changes
- Changes to wren-core-base manifest types may require updating Python-side tests here
