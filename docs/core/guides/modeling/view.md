# View

A **View** is a named SQL query stored in the MDL. It behaves like a virtual table — clients can query it by name, and the engine inlines the `statement` SQL before execution. Unlike a Model, a View does not declare columns explicitly; its schema is inferred from the `statement` at query time.

## Structure

Each view lives in its own directory under `views/` as `views/<name>/metadata.yml`.

The `statement` SQL can be inline in `metadata.yml` or in a separate `sql.yml` file. The `sql.yml` file takes precedence if both exist.

**Inline statement:**

```yaml
# views/top_customers/metadata.yml
name: top_customers
statement: >
  SELECT customer_id, SUM(total) AS lifetime_value
  FROM wren.public.orders GROUP BY 1 ORDER BY 2 DESC LIMIT 100
properties:
  description: "Top customers by lifetime value"
```

**Separate SQL file:**

```yaml
# views/monthly_revenue/metadata.yml
name: monthly_revenue
properties:
  description: "Monthly revenue aggregation"
```

```yaml
# views/monthly_revenue/sql.yml
statement: >
  SELECT DATE_TRUNC('month', order_date) AS month,
         SUM(total) AS total_revenue
  FROM wren.public.orders
  GROUP BY 1
```

### JSON format (MDL manifest)

```json
{
  "name": "top_customers",
  "statement": "SELECT customer_id, SUM(total) AS lifetime_value FROM wren.public.orders GROUP BY 1 ORDER BY 2 DESC LIMIT 100"
}
```

## Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier used in SQL queries |
| `statement` | Yes | A complete SQL SELECT statement; may reference other models or views |
| `dialect` | No | SQL dialect of the view's `statement` (e.g. `bigquery`, `postgres`). Currently metadata only — the engine always parses view statements with its generic SQL parser. Requires `schema_version: 3`. See [Dialect Override](./wren_project.md#dialect-override). |
| `properties` | No | Arbitrary key-value metadata (use `properties.description` for a human-readable description) |

## Model vs View

| | Model | View |
|-|-------|------|
| Data source | `table_reference` or `ref_sql` | SQL `statement` |
| Column declarations | Explicit (with types) | Inferred from `statement` |
| Relationship columns | Supported | Not supported |
| Calculated columns | Supported | Not supported |
| Primary key | Supported | Not applicable |
| Access control | Column omission, RLAC/CLAC | Column omission via `statement` |

Use a **Model** when you need typed columns, relationships, or calculated fields. Use a **View** for pre-built queries — dashboards, saved filters, or cross-model aggregations — that you want to expose as a named table.

## jaffle_shop Example

The jaffle_shop workspace ships with an empty `views.yml` (`views: []`), but views become useful once you have mart-layer models in place. Here are representative examples:

### Simple filter view

```yaml
# views/completed_orders/metadata.yml
name: completed_orders
statement: >
  SELECT order_id, customer_id, order_date, amount
  FROM orders
  WHERE status = 'completed'
properties:
  description: "Orders with completed status"
```

```sql
SELECT * FROM completed_orders WHERE amount > 50;
```

### Cross-model aggregation view

```yaml
# views/customer_order_summary/metadata.yml
name: customer_order_summary
statement: >
  SELECT
    c.customer_id,
    c.first_name,
    c.last_name,
    COUNT(o.order_id)  AS total_orders,
    SUM(o.amount)      AS lifetime_value
  FROM customers c
  JOIN orders o ON c.customer_id = o.customer_id
  GROUP BY c.customer_id, c.first_name, c.last_name
properties:
  description: "Per-customer order counts and lifetime value"
```

The `statement` references `customers` and `orders` by their model names. The engine resolves them through the normal model pipeline after expanding the view.

### View referencing another view

```yaml
# views/vip_customers/metadata.yml
name: vip_customers
statement: >
  SELECT customer_id, first_name, last_name, lifetime_value
  FROM customer_order_summary
  WHERE lifetime_value > 500
properties:
  description: "Customers with lifetime value over 500"
```

Views can reference other views. The engine expands all view references recursively before resolving model references.

## Querying a View

Once defined, a view is a first-class table name:

```sql
SELECT * FROM completed_orders;

SELECT customer_id, total_orders
FROM customer_order_summary
ORDER BY total_orders DESC
LIMIT 10;
```

The view name can be qualified with catalog and schema:

```sql
SELECT * FROM wren.main.completed_orders;
```

## Engine Internals

### Session registration

At session initialisation, each view's `statement` is parsed into a DataFusion `LogicalPlan` and wrapped in a `ViewTable`. The `ViewTable` is registered under the view's fully-qualified name (`catalog.schema.name`) in the DataFusion catalog.

```
view.statement  →  ctx.state().create_logical_plan()
               →  ViewTable::new(plan, statement)
               →  ctx.register_table(catalog.schema.name, view_table)
```

### Query-time expansion: `ExpandWrenViewRule`

`ExpandWrenViewRule` runs as the **first** analyzer pass — before `ModelAnalyzeRule` and all other rules. It performs a bottom-up walk of the logical plan tree. Whenever it encounters a `TableScan` whose name belongs to the MDL and matches a registered view, it replaces the scan node with the view's `LogicalPlan` wrapped in a subquery alias:

```
TableScan("completed_orders")
  ↓ ExpandWrenViewRule
Subquery(
  Filter(status = 'completed', TableScan("orders")),
  alias = "completed_orders"
)
```

After the view is inlined, the remaining `TableScan("orders")` nodes are processed by `ModelAnalyzeRule` in the next pass, which resolves them to physical tables.

This ordering ensures that a view's `statement` can freely reference other models or views — all references are resolved in subsequent passes after expansion.

### Recursive view expansion

If a view references another view, `ExpandWrenViewRule` handles the recursion automatically. The `transform_up_with_subqueries` traversal processes the tree from leaves to root, so inner views are expanded before outer views reference them.
