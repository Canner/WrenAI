# wren-core-wasm

Browser-native semantic SQL engine. The Rust wren-core engine compiled to
WebAssembly, plus a TypeScript SDK that runs queries through an MDL semantic
layer entirely in the browser — no server, no roundtrip.

**Use this SDK when**: you're building a client-side analytics UI, a notebook,
or an LLM-in-the-browser experience where the data lives in static Parquet
files (or can be inlined as JSON/CSV) and you want the agent to write SQL
against an MDL model. For server-side Python agents, use
[`wren-langchain`](./langchain.md) or [`wren-pydantic`](./pydantic.md)
instead — they wrap the same engine but talk to your real database.

---

## How it differs from the other SDKs

| | `wren-core-wasm` | `wren-langchain` / `wren-pydantic` |
|---|---|---|
| **Runtime** | Browser (WebAssembly) | Python server |
| **Data source** | Remote Parquet, inline JSON/CSV, or uploaded files | Any datasource the CLI supports (Postgres, BigQuery, …) |
| **Connection profile** | None — data is fetched / registered client-side | Required (built via `wren profile add`) |
| **MDL source** | Passed as a JS object per page load | Read from `target/mdl.json` per tool call |
| **Memory / agent tools** | Not in the WASM SDK | Built-in tools (`wren_query`, `wren_recall_queries`, …) |
| **Query path** | DataFusion executes the SQL in-browser | Engine plans SQL, target database executes |

There is no `WrenToolkit` here — the WASM SDK exposes the engine primitives
(`registerJson` / `registerParquet` / `registerCsv` / `loadMDL` / `query` /
`cubeQuery` / `listCubes`) and you wire them into your own UI or agent loop.

---

## Installation

### npm

```bash
npm install @wrenai/wren-core-wasm
```

```javascript
import { WrenEngine } from '@wrenai/wren-core-wasm';
```

### CDN

```html
<script type="module">
  import { WrenEngine } from 'https://unpkg.com/@wrenai/wren-core-wasm@0.3.0/dist/index.js';
</script>
```

> ⚠️ Use **unpkg**, not jsDelivr. jsDelivr's free CDN has a 50 MB per-file
> cap; the WASM binary is ~72 MB raw. Bundlers (Vite, Webpack, esbuild) are
> fine — see [Bundler configuration](#bundler-configuration).

---

## Quickstart

The same `WrenEngine` instance handles three data-loading modes. Pick the one
that fits your data:

### 1. URL mode (remote Parquet)

DataFusion fetches Parquet files via HTTP range requests; no registration
needed.

```javascript
const engine = await WrenEngine.init();

const mdl = {
  catalog: 'wren',
  schema: 'public',
  models: [{
    name: 'Orders',
    tableReference: { table: 'orders' },     // resolves to {source}/orders.parquet
    columns: [
      { name: 'id', type: 'INTEGER' },
      { name: 'customer', type: 'VARCHAR' },
      { name: 'amount', type: 'DOUBLE' },
    ],
    primaryKey: 'id',
  }],
  relationships: [], views: [],
};

await engine.loadMDL(mdl, { source: 'https://cdn.example.com/data/' });

const rows = await engine.query(
  'SELECT customer, SUM(amount) AS total FROM "Orders" GROUP BY customer'
);
console.table(rows);
```

### 2. Inline data (JSON / CSV / Parquet)

Pre-register every table before `loadMDL`. Pass `source: ''` to let the
engine auto-detect that no URL prefix is in play and use the registered
tables (see [`loadMDL`](#engineloadmdlmdl-profile) for the full mode
matrix).

```javascript
const engine = await WrenEngine.init();

// JSON
await engine.registerJson('orders', [
  { id: 1, customer: 'Alice', amount: 150 },
  { id: 2, customer: 'Bob',   amount: 250 },
]);

// CSV — string or Uint8Array; options object is optional
await engine.registerCsv('events', csvString, {
  header: true,
  delimiter: ',',
  // optional explicit Arrow schema; omit to infer
  schema: [
    { name: 'id', type: 'int64' },
    { name: 'event_type', type: 'string' },
  ],
});

// Parquet — BufferSource (ArrayBuffer / Uint8Array / Node Buffer)
const file = await fetch('orders.parquet').then(r => r.arrayBuffer());
await engine.registerParquet('orders_pq', file);

await engine.loadMDL(mdl, { source: '' });   // auto-detect; uses the registered tables
```

### 3. Cube queries (structured aggregation)

When the MDL defines a [cube](../guides/modeling/cube.md), prefer `cubeQuery`
over hand-written `GROUP BY` SQL. The engine assembles `DATE_TRUNC` / filters
/ projections from a JSON request — useful for an agent that doesn't need to
think about SQL syntax.

```javascript
await engine.loadMDL(mdlWithCubes, { source: '' });

const cubes = engine.listCubes();   // discover what's queryable
const rows = await engine.cubeQuery({
  cube: 'order_metrics',
  measures: ['revenue', 'order_count'],
  dimensions: ['customer'],
  timeDimensions: [{
    dimension: 'created_at',
    granularity: 'month',
    dateRange: ['2024-01-01', '2024-04-01'],
  }],
  filters: [{ dimension: 'status', operator: 'eq', value: 'open' }],
});
```

See [`examples/cube-explorer.html`](https://github.com/Canner/WrenAI/blob/main/core/wren-core-wasm/examples/cube-explorer.html)
for an interactive form-driven builder and
[`examples/csv-quickstart.html`](https://github.com/Canner/WrenAI/blob/main/core/wren-core-wasm/examples/csv-quickstart.html)
for the three CSV patterns (inferred schema, custom delimiter, explicit
schema).

---

## API Reference

### `WrenEngine.init(options?)`

Initialize the engine and load the WASM binary. Call once per page lifecycle.

```typescript
static async init(options?: WrenEngineOptions): Promise<WrenEngine>
```

| Option | Type | Description |
|---|---|---|
| `wasmUrl` | `string \| URL \| BufferSource` | WASM binary source. Defaults to the sibling `wren_core_wasm_bg.wasm` resolved via `import.meta.url`. |

### `engine.loadMDL(mdl, profile)`

Load an MDL manifest and reconfigure the session with Wren analyzer rules.

```typescript
async loadMDL(mdl: object, profile: WrenProfile): Promise<void>
```

| `profile.source` | Mode | Behaviour |
|---|---|---|
| `"https://…/"` / `"http://…/"` | **URL mode** | Auto-registers a `ListingTable` for each model at `{source}/{table_name}.parquet`. No pre-registration needed. |
| `""` (empty) | **Auto-detect mode** | For each model, picks URL mode if its `tableReference` looks like a URL, otherwise expects the table to already be registered. Used by the inline quickstart above. |
| anything else | **Strict local mode** | All tables must be pre-registered via `register*`. Any missing table raises `Unresolved models: [...]` immediately from `loadMDL` instead of deferring to query time. |

Bare model names resolve under the MDL's catalog/schema after this call.
Use strict local mode (any non-URL, non-empty source string) when you've
pre-registered everything and want missing-table errors to surface up
front; use auto-detect (`""`) when matching the behaviour of the bundled
browser examples.

### `engine.registerJson(name, data)`

Register a JSON array as a named table. Schema is inferred from the first
row. Call before `loadMDL` when using auto-detect or strict local mode.

```typescript
async registerJson(name: string, data: object[]): Promise<void>
```

### `engine.registerParquet(name, data)`

Register a Parquet file as a named table.

```typescript
async registerParquet(name: string, data: BufferSource): Promise<void>
```

`BufferSource` covers `ArrayBuffer`, any `TypedArray` (`Uint8Array`), and
Node.js `Buffer`. The view's `byteOffset` / `byteLength` are honored.

### `engine.registerCsv(name, data, options?)`

Register CSV data as a named table. Accepts a string (UTF-8) or `BufferSource`.

```typescript
async registerCsv(
  name: string,
  data: string | BufferSource,
  options?: CsvReadOptions,
): Promise<void>
```

| Option (camelCase) | Type | Default |
|---|---|---|
| `header` | `boolean` | `true` |
| `delimiter` | `string` (1 ASCII char) | `,` |
| `quote` | `string` (1 ASCII char) | `"` |
| `escape` | `string` (1 ASCII char) | unset |
| `terminator` | `string` (1 ASCII char) | `\n` / `\r\n` |
| `batchSize` | `number` | `8192` |
| `inferRows` | `number` | `1000` |
| `schema` | `[{name, type, nullable?}]` | inferred |

Schema column types (case-insensitive): `int8`/`int16`/`int32`/`int64`,
`uint8`/`uint16`/`uint32`/`uint64`, `float32`/`float64`, `boolean`,
`string` (alias `utf8`/`varchar`/`text`), `date`/`date32`/`date64`,
`timestamp` and `timestamp_{s,ms,us,ns}`.

### `engine.query(sql)`

Execute a SQL query through the semantic layer. Returns parsed rows.

```typescript
async query(sql: string): Promise<Record<string, unknown>[]>
```

### `engine.cubeQuery(query)`

Run a structured cube query against the loaded MDL. Translates the
`CubeQuery` JSON to SQL, then runs it through the same path as `query()`.
Requires `loadMDL` first.

```typescript
async cubeQuery(query: CubeQueryInput): Promise<Record<string, unknown>[]>

interface CubeQueryInput {
  cube: string;
  measures: string[];
  dimensions?: string[];
  timeDimensions?: TimeDimensionInput[];
  filters?: CubeFilterInput[];
  limit?: number;
  offset?: number;
}
```

See [`docs/core/guides/modeling/cube.md`](../guides/modeling/cube.md) for the
full input shape and filter operator list.

### `engine.listCubes()`

Return the cubes defined in the loaded MDL. Synchronous — useful for an
agent to discover what's queryable before calling `cubeQuery`.

```typescript
listCubes(): CubeInfo[]
```

### `engine.free()`

Release WASM memory. Call when the engine is no longer needed (e.g. SPA
route unmount).

---

## Integration patterns

### Bundler configuration

Bundlers must copy the `.wasm` file into your output. Most setups handle this
automatically; if not, pass the URL explicitly:

```javascript
import wasmUrl from '@wrenai/wren-core-wasm/dist/wren_core_wasm_bg.wasm?url';
const engine = await WrenEngine.init({ wasmUrl });
```

Vite recognises the `?url` suffix. Webpack 5 needs `experiments.asyncWebAssembly`.
For other bundlers, fetch the binary yourself and pass the `ArrayBuffer`.

### Multiple engines per page

`WrenEngine.init()` is safe to call more than once — each call returns an
independent engine with its own catalog. Useful for sandboxing per-tenant
data on the same page. The WASM module itself is shared via the standard
`import` cache, so only the first init pays the binary fetch.

### Cubes as the agent surface

For LLM-driven UIs, prefer `cubeQuery` over teaching the agent SQL:

1. Call `listCubes()` once after `loadMDL` and inject the result into the
   system prompt as the agent's "menu" of available aggregations.
2. Have the agent emit a `CubeQueryInput` JSON object — no `GROUP BY` /
   `DATE_TRUNC` knowledge required.
3. `cubeQuery()` validates the request against the MDL before running, so
   typos (`measures: ['revnu']`) raise structured errors you can feed back to
   the LLM.

---

## Examples

Runnable browser demos in [`examples/`](https://github.com/Canner/WrenAI/tree/main/core/wren-core-wasm/examples):

| Demo | Shows |
|---|---|
| `inline.html` | `registerJson` + raw SQL |
| `url-mode.html` | Remote Parquet via HTTP range |
| `csv-quickstart.html` | Three `registerCsv` patterns (inferred / TSV / explicit schema) |
| `cube-quickstart.html` | Minimal `cubeQuery` — three preset queries |
| `cube-explorer.html` | Form-driven `CubeQuery` builder |

```bash
cd core/wren-core-wasm
just build-wasm-dev
just serve              # http://localhost:8787
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Unresolved models: [foo]` from `loadMDL` | Strict local mode but `foo`'s physical table wasn't pre-registered | Call `register*` for every model before `loadMDL`, or switch to URL mode |
| `undefined is not an object (evaluating 'arg.length')` | Calling the raw WASM API with the wrong arg count or type (e.g. passing a string where bytes are expected) | Use the TypeScript SDK overloads (`engine.registerCsv(name, str)`); the raw `pkg/` API requires bytes + explicit options JSON |
| `Cube query for 'X' must include at least one measure…` | Empty `measures` + `dimensions` + `timeDimensions` | A cube query must project something — add at least one field |
| `Unsupported CSV column type 'bogus'` | Typo in explicit schema | See the type list under `registerCsv` for accepted names |
| Page hangs on `init()` for >5s | Initial WASM fetch (~72 MB raw, ~15 MB gzip) | Add a loading indicator; consider self-hosting + caching the binary instead of CDN |
| jsDelivr returns 404 | jsDelivr's 50 MB per-file CDN limit blocks the binary | Use [unpkg](https://unpkg.com/) instead, or self-host |

---

## Compatibility

| `@wrenai/wren-core-wasm` | wren-core | Browser |
|---|---|---|
| 0.3.x | 0.5.x | Any with WASM + ES modules (Chrome 91+, Firefox 89+, Safari 15+) |

The package ships a single `dist/` bundle (ES modules) plus the `.wasm`
binary. There is no UMD or CommonJS build.

---

## Limitations

- **~72 MB WASM binary.** Cold-load is 1–4 s on a fast connection; surface a
  loading state. Subsequent loads use the HTTP cache.
- **In-memory tables only.** `registerJson` / `registerCsv` materialise the
  entire dataset as Arrow batches — practical ceiling is "as much as the
  browser tab can hold" (typically 100s of MB before pressure kicks in).
- **No streaming.** Each `register*` call buffers fully before becoming
  queryable. For very large remote files, use URL mode (DataFusion streams
  Parquet via range requests) instead.
- **Single-threaded.** The DataFusion build is configured with
  `target_partitions = 1` — no Web Worker pool. Long queries block the main
  thread; consider running the engine in a Worker if responsiveness matters.
- **Upstream DataFusion (not the Canner fork).** WASM doesn't need the
  unparser fixes; the trade-off is that some advanced wren-core analyzer
  paths that depend on fork-only behaviour aren't exercised here.
- **No memory module.** Semantic-search memory (LanceDB) is a server-side
  feature exposed by `wren-langchain` / `wren-pydantic` — not available in
  the WASM SDK.
