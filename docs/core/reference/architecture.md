# Architecture

Wren AI is built as an open context layer for agents. Architecturally, that means two things:

1. Business meaning is stored in explicit project artifacts: MDL, instructions, profiles, and memory.
2. Correctness is handled as a system of primitives the agent can orchestrate, not as one hidden feature.

The result is a stack where agents can query through governed business context while Wren AI handles modeling, planning, validation, execution, and recall.

## Correctness is a system

Text-to-SQL does not become reliable because one metadata field is present or one prompt is clever. It becomes reliable when several pieces work together.

| Pillar | What it means | Where it lives in Wren AI |
| --- | --- | --- |
| **Schema linking** | Knowing which models, columns, and relationships matter for a question. | MDL + memory retrieval (`wren memory fetch`) |
| **Value profiling** | Knowing what values actually appear in the data, such as what `status = 4` means. | Connector behavior, profiling workflows, instructions indexed into memory |
| **Ambiguity detection** | Knowing when the question is underspecified and needs clarification. | Skill orchestration by the agent |
| **Generation trace** | Showing how an answer was constructed: models, joins, CTEs, and expanded SQL. | `wren dry-plan` |
| **Retry and repair** | Recovering when generated SQL fails or points at the wrong modeled object. | Structured errors, `wren dry-run`, agent retry workflows |
| **Eval** | Detecting regressions when schemas, definitions, or prompts change. | Golden NL-SQL eval workflows in development |

Wren AI exposes these as primitives. The agent chooses when to fetch, recall, dry-plan, execute, repair, or ask a clarification. The trace stays visible where the agent's reasoning happens.

## System overview

At a high level, Wren AI has four layers:

| Layer | Responsibility |
| --- | --- |
| **Agent workflow** | Skills guide the agent through onboarding, MDL generation, querying, validation, and memory updates. |
| **Project context** | MDL, instructions, profiles, and memory describe what the data means and how it should be used. |
| **Planning engine** | Wren AI expands modeled SQL into executable SQL using the semantic engine and SQL planner. |
| **Execution layer** | Connectors run the planned SQL against the target data source and return results. |

```mermaid
flowchart TD
  user["User / Agent"] --> skills["Agent skills<br/>onboarding · generate MDL · usage"]
  skills --> cli["Wren CLI / Python SDK"]

  cli --> project["Project context<br/>MDL · instructions · queries"]
  cli --> runtime["Runtime context<br/>profile · memory · history"]

  project --> orchestrator["Plan + execute pipeline"]
  runtime --> orchestrator

  orchestrator --> planner["SQL planner<br/>sqlglot · CTE rewrite · policy"]
  planner --> core["wren-core<br/>Rust semantic engine"]
  core --> connectors["Connectors<br/>22+ data sources"]
  connectors --> data["Data source"]
```

The same architecture can also be read as a query path:

```mermaid
sequenceDiagram
  participant U as User / Agent
  participant S as Skill
  participant M as Memory
  participant W as Wren CLI / SDK
  participant P as SQL planner
  participant R as wren-core
  participant D as Data source

  U->>S: Ask a business question
  S->>M: Recall similar NL-SQL pairs
  S->>M: Fetch relevant schema
  S->>W: Submit SQL against MDL
  W->>P: Load context, plan SQL
  P->>R: Expand MDL semantics
  P->>D: Execute via connector
  D-->>U: Return result
  S->>M: Store confirmed pair
```

## Core components

### Agent skills

[Skills](/oss/reference/skills) are Markdown workflows that tell AI coding agents how to operate Wren AI safely. They encode procedures such as "build MDL before querying," "fetch context before writing SQL," and "store confirmed examples after success."

Skills sit above the CLI. They do not hide the primitives; they help the agent use them in the right order.

### Wren CLI

The CLI is the main interface for agents and developers. It discovers the project, resolves the active profile, and routes commands to the right subsystem.

| Command | What it does |
| --- | --- |
| `wren query` / `wren --sql` | Plan and execute SQL, then return results. |
| `wren dry-plan` | Plan SQL and show the expanded SQL without executing it. |
| `wren dry-run` | Validate SQL against the live database without returning rows. |
| `wren context` | Initialize, validate, build, and inspect a Wren project. |
| `wren profile` | Manage database connection profiles. |
| `wren memory` | Index context, fetch schema items, recall examples, and store confirmed queries. |
| `wren utils` | Run helper operations such as type normalization. |

### Project context

A Wren project is the portable context package for one business data layer.

It includes:

- **MDL source files** - models, relationships, views, cubes, and project metadata.
- **`instructions.md`** - business and operational guidance for agents.
- **`queries.yml`** - reviewed natural-language-to-SQL examples that can seed memory.
- **`target/mdl.json`** - compiled MDL manifest used by the engine.
- **`.wren/memory/`** - local LanceDB indexes for schema retrieval and query recall.

Connection profiles live separately in `~/.wren/profiles.yml` so credentials stay environment-specific.

See the [MDL schema reference](/oss/reference/mdl) for the full project structure.

### Wren Python SDK

The `wren-engine` Python package exposes the same plan-and-execute pipeline that the CLI drives. The CLI is a thin Typer wrapper over the SDK — both share the orchestration code, both can be embedded in agent frameworks, notebooks, and applications.

When invoked (via CLI or SDK), the orchestrator:

1. Receives modeled SQL.
2. Loads the compiled MDL manifest and active connection profile.
3. Calls the SQL planning subsystem (sqlglot + CTE rewrite + wren-core).
4. Sends planned SQL to the correct connector.
5. Returns results as a PyArrow table.

For higher-level integrations, see the [LangChain SDK](/oss/sdk/langchain) and [Pydantic AI SDK](/oss/sdk/pydantic) — both wrap this pipeline as agent tools.

### SQL planning

The SQL planner transforms SQL written against modeled objects into SQL that the target database can execute.

Three pieces collaborate:

- **sqlglot** parses SQL, qualifies table and column references, and transpiles between SQL dialects.
- **CTE rewriter** identifies referenced MDL objects and injects expanded model SQL as CTEs.
- **wren-core** expands MDL semantics: models, relationships, calculated fields, and views.

```text
User SQL against MDL
  |
  |-- parse and qualify SQL
  |-- identify referenced models/views
  |-- extract the relevant MDL manifest slice
  |-- expand models and calculated fields through wren-core
  |-- inject expanded CTEs
  |-- run policy checks
  |-- transpile to the target dialect
  |
  v
Executable SQL for the connected data source
```

### wren-core

`wren-core` is the Rust semantic engine. It is exposed to Python through PyO3 bindings and acts as the source of truth for MDL semantics.

It handles:

- maintaining MDL state in a session context
- extracting only the manifest objects needed for a query
- expanding `table_reference` and `ref_sql` models
- resolving calculated fields
- expanding relationship-aware expressions
- enforcing how modeled objects map to SQL

### Connectors

Connectors execute planned SQL against the target database. Each connector implements a common interface for query execution, dry-run validation, type handling, and connection lifecycle.

Supported data sources include PostgreSQL, MySQL, BigQuery, Snowflake, DuckDB, ClickHouse, Trino, SQL Server, Databricks, Redshift, Oracle, Athena, Apache Spark, and more.

### Memory layer

The [memory system](/oss/concepts/memory_system) is a LanceDB-backed retrieval layer with two primary collections:

| Collection | Contents | Purpose |
| --- | --- | --- |
| `schema_items` | Models, columns, relationships, views, cubes, and instructions | Retrieve the right context for each question. |
| `query_history` | Confirmed natural-language-to-SQL pairs | Recall examples that worked before. |

Memory turns usage into behavioral context. Each confirmed query can become a future example.

## Data flows

### Query execution

```text
wren --sql "SELECT customer_id, SUM(total) FROM orders GROUP BY 1"
  |
  |-- 1. Discover project: wren_project.yml -> target/mdl.json
  |-- 2. Resolve profile: ~/.wren/profiles.yml
  |-- 3. Plan: parse -> extract MDL -> expand CTEs -> transpile
  |-- 4. Execute: connector -> database -> PyArrow table
  |-- 5. Output: table, CSV, JSON, or SDK return value
```

### Agent-assisted query

```text
User asks a business question
  |
  |-- skill selects the query workflow
  |-- memory recalls similar accepted NL-SQL pairs
  |-- memory fetches relevant schema and instructions
  |-- agent writes SQL against MDL objects
  |-- Wren AI dry-plans, validates, or executes
  |-- agent repairs or asks a clarification if needed
  |-- confirmed answer is stored back into memory
```

### Project build

```text
wren context build
  |
  |-- read wren_project.yml
  |-- read models, views, cubes, and relationships
  |-- validate structure and references
  |-- compile source YAML into target/mdl.json
```

### Memory lifecycle

```text
wren memory index           -> parse MDL and instructions, build schema_items
wren memory fetch -q "..."  -> retrieve relevant schema context
wren memory recall -q "..." -> retrieve similar confirmed examples
wren memory store           -> append a new NL-SQL pair to query_history
```

## Key dependencies

| Dependency | Role |
| --- | --- |
| `wren-core-py` | Python bindings for the Rust semantic engine. |
| `sqlglot` | SQL parsing, qualification, and dialect transpilation. |
| Database connectors | Execution layer for supported data sources. |
| `pyarrow` | Query result representation. |
| `lancedb` | Vector storage for memory. |
| `sentence-transformers` | Local embeddings for memory search. |
| `typer` | CLI framework. |
| `pydantic` | Configuration and connection validation. |

## In short

Wren AI architecture separates context from execution:

- project files define what the data means
- memory retrieves relevant context and examples
- skills tell agents how to operate safely
- the planner and Rust engine turn modeled SQL into executable SQL
- connectors run that SQL against the database

That separation is what makes Wren AI portable, inspectable, and agent-native.
