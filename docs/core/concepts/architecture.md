# Architecture

Wren AI is built as a system for **correctness** — not as a single feature. Text-to-SQL fails when any one of six pieces is missing; we build all six as primitives the agent orchestrates.

## Correctness is a system, not a switch

Correctness is the result of six things working together. Miss any one of them and the agent fails in that exact gap.

| Pillar | What it means | Where it lives in Wren AI |
|---|---|---|
| **Schema linking** | Knowing which tables to look at for a given question. | MDL + memory schema retrieval (`wren memory fetch`) |
| **Value profiling** | Knowing what values actually live in those columns — what `status = 4` resolves to, whether `is_active` is `'Y'/'N'` or `true/false`. | Connector type coercion + `instructions.md` indexed into memory |
| **Ambiguity detection** | Knowing when a question is ambiguous and a clarification is needed before generating SQL. | Skill orchestration layer (handled by the agent using Wren AI's primitives) |
| **Generation trace** | Being able to show *how* an answer was constructed — which models, which joins, which CTEs. | `wren dry-plan` returns the expanded SQL deterministically |
| **Retry and repair** | Being able to recover when the first SQL fails — re-plan, try a different model, surface a structured error. | Structured error responses + `wren dry-run` for pre-flight validation |
| **Eval** | Detecting regression when underlying definitions change — schema drift, business rule rewrites, model renames. | Golden NL-SQL eval runner (in development) |

This is why Wren AI exposes **primitives**, not a closed product. The agent does the orchestration — picking the skill, asking the clarification, looping on retry. The trace lives where the agent's reasoning lives. We do not wrap correctness inside our own dashboard that you have to learn.

The rest of this page documents the components that implement those primitives.

## Overview

```text
┌──────────────────────────────────────────────────────────┐
│                      Wren CLI (Typer)                    │
│                                                          │
│  --sql / query   dry-plan   dry-run   version            │
│  context         profile    memory    utils              │
└──┬──────────────┬──────────────┬──────────────┬──────────┘
   │              │              │              │
   ▼              ▼              │              ▼
┌────────────┐ ┌────────────┐    │   ┌────────────────────┐
│ Profile    │ │ Context    │    │   │ Memory Layer       │
│ Mgmt       │ │ Mgmt       │    │   │ (LanceDB)          │
│            │ │            │    │   │                    │
│ ~/.wren/   │ │ init       │    │   │ schema_items       │
│ profiles   │ │ validate   │    │   │ query_history      │
│ .yml       │ │ build      │    │   │                    │
└─────┬──────┘ └─────┬──────┘    │   │ fetch / recall     │
      │              │           │   │ store / index      │
      │   connection │ mdl.json  │   └────────────────────┘
      │       info   │           │
      └──────┐ ┌─────┘           │
             ▼ ▼                 │
      ┌──────────────┐           │
      │  WrenEngine  │◄──────────┘  (dry-plan, query, dry-run)
      │              │
      │  plan()      │
      │  execute()   │
      └──┬───────┬───┘
         │       │
    plan │       │ execute
         │       │
         ▼       ▼
┌──────────────┐ ┌──────────────────┐
│ SQL Planning │ │ Connectors       │
│              │ │                  │
│ sqlglot      │ │                  │
│  parse       │ │ Postgres  DuckDB │
│  qualify     │ │ BigQuery  MySQL  │
│  transpile   │ │ Snowflake Trino  │
│              │ │ ...18+ sources   │
│ CTE Rewriter │ │                  │
│  inject CTEs │ └──────────────────┘
│              │
│ Policy check │
└──────┬───────┘
       │
       ▼
┌──────────────────┐
│ wren-core-py     │
│ (Rust / PyO3)    │
│                  │
│ SessionContext   │
│ ManifestExtractor│
│ transform_sql()  │
└──────────────────┘
```

## Components

### CLI layer

The top-level command router, built on [Typer](https://typer.tiangolo.com/). It parses flags, discovers the MDL project and active profile, then delegates to WrenEngine or the appropriate subsystem.

| Command | What it does |
|---------|-------------|
| `wren --sql` / `wren query` | Plan + execute SQL, return results |
| `wren dry-plan` | Plan only — show the expanded SQL without executing |
| `wren dry-run` | Validate SQL against the live database without returning rows |
| `wren context` | Project management — init, validate, build, show |
| `wren profile` | Connection management — add, switch, list, debug, rm |
| `wren memory` | Schema indexing and NL-SQL recall |
| `wren utils` | Type normalization utilities |

### WrenEngine

The central orchestrator (`engine.py`). It owns the plan-then-execute pipeline:

1. Receive user SQL
2. Call the SQL planning subsystem to expand MDL references
3. Pass the planned SQL to a connector for execution
4. Return results as a PyArrow table

### SQL planning

Transforms user SQL from semantic model references to executable database SQL. Three libraries collaborate:

- **sqlglot** — parses SQL, qualifies table/column references, transpiles between dialects
- **CTE Rewriter** — identifies which MDL models are referenced, builds a CTE for each, and injects them into the query
- **wren-core-py** — Rust engine (via PyO3 bindings) that expands model definitions, resolves calculated fields, and handles relationship joins

The planning pipeline:

```
User SQL (e.g. SELECT * FROM orders WHERE status = 'pending')
  │
  ├── sqlglot: parse → qualify tables → normalize identifiers
  ├── Extract referenced table names → ["orders"]
  ├── ManifestExtractor: filter MDL to only referenced models
  ├── Policy check (strict mode, denied functions)
  ├── CTE Rewriter:
  │     ├── For each model: wren-core transform_sql() → expanded CTE
  │     └── Inject CTEs into original query
  └── sqlglot: transpile to target dialect (postgres, bigquery, etc.)
        │
        ▼
  WITH "orders" AS (
    SELECT o_orderkey, o_custkey, o_totalprice
    FROM "public"."orders"
  )
  SELECT * FROM "orders" WHERE status = 'pending'
```

### Connectors

Data source connectors execute the planned SQL against the actual database. Each connector implements a common interface for query execution, dry-run validation, and connection lifecycle.

Supported data sources: PostgreSQL, MySQL, BigQuery, Snowflake, DuckDB, ClickHouse, Trino, SQL Server, Databricks, Redshift, Oracle, Athena, Apache Spark, and more.

Each connector:
- Receives dialect-specific SQL from the planning stage
- Executes against the target database
- Handles type coercion (Decimal, UUID, etc.)
- Returns a PyArrow table

### Profile management

Stores named database connections in `~/.wren/profiles.yml`. One profile is active at a time. All `wren` commands use the active profile unless overridden with explicit flags.

See [Profiles](../guides/profiles.md) for details.

### Context management

Manages the MDL project lifecycle — YAML authoring, validation, and compilation to `target/mdl.json`.

Key operations:
- `wren context init` — scaffold a new project (or import from existing `mdl.json`)
- `wren context validate` — check YAML structure without a database
- `wren context build` — compile snake_case YAML to camelCase JSON
- `wren context show` — display the current project summary

See [Wren Project](../guides/modeling/wren_project.md) for the project format.

### Memory layer

A LanceDB-backed semantic index with two collections:

| Collection | Contents | Purpose |
|------------|----------|---------|
| **schema_items** | Models, columns, relationships, views | Semantic schema search per question |
| **query_history** | Confirmed NL → SQL pairs | Few-shot recall for similar questions |

The memory layer enables the self-learning loop: each confirmed query improves future recall accuracy.

See [Memory](../guides/memory.md) for details.

### wren-core (Rust engine)

The core semantic engine, written in Rust and exposed to Python via PyO3 bindings (`wren-core-py`). It handles:

- **SessionContext** — maintains the MDL state and provides `transform_sql()` for expanding model definitions into SQL
- **ManifestExtractor** — filters the full MDL manifest to only the models referenced in a query, reducing planning overhead
- **Model expansion** — resolves `table_reference` and `ref_sql` models into physical SQL, handles calculated fields, and expands relationship joins

The Rust engine is where the MDL semantics are enforced — it is the source of truth for how models map to SQL.

## Data flows

### Query execution

```
wren --sql "SELECT customer_id, SUM(total) FROM orders GROUP BY 1"
  │
  ├── 1. Discover MDL: project auto-discovery → target/mdl.json
  ├── 2. Resolve connection: active profile → ~/.wren/profiles.yml
  ├── 3. Plan: sqlglot parse → extract models → wren-core CTE expand → transpile
  ├── 4. Execute: connector → database → PyArrow table
  └── 5. Output: format as table / csv / json
```

### Project build

```
wren context build
  │
  ├── Read wren_project.yml + models/*/ + views/*/ + relationships.yml
  ├── Validate structure and references
  ├── Convert snake_case → camelCase
  └── Write target/mdl.json
```

### Memory lifecycle

```
wren memory index          → Parse MDL, embed schema items, store in LanceDB
wren memory fetch -q "..." → Embed query, search schema_items, return context
wren memory recall -q "..."→ Embed query, search query_history, return examples
wren memory store          → Embed NL-SQL pair, append to query_history
```

## Key dependencies

| Dependency | Role |
|------------|------|
| **wren-core-py** | Rust semantic engine (PyO3 bindings) |
| **sqlglot** | SQL parsing, qualification, dialect transpilation |
| **database connectors** | Data source execution layer |
| **pyarrow** | Query result representation |
| **lancedb** | Vector storage for memory layer |
| **sentence-transformers** | Local embeddings for memory search |
| **typer** | CLI framework |
| **pydantic** | Config and connection validation |
