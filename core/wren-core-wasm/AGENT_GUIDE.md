# WASM Dashboard Generation Guide

Reference for AI agents generating browser-based HTML dashboard artifacts using `wren-core-wasm`.

## How to Import

```html
<script type="module">
  import { WrenEngine } from 'https://unpkg.com/@wrenai/wren-core-wasm@0.3.0/dist/index.js';
</script>
```

**Use unpkg, not jsDelivr.** jsDelivr's free CDN has a 50 MB per-file limit and
the WASM binary is ~68 MB raw, so jsDelivr returns 403 on the `.wasm` fetch.

## Two Data Loading Modes

### URL Mode (recommended for large data)

Data lives on a CORS-enabled HTTP server. DataFusion reads Parquet via range requests.

```javascript
const engine = await WrenEngine.init();
await engine.loadMDL(mdlJson, { source: 'https://your-cdn.com/data/' });
const rows = await engine.query('SELECT * FROM "Orders" LIMIT 100');
```

Requirements:
- Server must support CORS and HTTP range requests
- MDL `tableReference.table` uses bare names (e.g., `"orders"`) — the engine prepends `source` as URL prefix

### Inline Mode (for small data, < 50 MB)

Data is embedded directly in the HTML file.

```javascript
const engine = await WrenEngine.init();

// From JSON
await engine.registerJson('orders', [
  { id: 1, customer: 'Alice', amount: 100 },
  { id: 2, customer: 'Bob', amount: 200 },
]);

// Or from Parquet (base64-decoded ArrayBuffer)
const parquetBytes = Uint8Array.from(atob(PARQUET_BASE64), c => c.charCodeAt(0));
await engine.registerParquet('orders', parquetBytes.buffer);

// Or from CSV (string or bytes). Inference handles common cases; pass
// `{ schema: [...] }` to force a specific Arrow schema.
await engine.registerCsv('orders', csvString);

await engine.loadMDL(mdlJson, { source: '' });
const rows = await engine.query('SELECT * FROM "Orders" LIMIT 100');
```

## MDL Structure

Every dashboard needs an MDL manifest. Minimal example:

```javascript
const mdl = {
  catalog: 'wren',
  schema: 'public',
  models: [
    {
      name: 'Orders',              // query as: SELECT ... FROM "Orders"
      tableReference: { table: 'orders' },  // physical table name (bare, no URL)
      columns: [
        { name: 'id', type: 'INTEGER' },
        { name: 'customer', type: 'VARCHAR' },
        { name: 'amount', type: 'DOUBLE' },
        { name: 'order_date', type: 'DATE' },
      ],
      primaryKey: 'id',
    },
  ],
  relationships: [],
  views: [],
};
```

## Query Results

`engine.query(sql)` returns `Record<string, unknown>[]` — an array of plain objects. This is directly usable with:

- **Chart.js**: `data.datasets[0].data = rows.map(r => r.amount)`
- **D3.js**: `d3.select('svg').selectAll('rect').data(rows)`
- **console.table**: `console.table(rows)`
- **HTML table**: iterate `rows` to build `<tr>/<td>` elements

## Cube Query API

For aggregation queries, prefer `cubeQuery()` over raw SQL. The cube layer
generates correct `GROUP BY`, `DATE_TRUNC`, and `WHERE` clauses from a
structured input — fewer hand-written errors for the agent.

> ⚠️ Both `listCubes()` and `cubeQuery()` require `await engine.loadMDL(...)`
> to have completed first — they throw an error otherwise.

### List available cubes

```javascript
const cubes = engine.listCubes();
// → [{ name: "order_metrics", baseObject: "orders", measures: [...],
//      dimensions: [...], timeDimensions: [...], hierarchies: {...} }]
```

### Execute a cube query

```javascript
const rows = await engine.cubeQuery({
  cube: "order_metrics",
  measures: ["revenue", "order_count"],
  dimensions: ["status"],
  timeDimensions: [{
    dimension: "created_at",
    granularity: "month",
    dateRange: ["2024-01-01", "2025-01-01"],
  }],
  filters: [
    { dimension: "status", operator: "eq", value: "completed" },
  ],
  limit: 100,
});
```

`rows` has the same `Record<string, unknown>[]` shape as `query()`.

### `cubeQuery` vs `query`

| Situation | Use |
|---|---|
| Aggregating measures over dimensions (with optional time bucket) | `cubeQuery` |
| Free-form SQL — joins across models, window functions, custom CTEs | `query` |
| MDL has no cubes defined | `query` |

### Filter operators

`eq`, `neq`, `in`, `not_in`, `gt`, `gte`, `lt`, `lte`, `contains`,
`starts_with`, `is_null`, `is_not_null`. Pass `value` as an array for
`in`/`not_in`; omit `value` for `is_null`/`is_not_null`.

### Time granularity

`year` | `quarter` | `month` | `week` | `day` | `hour` | `minute`.
`dateRange` is `[startInclusive, endExclusive]`.

## Complete HTML Template (Inline Mode)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
</head>
<body>
  <h1>Revenue Dashboard</h1>
  <canvas id="chart" width="600" height="400"></canvas>
  <div id="status">Loading engine...</div>

  <script type="module">
    import { WrenEngine } from 'https://unpkg.com/@wrenai/wren-core-wasm@0.3.0/dist/index.js';

    const status = document.getElementById('status');

    try {
      // 1. Initialize engine
      const engine = await WrenEngine.init();
      status.textContent = 'Engine ready. Loading data...';

      // 2. Register inline data
      await engine.registerJson('orders', [
        { id: 1, customer: 'Alice', amount: 150, month: '2024-01' },
        { id: 2, customer: 'Bob',   amount: 200, month: '2024-01' },
        { id: 3, customer: 'Alice', amount: 300, month: '2024-02' },
        { id: 4, customer: 'Bob',   amount: 100, month: '2024-02' },
      ]);

      // 3. Load MDL
      const mdl = {
        catalog: 'wren', schema: 'public',
        models: [{
          name: 'Orders',
          tableReference: { table: 'orders' },
          columns: [
            { name: 'id', type: 'INTEGER' },
            { name: 'customer', type: 'VARCHAR' },
            { name: 'amount', type: 'DOUBLE' },
            { name: 'month', type: 'VARCHAR' },
          ],
          primaryKey: 'id',
        }],
        relationships: [], views: [],
      };
      await engine.loadMDL(mdl, { source: '' });

      // 4. Query
      const rows = await engine.query(
        'SELECT month, sum(amount) AS revenue FROM "Orders" GROUP BY month ORDER BY month'
      );
      status.textContent = `Loaded ${rows.length} data points.`;

      // 5. Render chart
      new Chart(document.getElementById('chart'), {
        type: 'bar',
        data: {
          labels: rows.map(r => r.month),
          datasets: [{
            label: 'Revenue',
            data: rows.map(r => r.revenue),
            backgroundColor: 'rgba(54, 162, 235, 0.6)',
          }],
        },
      });

      engine.free();
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
      console.error(err);
    }
  </script>
</body>
</html>
```

## Common Pitfalls

1. **Model names are case-sensitive** — use double quotes: `FROM "Orders"`, not `FROM Orders`
2. **`loadMDL` must be called after `registerJson`/`registerParquet`/`registerCsv`** in inline mode
3. **WASM binary is ~68 MB** — show a loading indicator during `WrenEngine.init()`
4. **`source: ''`** means "use pre-registered tables only" — don't pass `''` if you expect URL mode
5. **CORS required** for URL mode — `file://` protocol won't work for fetching remote Parquet
