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

## Custom access control

The default `WrenAccessControlProvider` evaluates MDL row and column rules.
Rust applications can replace it by implementing `AccessControlProvider` and
passing an `Arc<dyn AccessControlProvider>` to
`mdl::transform_sql_with_ctx_with_access_control`. The same provider is used for
query planning and permission-error diagnostics. Existing transform functions
continue to use the MDL provider.

For remote SQL generation, first call
`AnalyzedWrenMDL::analyze_with_unfiltered_schema` to infer physical columns without
applying MDL column rules. This prepares schema and lineage; it does **not**
authorize a query. For locally registered tables, use `analyze_with_tables`.
Then apply the chosen provider through the provider-aware transform function or
`mdl::context::apply_wren_on_ctx_with_access_control` for direct DataFusion planning.
A context configured with a custom provider must not be passed to the default
transform function expecting that provider to be retained: the default function
reconfigures access control using MDL rules.

A provider supplies:

- `row_filter`: an optional DataFusion expression over semantic model columns.
  Return an error to deny the entire model; `None` means no row restriction.
- `column_access`: `Allow` or `Deny { rule_name }`. Denied columns are omitted
  from wildcards; explicit references produce a permission error.
- `collect_required_fields`: columns on this model needed to evaluate the row
  filter, even when absent from the user's projection. These columns also undergo
  column checks and do not become additional user-visible result columns.

`AccessScope::DirectQuery` includes subqueries written by the user.
`InternalSubquery` is reserved for subqueries introduced by a provider's row filter;
these are analyzed recursively with the same provider. Providers must support
concurrent calls and must not share mutable query traversal state. Properties are
normalized to lowercase keys before provider evaluation. Provider errors stop
planning without switching to another provider.

This Rust extension API does not include column masking or a Python/JavaScript
provider registration API. Applications remain responsible for authenticating the
identity bound to their provider.

For a complete runnable example, see
[`custom-access-control.rs`](../wren-example/examples/custom-access-control.rs).
From the `core/wren-core` workspace, run
`cargo run -p wren-example --example custom-access-control`.
