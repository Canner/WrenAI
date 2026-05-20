---
sidebar_label: MDL schema
---

# MDL schema reference

This page documents every YAML artifact in a Wren project — `wren_project.yml`, models, relationships, views, cubes, and `instructions.md` — with the full field surface for each.

> For the conceptual framing of MDL, see [What does MDL do for the agent?](/oss/concepts/what_is_mdl). For the project lifecycle commands, see [Manage project](/oss/guides/manage_project). For the canonical YAML compilation flow, run `wren context build` after editing.

## Project structure

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
├── cubes/
│   └── revenue/
│       └── metadata.yml
├── relationships.yml              # all relationships
├── instructions.md                # business and operational guidance for agents
├── queries.yml                    # curated NL-SQL pairs (optional)
├── .wren/                         # runtime state (gitignored)
│   └── memory/                    # LanceDB index files
└── target/
    └── mdl.json                   # build output (gitignored)
```

YAML files use **snake_case** field names. The compiled `target/mdl.json` uses **camelCase** — the wire format expected by the engine.

## `wren_project.yml`

```yaml
schema_version: 3
name: my_project
version: "1.0"
catalog: wren
schema: public
data_source: postgres
profile: my-pg
```

| Field | Type | Required | Description |
|---|---|---|---|
| `schema_version` | int | yes | Directory layout version. `2` = folder-per-entity, `3` = adds `dialect` field support (current). Owned by the CLI — bump with `wren context upgrade`. |
| `name` | string | yes | Project identifier. |
| `version` | string | no | User-defined project version (free-form, no parsing effect). |
| `catalog` | string | no | **Wren AI namespace** — not your database catalog. Defaults to `wren`. |
| `schema` | string | no | **Wren AI namespace** — not your database schema. Defaults to `public`. |
| `data_source` | string | no | Data source type (`postgres`, `bigquery`, `snowflake`, ...). Set by `wren context set-profile`. |
| `profile` | string | no | The bound connection profile name. Set by `wren context set-profile`. |

> **Two levels of `catalog` and `schema`.** The same field names appear in two places with completely different meanings. The project-level fields are Wren AI's internal namespace; the model-level `table_reference.catalog` and `table_reference.schema` point at the underlying database location.
>
> | Location | Refers to | Example |
> |---|---|---|
> | `wren_project.yml` → `catalog`, `schema` | Wren AI namespace | `wren`, `public` |
> | `models/*/metadata.yml` → `table_reference.catalog`, `table_reference.schema` | Database location | `jaffle_shop`, `main` |

## Models (`models/<name>/metadata.yml`)

Each model is its own directory under `models/`. A model defines:

- where its data comes from — `table_reference` or `ref_sql`
- which columns are exposed
- relationships and calculated fields

### Model fields

| Field | Required | Description |
|---|---|---|
| `name` | yes | Unique model name (used in SQL queries). |
| `table_reference` | one of two | Maps to a physical table (`catalog`, `schema`, `table`). |
| `ref_sql` | one of two | A SQL SELECT used as the model's data source. |
| `columns` | yes | List of columns to expose. |
| `primary_key` | no | Column name uniquely identifying a row; required for `TO_MANY` relationship traversals. |
| `cached` | no | Whether query results should be cached. Defaults to `false`. |
| `dialect` | no | SQL dialect of the model's `ref_sql`. Overrides project-level `data_source` for this model. Requires `schema_version: 3`. |
| `properties` | no | Arbitrary key-value metadata. |

Using both `table_reference` and `ref_sql` in the same model is a validation error.

### `table_reference`

| Field | Type | Required | Description |
|---|---|---|---|
| `catalog` | string | no | Source-side catalog (DuckDB database stem, BigQuery project, Snowflake database). Omit for sources without a catalog layer. |
| `schema` | string | no | Source-side schema or dataset. Omit for flat sources. |
| `table` | string | yes | Source-side table or view name. |

### Example: `table_reference`

```yaml
name: customers
table_reference:
  catalog: jaffle_shop
  schema: main
  table: customers
primary_key: customer_id
columns:
  - name: customer_id
    type: INTEGER
    is_primary_key: true
    not_null: true
  - name: first_name
    type: VARCHAR
  - name: last_name
    type: VARCHAR
  - name: number_of_orders
    type: BIGINT
```

### Example: `ref_sql`

```yaml
name: revenue_summary
ref_sql: |
  SELECT DATE_TRUNC('month', order_date) AS month,
         SUM(total) AS total_revenue
  FROM orders
  GROUP BY 1
columns:
  - name: month
    type: DATE
  - name: total_revenue
    type: DECIMAL
```

The SQL can live inline (above) or in a sibling `ref_sql.sql` file. The `.sql` file takes precedence.

### Columns

| Field | Required | Description |
|---|---|---|
| `name` | yes | Column name used in SQL. |
| `type` | yes | SQL type (`VARCHAR`, `INTEGER`, `DOUBLE`, `DATE`, `TIMESTAMP`, `BOOLEAN`, `DECIMAL`, `JSON`, ...). |
| `is_calculated` | no | If `true`, the value is derived from `expression` at query time. |
| `expression` | no | SQL expression for calculated columns, or a single-column reference for simple renames. |
| `relationship` | no | Name of a relationship — makes this a join handle column. |
| `not_null` | no | Constraint hint. Defaults to `false`. |
| `is_primary_key` | no | Marks the column as the model's primary key. |
| `is_hidden` | no | Engine-internal flag; column is stripped from the symbol table and invisible to all clients. |
| `properties` | no | Arbitrary metadata (e.g. `properties.description`). |

#### Calculated columns

```yaml
- name: total_with_tax
  type: DOUBLE
  is_calculated: true
  expression: "amount * 1.1"
```

#### Relationship columns

A relationship column declares a join path to another model:

```yaml
- name: customer
  type: customers           # the related model name
  relationship: orders_customers
```

Then `orders.customer.first_name` is valid SQL — the engine resolves the join automatically.

#### Column rename via `expression`

When `is_calculated` is `false` but an `expression` is present, the expression must be a simple column reference. The engine resolves the physical column name from the expression and uses the model column name as the alias:

```yaml
- name: customer_id        # exposed name
  type: INTEGER
  expression: usr_id        # physical column name
```

### Selective exposure for column-level access control

A model does not have to expose every column in the underlying table. Omitted columns are physically invisible to clients — no SQL can reference them, and they do not appear in schema introspection.

This matters for AI agents: any column you omit from the model cannot be retrieved through Wren AI, regardless of what the agent asks.

## Relationships (`relationships.yml`)

```yaml
relationships:
  - name: orders_customers
    models:
      - orders
      - customers
    join_type: MANY_TO_ONE
    condition: orders.customer_id = customers.customer_id
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Unique relationship identifier. |
| `models` | array[string] | yes | Exactly two model names `[from, to]`. |
| `join_type` | enum | yes | `ONE_TO_ONE`, `ONE_TO_MANY`, `MANY_TO_ONE`, or `MANY_TO_MANY`. |
| `condition` | string | yes | SQL equality condition using `model.column` references on both sides. |

The first model in `models` should appear on the left side of the condition. Only equality conditions are supported.

For `TO_MANY` relationships, calculated columns that traverse the relationship must use aggregate functions — the engine wraps the join in an aggregate subquery to prevent row multiplication.

## Views (`views/<name>/metadata.yml`)

```yaml
name: top_customers
statement: |
  SELECT customer_id, SUM(total) AS lifetime_value
  FROM wren.public.orders
  GROUP BY 1
  ORDER BY 2 DESC
  LIMIT 100
properties:
  description: "Top customers by lifetime value"
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Unique view name. |
| `statement` | string | yes | Complete SQL SELECT. May reference other models or views. |
| `dialect` | string | no | SQL dialect (metadata only — engine parses with its generic parser). Requires `schema_version: 3`. |
| `properties` | no | Arbitrary metadata. |

The statement can live inline or in a sibling `sql.yml` file. The `sql.yml` takes precedence.

Views inherit no column declarations — schema is inferred from the statement at query time. Views can reference other views; the engine expands them recursively before resolving models.

## Cubes (`cubes/<name>/metadata.yml`)

A cube is a pre-aggregated semantic object: a base model or view, plus declared measures, dimensions, time dimensions, and hierarchies.

```yaml
name: revenue
base_object: orders
measures:
  - name: total
    expression: SUM(amount)
    type: DOUBLE
  - name: order_count
    expression: COUNT(*)
    type: BIGINT
dimensions:
  - name: status
    expression: status
    type: VARCHAR
time_dimensions:
  - name: month
    expression: order_date
    grain: month
    type: DATE
hierarchies:
  - name: time
    levels: [year, quarter, month]
```

| Field | Required | Description |
|---|---|---|
| `name` | yes | Unique cube name. |
| `base_object` | yes | Model or view this cube aggregates over. |
| `measures[]` | yes | Aggregated values (`expression` + `type`). |
| `dimensions[]` | no | Categorical group-bys. |
| `time_dimensions[]` | no | Time-based group-bys with explicit grain. |
| `hierarchies[]` | no | Ordered levels for drill-down (year → quarter → month). |
| `refresh_time` | no | Cache refresh interval. |
| `properties` | no | Arbitrary metadata. |

Cubes are queried structurally via `wren cube query`, not by writing raw `GROUP BY` SQL. See [Pre-aggregate with cubes](/oss/guides/cubes) for the agent-facing recipe.

## Instructions (`instructions.md`)

Free-form markdown with business and operational guidance for AI agents. Organized by topic with `##` headings — each heading and its body becomes a retrievable chunk in memory.

```markdown
## Business rules
- Revenue queries must use `net_revenue`, not `gross_revenue`.
- All active-customer queries exclude rows where `is_internal = true`.

## Canonical tables
- Use `customers` for analytics, not `customers_v3` or `loyalty_v3`.

## Formatting
- Currency is USD; display with thousand separators and 2 decimals.
- Timestamps are stored in UTC.
```

Instructions are consumed by agents, not by the engine. They are intentionally excluded from `target/mdl.json`. Agents access them via:

- `wren context instructions` — full text, run once at session start
- `wren memory fetch -q "..."` — relevant chunks per query

## `queries.yml` (optional)

Curated natural-language-to-SQL pairs that seed memory. Same format as `wren memory dump` output:

```yaml
version: 1
pairs:
  - nl: "monthly revenue by product category"
    sql: |
      SELECT category, DATE_TRUNC('month', order_date) AS month, SUM(amount)
      FROM orders
      GROUP BY 1, 2
    source: user
    datasource: postgres-prod
```

`wren memory index` auto-loads `queries.yml` after indexing the schema. Pairs added through `wren memory store` can be exported back to `queries.yml` with `wren memory dump`.

## Snake_case to camelCase mapping

`wren context build` converts YAML field names to camelCase in `target/mdl.json`:

| YAML | JSON |
|---|---|
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

`layoutVersion` is stamped automatically by `wren context build` based on the project's `schema_version` — you do not set it manually in YAML.

## Dialect override

Models and views support an optional `dialect` field declaring which SQL dialect their embedded SQL is written in. Requires `schema_version: 3`.

| Setting | Behavior |
|---|---|
| `dialect` omitted | Falls back to project-level `data_source`. Default. |
| `dialect` set | Engine uses the named dialect parser for this object's SQL. |

Valid dialect values: `athena`, `bigquery`, `canner`, `clickhouse`, `databricks`, `datafusion`, `doris`, `duckdb`, `gcs_file`, `local_file`, `minio_file`, `mssql`, `mysql`, `oracle`, `postgres`, `redshift`, `s3_file`, `snowflake`, `spark`, `trino`.

### Schema version vs layout version

| `schema_version` | `layoutVersion` | Capabilities |
|---|---|---|
| 1 | 1 | Legacy flat-file project format. |
| 2 | 1 | Folder-per-entity project format. |
| 3 | 2 | Adds the `dialect` field on models and views. |

Use `wren context upgrade` to bump. The upgrade is dry-runnable with `--dry-run`.

## Recommended `.gitignore`

```text
target/
.wren/memory/
```

Source YAML and `instructions.md` are committed. `target/mdl.json` is derived; `.wren/memory/` is binary LanceDB data — share confirmed NL-SQL pairs through `queries.yml` instead.

## See also

- [Manage project](/oss/guides/manage_project) — lifecycle commands, profile binding, multi-env workflow
- [CLI reference](./cli.md) — every `wren` command
- [Operational reference](./operational.md) — all paths, env vars, and discovery rules
- [What does MDL do for the agent?](/oss/concepts/what_is_mdl) — the conceptual framing
