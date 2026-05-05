# Relationship

A **Relationship** defines a join path between two models. Once declared, the engine resolves the join automatically whenever a query traverses a relationship column — no explicit `JOIN` syntax required.

## Structure

```yaml
# relationships.yml
relationships:
  - name: orders_customers
    models:
      - orders
      - customers
    join_type: MANY_TO_ONE
    condition: orders.customer_id = customers.customer_id
```

### JSON format (MDL manifest)

```json
{
  "name": "orders_customers",
  "models": ["orders", "customers"],
  "joinType": "MANY_TO_ONE",
  "condition": "orders.customer_id = customers.customer_id"
}
```

## Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier referenced by relationship columns |
| `models` | Yes | Exactly two model names: `[from_model, to_model]` |
| `join_type` | Yes | Cardinality of the join (see below) |
| `condition` | Yes | SQL equality expression linking the two models |

## Join Types

| Value | Meaning |
|-------|---------|
| `ONE_TO_ONE` | Each row in the left model matches at most one row in the right model |
| `ONE_TO_MANY` | One row in the left model matches many rows in the right model |
| `MANY_TO_ONE` | Many rows in the left model match one row in the right model |
| `MANY_TO_MANY` | Many rows on both sides |

The join type affects how the engine handles aggregation in calculated columns that traverse the relationship. For `TO_ONE` joins (`ONE_TO_ONE`, `MANY_TO_ONE`), the engine uses a simple join. For `TO_MANY` joins, the engine wraps the traversal in an aggregate subquery to avoid row multiplication.

## The `condition` Field

The condition is an equality expression using fully-qualified `model.column` references:

```yaml
condition: orders.customer_id = customers.customer_id
```

- Always use `model_name.column_name` on both sides
- Only equality conditions are supported
- The first model in `models` should appear on the left side of the condition

## jaffle_shop Example

The jaffle_shop workspace defines five relationships across its three model layers:

```yaml
relationships:
  # mart layer
  - name: orders_customers
    models: [orders, customers]
    join_type: MANY_TO_ONE
    condition: orders.customer_id = customers.customer_id

  # raw layer
  - name: raw_orders_raw_customers
    models: [raw_orders, raw_customers]
    join_type: MANY_TO_ONE
    condition: raw_orders.user_id = raw_customers.id

  - name: raw_payments_raw_orders
    models: [raw_payments, raw_orders]
    join_type: MANY_TO_ONE
    condition: raw_payments.order_id = raw_orders.id

  # staging layer
  - name: stg_orders_stg_customers
    models: [stg_orders, stg_customers]
    join_type: MANY_TO_ONE
    condition: stg_orders.customer_id = stg_customers.customer_id

  - name: stg_payments_stg_orders
    models: [stg_payments, stg_orders]
    join_type: MANY_TO_ONE
    condition: stg_payments.order_id = stg_orders.order_id
```

## Using Relationships in Queries

### Implicit join via relationship column

Declare a relationship column in a model to expose a join path:

```yaml
# orders model — add a relationship column pointing to customers
columns:
  - name: customer
    type: customers
    relationship: orders_customers
```

Then query across models without writing a JOIN:

```sql
-- Wren expands the join automatically
SELECT order_id, customer.first_name, customer.last_name, amount
FROM orders
WHERE customer.number_of_orders > 3
ORDER BY amount DESC;
```

The engine resolves `customer.*` by expanding the `orders_customers` join, pushing it only as far as the referenced columns require.

### Calculated columns that traverse relationships

Relationship columns can be referenced inside `is_calculated` expressions:

```yaml
- name: customer_name
  type: VARCHAR
  is_calculated: true
  expression: "customer.first_name || ' ' || customer.last_name"
  relationship: orders_customers
```

For `TO_MANY` relationships, aggregate functions are required to avoid row multiplication:

```yaml
# In the customers model — count orders per customer
- name: order_count
  type: BIGINT
  is_calculated: true
  expression: "count(orders.order_id)"
  relationship: orders_customers
```

The engine detects the aggregate and automatically wraps the join in a subquery.

## Engine Internals

### Relationship resolution pipeline

When the query planner encounters a column reference like `orders.customer.first_name`:

1. **`ExpandWrenViewRule`** runs first to inline any view definitions
2. **`ModelAnalyzeRule`** identifies the `customer` column as a relationship column pointing to `orders_customers`
3. **`relation_chain`** resolves the join path, building a `LEFT JOIN customers ON orders.customer_id = customers.customer_id`
4. The join is pushed only as far as the referenced columns require — unreferenced relationship columns do not produce joins

### `TO_MANY` and aggregate subqueries

The `primary_key` of the base model is required when the relationship is `TO_MANY`. The engine wraps the join in an aggregate subquery keyed on the primary key to prevent row multiplication:

```sql
-- expression: count(orders.order_id) on customers model
SELECT
  customers.customer_id,
  (SELECT count(orders.order_id)
   FROM orders
   WHERE orders.customer_id = customers.customer_id) AS order_count
FROM customers
```

If `primary_key` is not declared on the base model, the engine returns an error when a `TO_MANY` calculated column is used.
