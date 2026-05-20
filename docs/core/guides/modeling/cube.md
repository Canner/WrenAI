# Cube

A **Cube** is a pre-aggregation semantic layer object that defines reusable
aggregations on top of a Model or View. Clients send a structured `CubeQuery`
(measures, dimensions, optional time bucket + filters); the engine produces
`SELECT … GROUP BY` SQL and runs it through the same path as `wren --sql`.

## When to use

Define a cube when you want to:

- run aggregation queries (`SUM`, `COUNT`, `AVG`) grouped by dimensions
- group by time (`year` / `quarter` / `month` / `week` / `day` / `hour` / `minute`)
- share business metrics between AI agents, BI dashboards, and the browser SDK
- expose drill-down hierarchies for dashboard navigation

Cubes are particularly useful for AI agents: instead of writing `GROUP BY` and
`DATE_TRUNC` SQL by hand (and getting it wrong on small / local models), an
agent picks a measure + dimension + granularity from the cube definition and
the translator builds the SQL.

## Structure

Each cube lives in its own file under `cubes/` as `cubes/<name>.yml`. The
YAML uses `snake_case`; `wren context build` converts to `camelCase` for
the engine.

```yaml
# cubes/order_metrics.yml
name: order_metrics
base_object: orders            # name of a defined Model or View

measures:
  - name: revenue
    expression: "SUM(o_totalprice)"
    type: DOUBLE
  - name: order_count
    expression: "COUNT(*)"
    type: BIGINT
  - name: avg_order_value
    expression: "revenue / order_count"   # ← derived measure (auto-inlined)
    type: DOUBLE

dimensions:
  - name: status
    expression: "o_orderstatus"
    type: VARCHAR

time_dimensions:
  - name: created_at
    expression: "o_orderdate"
    type: DATE

hierarchies:
  time_drill:
    - created_at         # add finer-grained levels here for drill-down
```

### JSON format (MDL manifest)

After `wren context build`, the same cube serialises to camelCase:

```json
{
  "name": "order_metrics",
  "baseObject": "orders",
  "measures": [
    { "name": "revenue", "expression": "SUM(o_totalprice)", "type": "DOUBLE" }
  ],
  "dimensions": [
    { "name": "status", "expression": "o_orderstatus", "type": "VARCHAR" }
  ],
  "timeDimensions": [
    { "name": "created_at", "expression": "o_orderdate", "type": "DATE" }
  ],
  "hierarchies": { "time_drill": ["created_at"] }
}
```

## Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique cube identifier (used by `wren cube describe`, `cubeQuery.cube`, …) |
| `base_object` | Yes | Name of a defined Model or View; becomes `FROM <base_object>` in the generated SQL |
| `measures` | Yes | List of `{ name, expression, type }`. `expression` may reference physical columns or other measure names (derived measure) |
| `dimensions` | No | List of `{ name, expression, type }` used for `GROUP BY` and filters |
| `time_dimensions` | No | List of `{ name, expression, type }`. Granularity is picked at query time, not in the cube definition |
| `hierarchies` | No | Map of `name → [dimension_names]`, for BI drill-down navigation. Levels must reference declared dimensions or time dimensions. |

## Time granularity

Supported values at query time: `year`, `quarter`, `month`, `week`, `day`,
`hour`, `minute`.

When a query specifies a time dimension with a granularity, the translator
emits `DATE_TRUNC(granularity, expr)` in the projection and `GROUP BY`. The
column alias is `<name>__<granularity>` (e.g., `created_at__month`). An
optional `dateRange: [start, end]` becomes a half-open `[start, end)` `WHERE`
clause.

## Derived measures

A measure's `expression` may reference other measures by name:

```yaml
- name: avg_order_value
  expression: "revenue / order_count"
```

The translator inlines `revenue` and `order_count` before emitting SQL:

```text
avg_order_value  →  (SUM(o_totalprice)) / (COUNT(*))
```

Substitution is longest-prefix-first to avoid partial-token replacement
(e.g., `revenue_2` substitutes before `revenue`). At query time the
translator resolves only the transitive closure of the measures that the
request actually names. Cube validity — including cycle detection across
all derived measures — is enforced earlier during MDL analysis (see
[Validation](#validation) below), so an invalid cube is rejected at load
time regardless of which measures a later query references.

Expressions containing `$` (Postgres `$1` placeholders or `$$tag$$`
dollar-quoted strings) are preserved literally — the translator does not
treat them as regex capture-group templates.

## Filter operators

`cubeQuery.filters` accepts these operators:

`eq` · `neq` · `in` · `not_in` · `gt` · `gte` · `lt` · `lte` ·
`contains` · `starts_with` · `is_null` · `is_not_null`

`in` / `not_in` take an array value. `is_null` / `is_not_null` take no value.
`contains` / `starts_with` produce `LIKE` patterns.

## Cube vs. View vs. Model

| Use case | Use |
|---|---|
| Expose raw rows (optionally with calculated fields) | [Model](./model.md) |
| Name a complex `SELECT` for reuse | [View](./view.md) |
| Predefined aggregation API (measures × dimensions) for agents / BI | **Cube** |

## CLI

- `wren cube list` — list every cube in the loaded MDL
- `wren cube describe <name>` — pretty-print the cube schema
- `wren cube query` — build a CubeQuery (CLI flags or `--from <json>`) and run it
- `wren cube query --sql-only ...` — print the generated SQL without executing

See the [CLI reference](../../reference/cli.md#wren-cube--pre-aggregation-queries).

## WASM (browser)

The same translator is exposed in `@wrenai/wren-core-wasm`:

```javascript
const cubes = engine.listCubes();
const rows = await engine.cubeQuery({
  cube: "order_metrics",
  measures: ["revenue"],
  timeDimensions: [{ dimension: "created_at", granularity: "month" }],
});
```

See the [WASM SDK doc](../../sdk/wasm.md) for setup, the
[WASM Agent Guide](https://github.com/Canner/WrenAI/blob/main/core/wren-core-wasm/AGENT_GUIDE.md)
for embedding-in-an-agent patterns, and
[`cube-explorer.html`](https://github.com/Canner/WrenAI/blob/main/core/wren-core-wasm/examples/cube-explorer.html)
for an interactive form-driven builder.

## Validation

Wren-core validates cubes during `AnalyzedWrenMDL::analyze` — i.e., when the
manifest is loaded into the engine, not just at query time:

- `base_object` must resolve to a defined Model or View
- Derived measures must not form a cycle within the transitive closure of
  requested measures
- Levels in `hierarchies` must reference a declared `dimension` or
  `time_dimension`

The CLI's `wren context validate` also runs structural checks on cube YAML
(unique names, `base_object` exists, hierarchy levels) before the manifest
reaches the engine, so common mistakes surface at edit time.
