# wren-semantic-core

The Rust semantic engine at the heart of [Wren AI](https://getwren.ai) — an open-source
semantic layer for MCP clients and AI agents.

`wren-semantic-core` takes a **MDL (Modeling Definition Language)** manifest plus a SQL query
and rewrites the query through the semantic layer: resolving models, relationships, metrics
and views, applying row-/column-level access control, and producing an optimized logical
plan. It is built on [Apache DataFusion](https://datafusion.apache.org/).

> The published crate is named `wren-semantic-core`; the library itself is imported as
> `wren_core`.

## Installation

```toml
[dependencies]
wren-semantic-core = "0.1"
```

## Usage

```rust
use wren_core::mdl::AnalyzedWrenMDL;
// Build an AnalyzedWrenMDL from a manifest, then transform SQL through the
// semantic layer. See the API docs for the full flow.
```

Full API documentation is published on [docs.rs](https://docs.rs/wren-semantic-core).

## What it does

- **MDL analysis** — parse a manifest into models, columns, metrics, relationships and views.
- **Query planning** — rewrite incoming SQL against the semantic layer into a DataFusion
  logical plan, resolving relationship chains and expanding views.
- **Access control** — apply row-level (RLAC) and column-level (CLAC) access rules.
- **Optimization** — type coercion and timestamp simplification passes.

## Learn more

- Wren documentation: <https://docs.getwren.ai>
- Project home: <https://getwren.ai>
- Source: <https://github.com/Canner/WrenAI>

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
