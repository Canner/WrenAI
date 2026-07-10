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

### Inline Mode (default for local dev and bundled dashboards)

Data is embedded in the page (or read from local files in Node). No server requirements — the path of least resistance for anything under ~50 MB.

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

A common dashboard pattern: `fetch()` each Parquet file once in parallel, then `registerParquet` them **sequentially** (the WASM engine is single-threaded and registration is not concurrent-safe).

### URL Mode (large data already on a CDN)

Data lives on an HTTP server. DataFusion reads Parquet via HTTP **range requests** (footer first, then individual row groups).

```javascript
const engine = await WrenEngine.init();
await engine.loadMDL(mdlJson, { source: 'https://your-cdn.com/data/' });
const rows = await engine.query('SELECT * FROM "Orders" LIMIT 100');
```

Requirements:
- Server must support **CORS** and **HTTP `Range:` headers**. Most built-in dev servers do not — see [Choosing a local dev server](#choosing-a-local-dev-server).
- MDL `tableReference.table` uses bare names (e.g., `"orders"`) — the engine prepends `source` as URL prefix.

> **When to pick URL mode:** data total > ~50 MB AND you control the hosting (CDN/object store) AND range support is verified. Otherwise, inline mode is safer.

### Node.js usage

`WrenEngine.init()` defaults to fetching the WASM binary via `import.meta.url`. In Node, that resolves to a `file://` URL, and Node's `undici` fetch does not support `file://` — `init()` throws `TypeError: fetch failed → not implemented` immediately. Pass the binary as a `BufferSource` instead:

```javascript
import { readFileSync } from 'node:fs';
import { WrenEngine } from '@wrenai/wren-core-wasm';

const buf = readFileSync(
  'node_modules/@wrenai/wren-core-wasm/dist/wren_core_wasm_bg.wasm'
);
const engine = await WrenEngine.init({
  wasmUrl: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
});
```

This is also the pattern for unit tests and CI smoke checks (`node --test`).

## Choosing a local dev server

URL mode uses DataFusion's `ListingTable`, which reads Parquet via HTTP **range requests** (it fetches the footer first, then individual row groups). The dev server you use **must support `Range:` headers** or fetches will hang silently after the first read.

| Server | Range support | Notes |
|---|---|---|
| `python -m http.server` | ❌ No | Built-in Python — avoid for URL mode |
| `python -m RangeHTTPServer` | ✅ Yes | `pip install rangehttpserver` |
| `npx serve` | ⚠️ Single-range | Built on `sirv`; can return `416` when the requested range extends past EOF |
| `npx http-server` | ✅ Yes | CORS by default |
| `caddy file-server` | ✅ Yes | Production-ready |
| Vite | ⚠️ Single-range | Also uses `sirv`; same `416` edge case as `npx serve` |
| `webpack-dev-server` | ⚠️ Single-range | Single-range only via `webpack-dev-middleware`; multipart ranges fall back to returning the whole resource |

**Quick check:** `curl -I -H "Range: bytes=0-1023" http://localhost:PORT/file.parquet` should return `HTTP/1.1 206 Partial Content` (not `200`).

If you're stuck with a no-range server, use [Inline Mode](#inline-mode-default-for-local-dev-and-bundled-dashboards) — fetch each file once and register it via `registerParquet`.

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

1. **Model names are case-sensitive** — use double quotes: `FROM "Orders"`, not `FROM Orders`.
2. **`loadMDL` must be called after `registerJson`/`registerParquet`/`registerCsv`** in inline mode.
3. **WASM binary is ~68 MB** — show a loading indicator during `WrenEngine.init()`.
4. **`source: ''`** means "use pre-registered tables only" — don't pass `''` if you expect URL mode.
5. **URL mode needs HTTP(S) + CORS** — opening the dashboard from a `file://` URL won't work as the data source; serve both the page and the Parquet over HTTP(S) with CORS configured.
6. **Range support required** for URL mode — `python -m http.server` lacks it. Use `npx serve` or fall back to inline mode.
7. **Node needs `wasmUrl: BufferSource`** — `WrenEngine.init()` without options fails immediately under Node because `file://` fetch isn't supported.
8. **Register sequentially** — call `registerParquet`/`registerJson` one at a time. The WASM engine is single-threaded; concurrent registration is not safe.
