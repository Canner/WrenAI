# wren-core

Rust semantic engine for Wren Engine. Handles MDL analysis, query planning, logical plan optimization, and SQL generation via Apache DataFusion (upstream, crates.io v53). Published to crates.io as `wren-semantic-core` (lib name `wren_core`).

## Workspace Layout

Cargo workspace with four crates:

| Crate | Purpose |
|---|---|
| `core/` | Main library — MDL processing, analyzer rules, optimizer passes, SQL generation |
| `sqllogictest/` | SQL end-to-end tests using `.slt` files |
| `benchmarks/` | Performance benchmarks |
| `wren-example/` | Usage examples |

## Key Source Directories (`core/src/`)

- `mdl/` — Core MDL processing: `WrenMDL` (manifest + symbol table), `AnalyzedWrenMDL` (with lineage), function definitions (scalar/aggregate/window per dialect), type planning
- `logical_plan/analyze/` — DataFusion analyzer rules: `ModelAnalyzeRule` (TableScan -> ModelPlanNode), scope tracking, access control (RLAC/CLAC), view expansion, relationship chain resolution
- `logical_plan/optimize/` — Optimization passes: type coercion, timestamp simplification
- `sql/` — SQL parsing and analysis

## Dev Commands

```bash
cargo check --all-targets                               # Compile check
RUST_MIN_STACK=8388608 cargo test --lib --tests --bins  # Run tests
cargo fmt --all                                         # Format
cargo clippy --all-targets --all-features -- -D warnings  # Lint
taplo fmt                                               # Format Cargo.toml files
```

## Testing

- Most unit tests are in `core/src/mdl/mod.rs`
- SQL end-to-end tests use sqllogictest files in `sqllogictest/test_files/`
- Snapshot testing with `insta` — run `cargo insta review` to approve changes

## Dependencies

- **DataFusion**: upstream `datafusion` v53 from crates.io (no longer the Canner fork)
- **wren-core-base**: Shared manifest types from `../wren-core-base`

## Known Limitations

**ModelAnalyzeRule — correlated subquery column resolution**: The `ModelAnalyzeRule` cannot resolve outer column references inside correlated subqueries. It only sees the subquery's own table scope. This affects TPCH Q2, Q4, Q15, Q17, Q20, Q21, Q22.

## Conventions

- Format with `cargo fmt`, lint with `clippy -D warnings`
- TOML formatting with `taplo`
- Snapshot tests use `insta`
- CI runs on `wren-core/**` changes
