# Wren SQL — How CTE-Based Modeling Works

Wren Engine rewrites your SQL by injecting CTEs (Common Table Expressions) that expand each MDL model into its underlying database query. Understanding this mechanism helps you diagnose errors and write correct SQL.

---

## The rewrite pipeline

```
Your SQL (target dialect, e.g. Postgres)
  → parse & qualify all column references (sqlglot)
  → identify which models and columns are referenced
  → per model: wren-core expands the model definition → CTE
  → inject model CTEs into your query
  → output final SQL in target dialect
```

**Example:** Given an MDL with model `orders` backed by table `public.orders` with columns `o_orderkey`, `o_custkey`, `o_totalprice`:

```sql
-- You write:
SELECT o_custkey, SUM(o_totalprice) FROM orders GROUP BY 1

-- Engine produces (via dry-plan):
WITH "orders" AS (
  SELECT "public"."orders"."o_orderkey",
         "public"."orders"."o_custkey",
         "public"."orders"."o_totalprice"
  FROM "public"."orders"
)
SELECT o_custkey, SUM(o_totalprice) FROM orders GROUP BY 1
```

The CTE named `"orders"` shadows the model name, so the rest of your SQL runs against the CTE as if it were a table.

---

## What the rewriter handles

| Feature | Supported |
|---------|-----------|
| `SELECT *` from a model | Yes — expands to all non-hidden, non-relationship columns |
| JOINs between models | Yes — each model gets its own CTE |
| Subqueries referencing models | Yes — outer column references are resolved |
| Table aliases (`FROM orders o`) | Yes — alias tracking maps back to models |
| User-defined CTEs (`WITH x AS (...)`) | Yes — model CTEs are prepended before user CTEs |
| `RECURSIVE` WITH clauses | Yes — preserved |
| Calculated fields / metrics | Yes — wren-core expands them inside the model CTE |
| `COUNT(*)` without columns | Yes — model CTE selects `1` (only needs rows) |

---

## SQL rules for writing queries

1. **Use model names, not database table names** — write `FROM orders`, not `FROM public.orders`
2. **Write dialect-neutral SQL** — the engine translates to the target database dialect
3. **Column names must match the MDL** — use the names defined in `mdl.json`, not the underlying database column names
4. **Hidden columns are excluded** — columns with `"isHidden": true` are not available in `SELECT *`
5. **Relationship columns are excluded** — relationship fields don't appear as selectable columns; use JOINs instead

---

## Diagnosing errors with dry-plan

`dry-plan` shows the expanded SQL without executing it. This separates MDL-level issues from database-level issues.

### Step 1 — Run dry-plan

```bash
wren dry-plan --sql "SELECT o_custkey, SUM(o_totalprice) FROM orders GROUP BY 1"
```

### Step 2 — Interpret the result

| dry-plan result | Meaning | Fix |
|-----------------|---------|-----|
| **Succeeds** with valid SQL | MDL layer is fine; if execution fails, the database rejects the translated SQL | Read the DB error against the dry-plan output — the issue is in the generated SQL or DB state |
| **Fails** with "No model references found" | Your FROM clause doesn't match any MDL model name | Check model names: `wren memory fetch -q "<name>" --type model --threshold 0` |
| **Fails** with column error | A column you referenced doesn't exist in the model | Check columns: `wren memory fetch -q "<col>" --model <name> --threshold 0` |
| **Fails** with qualify error | sqlglot can't resolve an ambiguous or unknown column | Qualify the column explicitly: `model_name.column_name` |

### Step 3 — Compare dry-plan output with DB error

When execution fails but dry-plan succeeds, compare them side by side:

```bash
# Get the expanded SQL
wren dry-plan --sql "SELECT ..." 2>&1

# Run against DB and capture the error
wren --sql "SELECT ..." 2>&1
```

Common patterns:
- **Type mismatch**: The CTE exposes the raw column type; a function may not accept it in the target dialect
- **Missing table**: The underlying table referenced in the model definition doesn't exist in the database
- **Permission denied**: The DB user lacks access to the underlying tables
- **Syntax difference**: Rare — usually means a sqlglot dialect translation gap

---

## Fallback behavior

If the rewriter detects no model references in your SQL (e.g. `SELECT 1` or queries against raw database tables), it falls back to passing the entire query through wren-core's `transform_sql()` directly. This means:

- Queries that don't reference any MDL model still work
- The fallback path does NOT use CTE injection — it transforms the whole query at once
- If you expect model expansion but get none, check that your FROM clause uses model names from the MDL

---

## Cube query SQL generation

`wren cube query` doesn't execute SQL directly — it produces SQL from a
structured CubeQuery input and hands it to the engine. Inspecting
`--sql-only` output is how an agent reverse-engineers cube expansion logic.

### Generated SQL pattern

```sql
SELECT DATE_TRUNC('month', o_orderdate) AS created_at__month,
       o_orderstatus AS status,
       SUM(o_totalprice) AS revenue,
       COUNT(*) AS order_count
FROM orders                                    -- ← cube.baseObject
WHERE o_orderdate >= '2024-01-01'
  AND o_orderdate <  '2025-01-01'              -- ← dateRange (end exclusive)
  AND o_orderstatus = 'completed'              -- ← filter
GROUP BY 1, 2                                  -- ← GROUP BY ordinals for all dims
ORDER BY 1
LIMIT 100
```

### Key points

- **`FROM` is the cube's `baseObject`** — wren-core then resolves it to the
  underlying model/view, so all existing model rewrite rules still apply.
- **Time dimensions use `DATE_TRUNC(granularity, expr)`**; the column alias
  is `<name>__<granularity>` (e.g., `created_at__month`).
- **Date range is `[start, end)` half-open** — the `end` day is excluded.
- **Derived measures inline-expand**: `avg_order_value = revenue / order_count`
  becomes `(SUM(o_totalprice)) / (COUNT(*))`. Longest dependency name
  substitutes first to avoid partial-token bugs (e.g., `revenue_2` before
  `revenue`).
- **Expressions containing `$` are safe**: Postgres `$1` parameter placeholders
  and `$$tag$$` dollar-quoted literals are kept literal, not misread as
  regex capture-group templates.

### Diagnosing cube SQL errors

1. `wren cube query --sql-only ...` to inspect the generated SQL.
2. If the SQL looks reasonable, run `wren cube query ...` (drop `--sql-only`).
3. If the execution error is "unknown column / table", the cube YAML's
   `expression` is likely wrong — not the translator.
4. If translation itself fails (e.g., cyclic measure), the error is raised
   before execution and names the offending measure.
