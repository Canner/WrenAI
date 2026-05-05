# Model

A **Model** is the core building block of Wren MDL. It maps a physical table (or a SQL expression) to a named semantic entity that AI agents and SQL clients query by name. Models define which columns are exposed and how columns relate to other models.

## Defining a Model

Every model requires three things:

1. A **name** — the identifier used in queries (`SELECT * FROM customers`)
2. A **data source** — where the data lives (`table_reference` or `ref_sql`)
3. **Columns** — the fields that are exposed

### YAML format (wren project)

Each model lives in its own directory under `models/` as `models/<name>/metadata.yml`.

```yaml
# models/customers/metadata.yml
name: customers
table_reference:
  catalog: jaffle_shop
  schema: main
  table: customers
primary_key: customer_id
columns:
  - name: customer_id
    type: INTEGER
    is_calculated: false
    not_null: true
    is_primary_key: true
    properties: {}
  - name: first_name
    type: VARCHAR
    is_calculated: false
    not_null: false
    properties: {}
  - name: last_name
    type: VARCHAR
    is_calculated: false
    not_null: false
    properties: {}
  - name: number_of_orders
    type: BIGINT
    is_calculated: false
    not_null: false
    properties: {}
  - name: customer_lifetime_value
    type: DOUBLE
    is_calculated: false
    not_null: false
    properties: {}
cached: false
properties: {}
```

### JSON format (MDL manifest)

```json
{
  "name": "customers",
  "tableReference": {
    "catalog": "jaffle_shop",
    "schema": "main",
    "table": "customers"
  },
  "primaryKey": "customer_id",
  "columns": [
    { "name": "customer_id", "type": "INTEGER", "isPrimaryKey": true, "isCalculated": false },
    { "name": "first_name",  "type": "VARCHAR", "isCalculated": false },
    { "name": "last_name",   "type": "VARCHAR", "isCalculated": false },
    { "name": "number_of_orders", "type": "BIGINT", "isCalculated": false },
    { "name": "customer_lifetime_value", "type": "DOUBLE", "isCalculated": false }
  ]
}
```

## Model Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier used in SQL queries |
| `table_reference` | One of two | Points to an existing physical table (`catalog.schema.table`) |
| `ref_sql` | One of two | A SQL SELECT statement used as the model's data source |
| `columns` | Yes | List of columns to expose (see [Column Fields](#column-fields)) |
| `primary_key` | No | Column name that uniquely identifies a row; required for relationships |
| `cached` | No | Whether query results for this model should be cached; `false` by default |
| `dialect` | No | SQL dialect of the model's `ref_sql` (e.g. `bigquery`, `postgres`). Overrides the project-level `data_source` for this model. Requires `schema_version: 3`. See [Dialect Override](./wren_project.md#dialect-override). |
| `properties` | No | Arbitrary key-value metadata (description, tags, etc.) |

## Data Source: Two Ways to Point at Data

A model must define its source in exactly one of two ways. Using both `table_reference` and `ref_sql` in the same model is a validation error.

### 1. `table_reference` — map to a physical table

Used when the underlying table already exists in the database.

| Field | Description |
|-------|-------------|
| `catalog` | Database catalog. Empty string if not applicable. For DuckDB, use the DB file name without extension (e.g. `jaffle_shop.duckdb` → `jaffle_shop`). |
| `schema` | Database schema (e.g. `public`, `main`). |
| `table` | Physical table name. |

**jaffle_shop example** — the `orders` model maps directly to `jaffle_shop.main.orders`:

```yaml
name: orders
table_reference:
  catalog: jaffle_shop
  schema: main
  table: orders
```

When a query like `SELECT * FROM orders` is executed, Wren rewrites it to the fully-qualified physical table.

### 2. `ref_sql` — define the model with SQL

Used when the model is derived — for example, a staging transform or a complex join that doesn't exist as a physical table.

The SQL can be inline in `metadata.yml` or in a separate `ref_sql.sql` file. The `.sql` file takes precedence if both exist.

**Inline in metadata.yml:**

```yaml
name: revenue_summary
ref_sql: >
  SELECT DATE_TRUNC('month', order_date) AS month,
         SUM(total) AS total_revenue
  FROM orders
  GROUP BY 1
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

**Separate SQL file:**

```yaml
# models/revenue_summary/metadata.yml
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

## Column Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Column name used in SQL |
| `type` | Yes | SQL data type (`VARCHAR`, `INTEGER`, `DOUBLE`, `DATE`, `TIMESTAMP`, etc.) |
| `is_calculated` | No | If `true`, the column value is derived from `expression` at query time |
| `expression` | No | SQL expression for calculated columns |
| `relationship` | No | Name of a [Relationship](./relation.md) — makes this column a join handle |
| `not_null` | No | Constraint hint; `false` by default |
| `is_primary_key` | No | Marks the column as the model's primary key |
| `is_hidden` | No | Engine-internal flag; column is excluded from the symbol table and invisible to all clients |
| `properties` | No | Arbitrary metadata |

### Regular columns

A regular column maps to a field in the underlying table. These are called **source columns** — the engine registers them in the physical schema so DataFusion can read them directly.

By default, the model column name is used as the physical field name. If the physical column has a different name, use `expression` to declare a simple rename:

```yaml
- name: order_date        # model name (exposed to clients)
  type: DATE
  is_calculated: false

- name: customer_id       # renamed from the physical column "usr_id"
  type: INTEGER
  is_calculated: false
  expression: usr_id
```

The `expression` on a non-calculated column must be a single column reference — it cannot contain operators or function calls. See [Engine Internals](#engine-internals) for the full resolution rules.

### Calculated columns

A calculated column is computed from a SQL expression at query time. Wren inlines the expression into the generated SQL.

```yaml
- name: is_large_order
  type: BOOLEAN
  is_calculated: true
  expression: "amount > 100"
```

Calculated columns can reference other columns in the same model or traverse relationships:

```yaml
- name: customer_name
  type: VARCHAR
  is_calculated: true
  expression: "customers.first_name || ' ' || customers.last_name"
  relationship: orders_customers
```

### Relationship columns

A relationship column declares a join path to another model. The `relationship` field names a [Relationship](./relation.md) defined elsewhere in the MDL.

```yaml
# In the orders model
- name: customer
  type: customers     # the related model name
  relationship: orders_customers
```

This makes `orders.customer.first_name` valid SQL — Wren resolves the join automatically.

## jaffle_shop Example

The jaffle_shop dataset has three layers of models that illustrate the full range of modeling patterns:

```
raw_orders ──► stg_orders ──► orders
raw_customers ──► stg_customers ──► customers
raw_payments ──► stg_payments
```

### Raw layer — `table_reference`

Raw models point directly at source tables with minimal transformation:

```yaml
name: raw_orders
table_reference:
  catalog: jaffle_shop
  schema: main
  table: raw_orders
primary_key: id
columns:
  - { name: id,         type: INTEGER, is_primary_key: true }
  - { name: user_id,    type: INTEGER }
  - { name: order_date, type: DATE }
  - { name: status,     type: VARCHAR }
```

### Staging layer — renamed and typed

Staging models clean column names and enforce types. They use `ref_sql` or point at staging tables:

```yaml
name: stg_orders
table_reference:
  catalog: jaffle_shop
  schema: main
  table: stg_orders
primary_key: order_id
columns:
  - { name: order_id,   type: INTEGER, is_primary_key: true }
  - { name: customer_id, type: INTEGER }
  - { name: order_date, type: DATE }
  - { name: status,     type: VARCHAR }
```

### Mart layer — enriched with metrics

Mart models expose business-ready fields, including pre-aggregated metrics:

```yaml
name: customers
table_reference:
  catalog: jaffle_shop
  schema: main
  table: customers
primary_key: customer_id
columns:
  - { name: customer_id,             type: INTEGER, is_primary_key: true }
  - { name: first_name,              type: VARCHAR }
  - { name: last_name,               type: VARCHAR }
  - { name: first_order,             type: DATE }
  - { name: most_recent_order,       type: DATE }
  - { name: number_of_orders,        type: BIGINT }
  - { name: customer_lifetime_value, type: DOUBLE }
```

### Cross-model relationships

The `orders_customers` relationship (defined in `relationships.yml`) links `orders.customer_id → customers.customer_id`. With this in place, you can query across models without writing any JOIN:

```sql
-- Wren resolves the join automatically
SELECT
  order_id,
  orders.customer.first_name,
  orders.customer.last_name,
  amount
FROM orders
WHERE orders.customer.number_of_orders > 3
```

See [Relationship](./relation.md) for full details on defining join paths.

## Using Models in SQL

Once defined, models are first-class SQL table names:

```sql
SELECT * FROM customers;

SELECT o.order_id, o.amount, c.first_name
FROM orders o
JOIN customers c ON o.customer_id = c.customer_id;

-- Or let Wren handle the join via a relationship column:
SELECT order_id, customer.first_name, amount
FROM orders;
```

Wren translates these queries to the appropriate dialect SQL for the connected data source before execution.

## Column-Level Access Control via Selective Exposure

A model does not have to expose every column in the underlying table. By explicitly listing only the columns a client should see, you create a hard boundary at the semantic layer — columns that are not declared in the model simply do not exist from the client's perspective.

This is especially valuable in the AI era. When an AI agent (Claude, Cursor, Cline, etc.) connects through Wren MCP, it can only discover and query the columns that are declared in the model. Sensitive fields that are omitted from the model are physically invisible to the agent — no prompt injection or accidental exposure can retrieve them.

### Example: hiding PII from AI agents

Suppose the physical `customers` table contains PII columns that should never reach an AI agent:

| Physical column | Expose to AI? |
|-----------------|--------------|
| `customer_id` | Yes |
| `first_name` | Yes |
| `last_name` | Yes |
| `email` | **No** |
| `phone_number` | **No** |
| `date_of_birth` | **No** |
| `number_of_orders` | Yes |
| `customer_lifetime_value` | Yes |

Define the model with only the safe columns:

```yaml
name: customers
table_reference:
  catalog: jaffle_shop
  schema: main
  table: customers
primary_key: customer_id
columns:
  - { name: customer_id,             type: INTEGER, is_primary_key: true }
  - { name: first_name,              type: VARCHAR }
  - { name: last_name,               type: VARCHAR }
  - { name: number_of_orders,        type: BIGINT }
  - { name: customer_lifetime_value, type: DOUBLE }
```

The AI agent sees a `customers` model with five columns. `email`, `phone_number`, and `date_of_birth` do not appear in schema introspection, cannot be referenced in SQL, and are never included in query results — regardless of what the agent asks.

### Summary

| Technique | Column reachable via SQL | Visible in schema |
|-----------|--------------------------|-------------------|
| Declared column | Yes | Yes |
| Omitted from model | **No** | **No** |

Use **omission** to enforce hard boundaries for AI agents.

## Engine Internals

### Physical schema registration (`infer_and_register_remote_table`)

When the engine initialises a model, it builds an Arrow schema that represents the physical table as DataFusion sees it. Only **source columns** — columns that map directly to a field in the underlying table — are registered in this schema. The engine uses `infer_source_column` to decide whether each column qualifies, following these rules in order:

| Column configuration | Source column? | Physical field name |
|----------------------|---------------|---------------------|
| `is_calculated: true` | No | — computed at query time from `expression` |
| has `relationship` | No | — resolved as a join at query time |
| no `expression` | **Yes** | same as `name` |
| `expression` is a simple column reference | **Yes** | inferred from the expression (supports rename) |
| `expression` is a complex SQL expression | No | — cannot be resolved statically |
| `is_hidden: true` | **excluded** | stripped from the symbol table before this step |

### `is_hidden` — engine-internal columns

`is_hidden: true` is an engine-internal flag. The engine strips hidden columns from its symbol table during MDL initialisation (`get_visible_columns`), so they never appear in schema introspection, lineage analysis, or access-control checks. They are invisible to every client — AI agents, SQL clients, and the metadata API alike.

This is used for columns the engine generates internally (e.g. join keys added automatically for relationship resolution) that should not be addressable by user queries.

### `expression` on a non-calculated column — column rename

When `is_calculated` is `false` but an `expression` is present, the expression must be a **simple column reference**. The engine uses it to resolve which physical column to read and registers the model column name as an alias.

```yaml
# Physical table has column "usr_id"; expose it as "customer_id" in the model
- name: customer_id
  type: INTEGER
  is_calculated: false
  expression: usr_id
```

At query time `SELECT customer_id FROM stg_orders` becomes `SELECT usr_id AS customer_id FROM ...` in the generated SQL.

If the expression is **compound** (`table.column`), the engine takes the last identifier as the physical column name:

```yaml
- name: customer_id
  type: INTEGER
  is_calculated: false
  expression: raw_orders.user_id   # physical name resolved as "user_id"
```

If the expression cannot be reduced to a single identifier (e.g. `amount * 1.1`), the column is not registered as a source column — it must use `is_calculated: true` instead.

### `is_calculated` + `expression` — computed column

A calculated column is **never** registered as a source column. The engine inlines the `expression` SQL directly into the generated query at plan time:

```yaml
- name: total_with_tax
  type: DOUBLE
  is_calculated: true
  expression: "amount * 1.1"
```

Generated SQL: `SELECT amount * 1.1 AS total_with_tax FROM orders`

Calculated columns can also traverse relationship joins:

```yaml
- name: customer_name
  type: VARCHAR
  is_calculated: true
  expression: "customers.first_name || ' ' || customers.last_name"
  relationship: orders_customers
```

The engine resolves `customers.*` references by expanding the `orders_customers` join automatically.

### Summary

```
Column definition
│
├── is_hidden: true       → stripped from symbol table; invisible to all clients
│
├── is_calculated: true   → inlined as SQL expression at query time
│   └── relationship      → join is expanded before inlining
│
├── no expression         → direct physical column (name = physical name)
│
└── expression (simple)   → rename: physical name from expression, model name as alias
    expression (complex)  → must use is_calculated: true
```
