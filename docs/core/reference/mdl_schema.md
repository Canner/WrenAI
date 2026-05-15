# MDL schema reference

This page documents every field accepted in MDL (Modeling Definition Language) files. MDL is the YAML the `wren` CLI reads to describe your data — models, columns, relationships, views, and calculated fields.

> **Tip:** This is a reference page. For the concept and motivation behind MDL, see [What is MDL](/oss/concepts/what_is_mdl). For step-by-step guides, see the [Modeling guides](/oss/guides/modeling/overview).

---

## Project file (`wren_project.yml`)

The project file is the root of an MDL project. It binds the project to a profile and defines the namespace.

```yaml
name: my_project              # required — project identifier
catalog: wren                 # default: 'wren' — Wren namespace, not your DB catalog
schema: public                # default: 'public' — Wren namespace, not your DB schema
profile: jaffle-shop          # bound profile (set via `wren context set-profile`)
data_source: duckdb           # bound data source type
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Project identifier (used in CLI output). |
| `catalog` | string | no | Wren namespace catalog. Defaults to `wren`. **Not** your database catalog. |
| `schema` | string | no | Wren namespace schema. Defaults to `public`. **Not** your database schema. |
| `profile` | string | no | The profile this project is bound to. Set via `wren context set-profile <name>`. |
| `data_source` | string | no | The data source type (`duckdb`, `postgres`, `bigquery`, etc.). Set by `set-profile`. |

---

## Model file (`models/<name>/metadata.yml`)

Each model is a folder under `models/` with a `metadata.yml`. The model maps a Wren-namespace name to a table or query result in your data source.

```yaml
name: customers
table_reference:
  database: main
  schema: main
  table: customers

properties:
  description: One row per customer.

columns:
  - name: customer_id
    type: bigint
    not_null: true
    properties:
      description: Stable customer identifier.
  - name: email
    type: varchar
    properties:
      description: Primary contact email. Null for B2B accounts.
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Model name within the Wren namespace. |
| `table_reference` | object | yes | Where the underlying data lives in the source (see below). |
| `properties.description` | string | no | Free-form description used for memory retrieval. |
| `columns[]` | array | yes | One entry per exposed column. |

### `table_reference`

| Field | Type | Required |
|---|---|---|
| `database` | string | yes (most sources) |
| `schema` | string | yes (most sources) |
| `table` | string | yes |

### `columns[]`

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Column name as exposed by Wren. |
| `type` | string | yes | Normalized Wren type — `bigint`, `varchar`, `timestamp`, `boolean`, `double`, `date`, `json`. |
| `not_null` | boolean | no | Whether the column is non-nullable. |
| `properties.description` | string | no | Description used for memory retrieval. |
| `expression` | string | no | SQL expression — makes this a calculated column instead of a direct mapping. |

---

## Relationships (`relationships.yml`)

```yaml
- name: orders_to_customers
  type: many_to_one
  models:
    - orders
    - customers
  condition: orders.customer_id = customers.customer_id
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Relationship identifier. |
| `type` | enum | yes | `one_to_one`, `one_to_many`, `many_to_one`, or `many_to_many`. |
| `models` | array[string] | yes | The two model names participating in the join. |
| `condition` | string | yes | SQL join condition. |

---

## Views (`views/<name>.yml`)

```yaml
name: active_customers_last_90d
statement: |
  SELECT customer_id, count(*) AS order_count
  FROM orders
  WHERE order_date >= current_date - interval '90 days'
  GROUP BY 1
properties:
  description: Customers with at least one order in the last 90 days.
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | View name within the Wren namespace. |
| `statement` | string | yes | SQL that returns the view's rows. Can reference other models. |
| `properties.description` | string | no | Description used for memory retrieval. |

---

## Instructions (`instructions.md`)

`instructions.md` is plain markdown. Wren indexes it into memory for retrieval. Use `##` headings to group rules; each heading and its body becomes a retrievable chunk.

```markdown
## Naming conventions
- "revenue" means order total, not supply cost.
- "active customer" means at least one order in the last 90 days.

## Canonical tables
- For customer data, always use the `customers` model, not the legacy `customer_v2` table.
```

---

## See also

- [Wren project guide](/oss/guides/modeling/wren_project)
- [Models](/oss/guides/modeling/model) · [Relations](/oss/guides/modeling/relation) · [Views](/oss/guides/modeling/view)
- [Memory system concept](/oss/concepts/memory_system)
