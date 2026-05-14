---
name: wren-generate-mdl
description: "Generate a Wren MDL project by exploring a database with available tools (SQLAlchemy, database drivers, MCP connectors, or raw SQL). Guides agents through schema discovery, type normalization, and MDL YAML generation using the wren CLI. Use when: user wants to create or set up a new MDL, onboard a new data source, or scaffold a project from an existing database."
license: Apache-2.0
metadata:
  author: wren-engine
  version: "2.2"
---

# Generate Wren MDL — CLI Agent Workflow

## Version check

Silently fetch `https://raw.githubusercontent.com/Canner/wren-engine/main/skills/versions.json`.
Compare the `wren-generate-mdl` key with this skill's version (from the frontmatter above).
If the remote version is newer, notify the user before proceeding:

> A newer version of the **wren-generate-mdl** skill is available.
> Update with:
> ```
> npx skills add Canner/wren-engine --skill wren-generate-mdl
> ```
> The CLI auto-detects your installed agent. To target a specific one, add `--agent <name>` (e.g., `claude-code`, `cursor`, `windsurf`, `cline`).

Then continue with the workflow below regardless of update status.

---

Builds an MDL project by discovering database schema and converting it
into Wren's YAML project format. The agent uses whatever database tools
are available in its environment for introspection; the wren CLI handles
type normalization, validation, and build.

For memory and query workflows after setup, see the **wren-usage** skill.

---

## Prerequisites

- `wren` CLI installed (`pip install wren-engine[<datasource>]`)
- A working database connection (credentials available to the agent)
- A wren profile configured (`wren profile add`) or connection info ready

---

## Phase 0 — Detect existing project

**Goal:** If the current directory is already inside a wren project, let the user decide how to proceed.

Check whether `wren_project.yml` exists in the current working directory
(or any parent up to the repository root). If found:

1. Tell the user that an existing wren project was detected and show its path.
2. Ask:
   - **Reset** — wipe the existing project (`models/`, `views/`,
     `relationships.yml`, `instructions.md`, and rebuild `wren_project.yml`)
     and regenerate from scratch in the same directory.
   - **New path** — keep the existing project untouched and choose a
     different directory for the new project. Ask the user for the new path,
     then `wren context init --path <new_path>` and continue from Phase 1
     using that path.

If no existing project is detected, proceed directly to Phase 1.

---

## Phase 1 — Establish connection and scope

**Goal:** Confirm the agent can reach the database and agree on scope with the user.

1. Verify connectivity using whichever tool is available:
   - If SQLAlchemy: `engine.connect()` test
   - If database driver: simple query like `SELECT 1`
   - If wren profile exists: `wren profile debug` to check config
   - If raw SQL via wren: `wren --sql "SELECT 1"` (requires profile or connection file)

2. Ask the user:
   - Which **schema(s)** or **dataset(s)** to include (skip if only one exists)
   - Whether to include **all tables** or a subset
   - The **datasource type** for wren (e.g., `postgres`, `bigquery`, `snowflake`) — needed for type normalization dialect

---

## Phase 2 — Discover schema

**Goal:** Collect table names, column names, column types, and constraints.

Use whatever introspection method is available. Here are common approaches
ranked by convenience:

### Option A: SQLAlchemy (recommended if available)

```python
from sqlalchemy import create_engine, inspect

engine = create_engine(connection_url)
inspector = inspect(engine)

tables = inspector.get_table_names(schema="public")

for table in tables:
    columns = inspector.get_columns(table, schema="public")
    # columns → [{"name": "id", "type": INTEGER(), "nullable": False, ...}]

    pk = inspector.get_pk_constraint(table, schema="public")
    # pk → {"constrained_columns": ["id"], "name": "orders_pkey"}

    fks = inspector.get_foreign_keys(table, schema="public")
    # fks → [{"constrained_columns": ["customer_id"],
    #          "referred_table": "customers",
    #          "referred_columns": ["id"]}]
```

### Option B: Database-specific driver

- **psycopg / asyncpg (Postgres):** Query `information_schema.columns` and `information_schema.table_constraints`
- **google-cloud-bigquery:** `client.list_tables()`, `client.get_table()` → `table.schema`
- **snowflake-connector-python:** `SHOW COLUMNS IN TABLE`, `SHOW PRIMARY KEYS IN TABLE`
- **clickhouse-driver:** `DESCRIBE TABLE`, `system.tables`

### Option C: Raw SQL via wren

If no driver is available but a wren profile is configured, query
`information_schema` through wren itself:

```bash
wren --sql "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'" -o json
wren --sql "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'orders'" -o json
```

Note: this goes through the MDL layer, so it only works if you already
have a minimal MDL or if the database supports `information_schema` as
regular tables. For bootstrapping from zero, Option A or B is preferred.

---

## Phase 3 — Normalize types

**Goal:** Convert raw database types to wren-core-compatible types.

### Python import (recommended for batch processing)

```python
from wren.type_mapping import parse_type, parse_types

# Single type
normalized = parse_type("character varying(255)", "postgres")  # → "VARCHAR(255)"

# Batch — entire table at once
columns = [
    {"column": "id", "raw_type": "int8"},
    {"column": "name", "raw_type": "character varying"},
    {"column": "total", "raw_type": "numeric(10,2)"},
]
normalized_cols = parse_types(columns, dialect="postgres")
# Each dict now has a "type" key with the normalized value
```

### CLI (if Python import not available)

Single type:
```bash
wren utils parse-type --type "character varying(255)" --dialect postgres
# → VARCHAR(255)
```

Batch (stdin JSON):
```bash
echo '[{"column":"id","raw_type":"int8"},{"column":"name","raw_type":"character varying"}]' \
  | wren utils parse-types --dialect postgres
```

---

## Phase 4 — Scaffold and write MDL project

**Goal:** Create the YAML project structure.

### Step 1 — Initialize project

```bash
wren context init --path /path/to/project
```

This creates:
```text
project/
├── wren_project.yml
├── models/              # business-facing tables/models
├── views/               # named SQL statements
├── cubes/               # pre-aggregation cubes (measures + dimensions)
├── relationships.yml
└── instructions.md
```

> **When to define cubes:** If the user asks aggregation questions like
> "revenue by month" or "top customers", define cubes alongside models —
> they give agents a structured query API instead of forcing them to
> hand-write `GROUP BY` / `DATE_TRUNC` SQL. See the
> [Cube guide](https://github.com/Canner/WrenAI/blob/main/docs/core/guides/modeling/cube.md).

> **IMPORTANT: `catalog` and `schema` in `wren_project.yml`**
>
> These are Wren Engine's internal namespace — they are NOT the database's
> native catalog or schema. Keep the defaults (`catalog: wren`, `schema: public`)
> unless you are intentionally configuring a multi-project namespace.
>
> Your database's actual catalog/schema is specified per-model in `table_reference`
> (see Step 2). Do not copy database catalog/schema values into `wren_project.yml`.

### Step 2 — Write model files

For each table, create a YAML file under `models/`. Use snake_case
naming (the build step converts to camelCase automatically).

```yaml
# models/orders/metadata.yml
name: orders
table_reference:
  catalog: ""           # database catalog (empty string if not applicable;
                        #   for DuckDB, use the DB file name without extension,
                        #   e.g. jaffle_shop.duckdb → catalog: jaffle_shop)
  schema: public        # database schema (this IS the DB schema)
  table: orders         # database table name
primary_key: order_id
columns:
  - name: order_id
    type: INTEGER
    not_null: true
  - name: customer_id
    type: INTEGER
  - name: total
    type: "DECIMAL(10, 2)"
  - name: status
    type: VARCHAR
    properties:
      description: "Order status: pending, shipped, delivered, cancelled"
```

### Step 3 — Write relationships

From foreign key constraints discovered in Phase 2:

```yaml
# relationships.yml
- name: orders_customers
  models:
    - orders
    - customers
  join_type: many_to_one
  condition: "orders.customer_id = customers.customer_id"
```

Join type mapping:
- FK table → PK table: `many_to_one`
- PK table → FK table: `one_to_many`
- Unique FK: `one_to_one`
- Junction table: `many_to_many`

If no foreign keys were found, infer from naming conventions:
- Column `<table>_id` or `<table_singular>_id` → likely FK to `<table>`
- Ask the user to confirm inferred relationships

### Step 4 — Add descriptions (optional but valuable)

Ask the user to describe:
- Each model (1-2 sentences about what the table represents)
- Key columns (especially calculated fields or non-obvious names)

These descriptions are indexed by `wren memory index` and significantly
improve LLM query accuracy.

---

## Phase 5 — Validate and build

```bash
# Validate YAML structure and integrity
wren context validate --path /path/to/project

# If strict mode is desired:
wren context validate --path /path/to/project --strict

# Build JSON manifest
wren context build --path /path/to/project

# Verify against database
wren --sql "SELECT * FROM <model_name> LIMIT 1"
```

If validation fails, fix the reported issues and re-run. Common errors:
- Duplicate model/column names
- Missing primary key
- Relationship referencing non-existent model
- Invalid column type (try re-running through `parse_type`)

---

## Phase 6 — Initialize memory

```bash
# Index schema (generates seed NL-SQL examples automatically)
wren memory index

# Verify
wren memory status
```

After this step, `wren memory fetch` and `wren memory recall` are
operational. See the **wren-usage** skill for query workflows.

---

## Phase 7 — Iterate with the user

The initial MDL is a starting point. Improve it by:
- Adding calculated columns based on business logic
- Adding views for common query patterns
- Refining descriptions based on actual query usage
- Adding access control (RLAC/CLAC) if needed

Each change follows: edit YAML → `wren context validate` →
`wren context build` → `wren memory index`.

---

## Quick reference

| Task | Command / Method |
|------|-----------------|
| Discover tables | Agent's own tools (SQLAlchemy, driver, raw SQL) |
| Discover columns + types | Agent's own tools |
| Discover constraints | Agent's own tools |
| Normalize types (Python) | `from wren.type_mapping import parse_type` |
| Normalize types (CLI) | `wren utils parse-type --type T --dialect D` |
| Normalize types (batch) | `wren utils parse-types --dialect D < columns.json` |
| Scaffold project | `wren context init` |
| Write models | Create `models/<name>/metadata.yml` |
| Write relationships | Edit `relationships.yml` |
| Validate | `wren context validate` |
| Build manifest | `wren context build` |
| Test query | `wren --sql "SELECT * FROM <model> LIMIT 1"` |
| Index memory | `wren memory index` |

---

## Things to avoid

- Do not hardcode database-specific type strings in MDL — always normalize via `parse_type`
- Do not skip validation before build — invalid YAML produces broken manifests silently
- Do not guess column types — introspect from the actual database
- Do not write relationships without confirming join conditions — wrong conditions cause silent query errors
- Do not skip `wren memory index` after build — stale indexes degrade recall quality
