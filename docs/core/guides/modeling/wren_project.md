# Wren Project

A Wren project is a directory of YAML files that define a semantic layer (models, relationships, views, and instructions) over a database. It is the unit of authoring, version control, and deployment for MDL (Model Definition Language) definitions.

Instead of managing a single `mdl.json` by hand, you author each model in its own directory as human-readable YAML. The CLI compiles them into a deployable JSON manifest when needed.

YAML files use **snake_case** field names for readability. The compiled `target/mdl.json` uses **camelCase**, which is the wire format expected by the engine.

## Project Structure

```text
my_project/
├── wren_project.yml               # project metadata
├── models/
│   ├── orders/
│   │   └── metadata.yml           # table_reference mode (physical table)
│   ├── customers/
│   │   └── metadata.yml
│   └── revenue_summary/
│       ├── metadata.yml           # ref_sql mode (SQL-defined model)
│       └── ref_sql.sql            # SQL in separate file (optional)
├── views/
│   ├── monthly_revenue/
│   │   ├── metadata.yml
│   │   └── sql.yml                # statement in separate file (optional)
│   └── top_customers/
│       └── metadata.yml           # statement inline
├── relationships.yml              # all relationships
├── instructions.md                # user instructions for LLM (optional)
├── .wren/                         # runtime state (gitignored)
│   └── memory/                    # LanceDB index files
└── target/
    └── mdl.json                   # build output (gitignored)
```

Each model and view lives in its own subdirectory under `models/` and `views/` respectively.

---

## What Lives Where

A Wren project keeps schema artifacts together in the project directory. Global configuration lives separately in `~/.wren/`.

| Artifact | Location | Scope |
|----------|----------|-------|
| Models, views, relationships | `<project>/models/`, `<project>/views/`, `<project>/relationships.yml` | Project — version controlled |
| Instructions | `<project>/instructions.md` | Project — references this project's model/column names |
| Compiled MDL | `<project>/target/mdl.json` | Project — derived from YAML, gitignored |
| Memory (LanceDB) | `<project>/.wren/memory/` | Project — indexes this project's schema, gitignored |
| Profiles (connections) | `~/.wren/profiles.yml` | Global — environment-specific (dev/prod credentials) |
| Global config | `~/.wren/config.yml` | Global — CLI preferences |

**Why this separation?** Schema definitions are project-specific — they describe a particular data model. Connection credentials are environment-specific — the same project connects to different databases in dev vs. prod. Keeping them separate means projects are portable and safe to commit without leaking secrets.

---

## Project Discovery

When you run a wren command that needs the project (query, memory fetch, etc.), the CLI resolves the project root in this order:

1. `--path` flag (explicit)
2. `WREN_PROJECT_HOME` environment variable
3. Walk up from the current directory looking for `wren_project.yml`
4. `default_project` in `~/.wren/config.yml`

If no project is found, the CLI exits with an error and suggests running `wren context init` or setting `WREN_PROJECT_HOME`.

Once the project root is resolved, all paths (MDL, instructions, memory) are determined relative to it.

For running wren commands outside the project directory:

```bash
# option A: environment variable
export WREN_PROJECT_HOME=~/projects/sales
wren --sql "SELECT ..."

# option B: global config (~/.wren/config.yml)
default_project: ~/projects/sales
```

---

## Project Files

### `wren_project.yml`

```yaml
schema_version: 3
name: my_project
version: "1.0"
catalog: wren
schema: public
data_source: postgres
```

| Field | Description |
|-------|-------------|
| `schema_version` | Directory layout version. `2` = folder-per-entity, `3` = adds `dialect` field support (current). Owned by the CLI — do not bump manually. |
| `name` | Project name |
| `version` | User's own project version (free-form, no effect on parsing) |
| `catalog` | **Wren Engine namespace** — NOT your database catalog. Identifies this MDL project within the engine. Default: `wren`. |
| `schema` | **Wren Engine namespace** — NOT your database schema. Default: `public`. |
| `data_source` | Data source type (e.g. `postgres`, `bigquery`, `snowflake`) |

> **`catalog` / `schema` are NOT database settings.**
>
> These two fields define the Wren Engine's internal namespace for addressing models in SQL. They exist to support future multi-project querying. For single-project use, keep the defaults (`catalog: wren`, `schema: public`).
>
> Your database's actual catalog and schema are specified per-model in the `table_reference` section of each model's `metadata.yml`.

#### Two levels of catalog/schema

The same field names appear in two places with completely different meanings:

| Location | Refers to | Example | When to change |
|----------|-----------|---------|----------------|
| `wren_project.yml` → `catalog`, `schema` | Wren Engine namespace | `wren`, `public` | Only for multi-project setups |
| `models/*/metadata.yml` → `table_reference.catalog`, `table_reference.schema` | Database location | `""`, `main` | Must match your actual database |

### Model (`models/<name>/metadata.yml`)

A model must define its source in exactly one of two ways:

**table_reference** — maps to a physical table:

```yaml
name: orders
table_reference:
  catalog: ""
  schema: public
  table: orders
columns:
  - name: order_id
    type: INTEGER
    is_calculated: false
    not_null: true
    is_primary_key: true
    properties: {}
  - name: total
    type: DECIMAL
    is_calculated: false
    not_null: false
    properties: {}
primary_key: order_id
cached: false
properties: {}
```

**`dialect`** — optional field declaring which SQL dialect the model's `ref_sql` is written in. When omitted, the project-level `data_source` is used. This lets a single project contain models whose SQL targets different databases:

```yaml
name: revenue
ref_sql: "SELECT * FROM `project.dataset.table`"
dialect: bigquery
columns:
  - name: amount
    type: DECIMAL
```

Requires `schema_version: 3`. See [Dialect Override](#dialect-override) for details.

**ref_sql** — defines the model via a SQL query. SQL can be inline in `metadata.yml` or in a separate `ref_sql.sql` file (the `.sql` file takes precedence if both exist):

```yaml
name: revenue_summary
columns:
  - name: month
    type: DATE
    is_calculated: false
    not_null: true
    properties: {}
  - name: total_revenue
    type: DECIMAL
    is_calculated: false
    not_null: false
    properties: {}
```

```sql
-- models/revenue_summary/ref_sql.sql
SELECT DATE_TRUNC('month', order_date) AS month,
       SUM(total) AS total_revenue
FROM orders
GROUP BY 1
```

Using both `table_reference` and `ref_sql` in the same model is a validation error.

### View (`views/<name>/metadata.yml`)

Views have a `statement` field. Like ref_sql models, the SQL can be inline in `metadata.yml` or in a separate `sql.yml` file (the `sql.yml` takes precedence if both exist):

```yaml
name: top_customers
statement: >
  SELECT customer_id, SUM(total) AS lifetime_value
  FROM wren.public.orders GROUP BY 1 ORDER BY 2 DESC LIMIT 100
properties:
  description: "Top customers by lifetime value"
```

Like models, views support an optional **`dialect`** field (requires `schema_version: 3`):

```yaml
name: monthly_summary
statement: "SELECT date_trunc('month', created_at) FROM orders"
dialect: postgres
```

When set, the dialect is stored as metadata for downstream consumers. It does not currently affect how the engine parses the view's statement — view statements are always normalized into a logical plan via DataFusion's generic SQL parser. See [Dialect Override](#dialect-override) for details.

### `relationships.yml`

```yaml
relationships:
  - name: orders_customers
    models:
      - orders
      - customers
    join_type: MANY_TO_ONE
    condition: orders.customer_id = customers.customer_id
```

### `instructions.md`

Free-form Markdown with rules and guidelines for LLM-based query generation. Organize by topic with `##` headings:

```markdown
## Business rules
- Revenue queries must use net_revenue, not gross_revenue
- All queries must filter status = 'completed'

## Formatting
- Currency is TWD, display with thousand separators
- Timestamps are UTC+8
```

Instructions are consumed by agents, not by the engine. They are intentionally excluded from `target/mdl.json` — the wren-core rewrite pipeline has no use for them. Agents access instructions through two paths:

- `wren context instructions` — returns full text, run once at session start to capture global constraints
- `wren memory fetch -q "..."` — returns relevant instruction chunks alongside schema context per query

---

## Lifecycle

```text
wren context init              → scaffold project in current directory
  (edit models/, relationships.yml, instructions.md)
wren context validate          → check YAML structure (no DB needed)
wren context build             → compile to target/mdl.json
wren context upgrade           → upgrade project to latest schema_version
wren profile add my-pg ...     → save connection to ~/.wren/profiles.yml
wren memory index              → index schema + instructions into .wren/memory/
wren --sql "SELECT 1"          → verify connection
wren --sql "SELECT ..."        → start querying
```

After editing models, rebuild and re-index:

```text
wren context build
wren memory index
```

---

## Migrating from MDL JSON

If you already have an `mdl.json` (from the MCP server, an earlier Wren setup, or an AI agent that generated one), use `--from-mdl` to convert it into a v2 YAML project in one step:

```bash
wren context init --from-mdl /path/to/mdl.json --path my_project
```

This reads the camelCase JSON, converts all fields to snake_case YAML, and writes out the full project structure:

```text
my_project/
├── wren_project.yml          # catalog, schema, data_source from the manifest
├── models/
│   ├── orders/
│   │   └── metadata.yml      # one directory per model
│   └── customers/
│       └── metadata.yml
├── views/
│   └── top_customers/
│       └── metadata.yml      # one directory per view
├── relationships.yml
└── instructions.md
```

After import, validate and build:

```bash
wren context validate --path my_project
wren context build --path my_project
```

If the target directory already contains project files, add `--force` to overwrite:

```bash
wren context init --from-mdl mdl.json --path my_project --force
```

> **When to use this:** You have an existing `mdl.json` that was authored by hand or generated by an older workflow (e.g. the MCP server's `mdl_save_project` tool), and you want to adopt the YAML project format for version control and CLI-driven workflows.
>
> The import is `layoutVersion`-aware: manifests with `layoutVersion: 2` produce a `schema_version: 3` project with `dialect` fields preserved. Manifests without `layoutVersion` (or `layoutVersion: 1`) produce a `schema_version: 2` project.

---

## Upgrading an Existing Project

When new features are added to the project format (e.g. the `dialect` field in schema_version 3), use `wren context upgrade` to bring your project up to date:

```bash
wren context upgrade --path my_project
```

This upgrades to the latest `schema_version`. The command handles all intermediate steps automatically — for example, upgrading from v1 to v3 applies v1→v2 (restructure flat files into directories) then v2→v3 (enable dialect support).

### What each upgrade does

| Upgrade | File changes |
|---------|-------------|
| v1 → v2 | `models/*.yml` flat files → `models/<name>/metadata.yml` directories; `ref_sql` extracted to `ref_sql.sql`; `views.yml` → `views/<name>/metadata.yml` directories; old files deleted |
| v2 → v3 | No file layout changes — only bumps `schema_version` in `wren_project.yml` to enable `dialect` field support |

### Options

| Flag | Description |
|------|-------------|
| `--to N` | Upgrade to a specific schema_version instead of the latest |
| `--dry-run` | Preview what files would be created, deleted, or modified — without writing anything |

### Preview before upgrading

```bash
wren context upgrade --path my_project --dry-run
```

```text
Dry run — no files will be changed.

Would create:
  models/orders/metadata.yml
  models/orders/ref_sql.sql
  views/summary/metadata.yml

Would delete:
  models/orders.yml
  views.yml

Would modify:
  wren_project.yml (schema_version 1 -> 3)
```

### After upgrading

```bash
wren context validate --path my_project
wren context build --path my_project
```

> **When to use this:** Your project was created with an older CLI version and you want to use new features (like per-model `dialect`). If your project is already at the latest schema_version, the command exits with a "nothing to do" message.

---

## Field Mapping

The `build` step converts all YAML keys from snake_case to camelCase:

| YAML | JSON |
|------|------|
| `table_reference` | `tableReference` |
| `ref_sql` | `refSql` |
| `is_calculated` | `isCalculated` |
| `not_null` | `notNull` |
| `is_primary_key` | `isPrimaryKey` |
| `primary_key` | `primaryKey` |
| `join_type` | `joinType` |
| `data_source` | `dataSource` |
| `layout_version` | `layoutVersion` |
| `refresh_time` | `refreshTime` |
| `base_object` | `baseObject` |

Generic rule: split on `_`, capitalize each word after the first, join. All other fields (`name`, `type`, `catalog`, `schema`, `table`, `condition`, `models`, `columns`, `cached`, `dialect`, `properties`) are identical in both formats.

The `layoutVersion` field is stamped automatically by `wren context build` based on the project's `schema_version`. You do not set it manually in YAML.

---

## Dialect Override

Models and views support an optional `dialect` field that declares which SQL dialect their embedded SQL is written in. This requires `schema_version: 3`.

### Semantics

- **`dialect` omitted (or `null`)** — falls back to the project-level `data_source`. This is the default and matches the behavior of all existing projects.
- **`dialect` set** — the embedded SQL is written in the specified dialect, which may differ from the project's `data_source`.

### Model dialect

When a model has `dialect: bigquery` but the project's `data_source` is `postgres`, the engine knows the model's `ref_sql` contains BigQuery-flavored SQL (e.g. backtick-quoted identifiers, BigQuery functions). The engine uses this to select the correct SQL parser for the ref_sql.

```yaml
# models/revenue/metadata.yml
name: revenue
ref_sql: "SELECT * FROM `my-project.dataset.table`"
dialect: bigquery
columns:
  - name: amount
    type: DECIMAL
```

### View dialect

For views, the `dialect` field is currently **metadata only**. The engine normalizes view statements into a logical plan using DataFusion's generic SQL parser regardless of the dialect setting. The field is still valuable because:

- It documents the author's intent (which dialect the SQL was written in).
- Downstream consumers (ibis-server, MCP clients) can use it for dialect-aware processing.
- When dialect-aware view parsing is added in the future, the field will already be in place.

### Valid dialect values

`athena`, `bigquery`, `canner`, `clickhouse`, `databricks`, `datafusion`, `doris`, `duckdb`, `gcs_file`, `local_file`, `minio_file`, `mssql`, `mysql`, `oracle`, `postgres`, `redshift`, `s3_file`, `snowflake`, `spark`, `trino`

### Version requirements

The `dialect` field requires `schema_version: 3` in `wren_project.yml`. Using `dialect` in a `schema_version: 2` project produces a validation warning. The `schema_version` also controls the `layoutVersion` stamped in the compiled `target/mdl.json`:

| `schema_version` | `layoutVersion` | Capabilities |
|-------------------|-----------------|--------------|
| 1 | 1 | Legacy flat-file project format |
| 2 | 1 | Folder-per-entity project format |
| 3 | 2 | `dialect` field on models and views |

---

## .gitignore

```text
target/
.wren/
```

Source YAML and `instructions.md` are committed. Build output (`target/`) is always gitignored — it is derived from source YAML and can be regenerated with `wren context build`.

`.wren/memory/` contains both schema indexes (derived, rebuildable) and query history (NL-SQL pairs confirmed by users, not rebuildable). If your team wants to share confirmed query history as few-shot examples across members, you can commit `.wren/memory/` — but be aware that LanceDB files are binary and may produce merge conflicts when multiple people index or store concurrently.
