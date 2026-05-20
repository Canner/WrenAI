# wren-core-wasm

Browser-native semantic SQL engine powered by [Apache DataFusion](https://datafusion.apache.org/) compiled to WebAssembly.

Query Parquet files directly in the browser through a semantic layer (MDL), with no server required.

## Installation

```bash
npm install @wrenai/wren-core-wasm
```

Or use directly via CDN:

```html
<script type="module">
  import { WrenEngine } from 'https://unpkg.com/@wrenai/wren-core-wasm@0.3.0/dist/index.js';
</script>
```

> **Note:** Use **unpkg**, not jsDelivr. jsDelivr's free CDN has a 50 MB
> per-file limit and the WASM binary is ~68 MB raw.

## Quick Start

### Inline Mode (recommended for local dev and bundled dashboards)

Register data directly from JavaScript — no server requirements, no Range/CORS landmines. For data totals under ~50 MB this is the path of least resistance.

```javascript
import { WrenEngine } from '@wrenai/wren-core-wasm';

const engine = await WrenEngine.init();

// Register JSON data as a table
await engine.registerJson('orders', [
  { id: 1, customer: 'Alice', amount: 100 },
  { id: 2, customer: 'Alice', amount: 250 },
  { id: 3, customer: 'Bob',   amount: 120 },
]);

// Or register Parquet from an ArrayBuffer
const response = await fetch('orders.parquet');
await engine.registerParquet('orders', await response.arrayBuffer());

// Or register CSV — string or bytes, with optional schema / delimiter / quote
await engine.registerCsv('orders', 'id,customer,amount\n1,Alice,100\n2,Bob,200');

const mdl = {
  catalog: 'wren',
  schema: 'public',
  models: [
    {
      name: 'Orders',
      tableReference: { table: 'orders' },
      columns: [
        { name: 'id', type: 'INTEGER' },
        { name: 'customer', type: 'VARCHAR' },
        { name: 'amount', type: 'DOUBLE' },
      ],
      primaryKey: 'id',
    },
  ],
  relationships: [],
  views: [],
};

// Load MDL with empty source (uses pre-registered tables)
await engine.loadMDL(mdl, { source: '' });

const rows = await engine.query('SELECT * FROM "Orders" LIMIT 10');
```

### URL Mode (remote Parquet, useful when data is large or already on a CDN)

Data lives on an HTTP server. DataFusion reads each Parquet file via **HTTP range requests** (footer first, then row groups). The server **must support `Range:` headers** — see [Choosing a local dev server](#choosing-a-local-dev-server) below; otherwise prefer inline mode.

```javascript
await engine.loadMDL(mdl, { source: 'https://your-cdn.com/data/' });

const rows = await engine.query('SELECT customer, sum(amount) AS total FROM "Orders" GROUP BY customer');
console.table(rows);
// [{ customer: 'Alice', total: 350 }, { customer: 'Bob', total: 120 }]
```

### Node.js usage

`WrenEngine.init()` defaults to fetching the WASM binary via `import.meta.url`, which in Node resolves to a `file://` URL. Node's `undici` fetch does not support `file://` and `init()` will throw. Pass the binary directly as a `BufferSource`:

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

Useful for unit tests, CI smoke checks, and any non-browser environment (`node --test`).

## Choosing a local dev server

URL mode uses DataFusion's `ListingTable`, which reads Parquet via HTTP range requests. If the dev server doesn't support `Range:` headers, fetches hang silently after the footer.

| Server | Range support | Notes |
|---|---|---|
| `python -m http.server` | ❌ No | Built-in — avoid for URL mode |
| `python -m RangeHTTPServer` | ✅ Yes | `pip install rangehttpserver` |
| `npx serve` | ⚠️ Single-range | Built on `sirv`; can return `416` on ranges that extend past EOF |
| `npx http-server` | ✅ Yes | CORS by default |
| `caddy file-server` | ✅ Yes | Production-ready |
| Vite | ⚠️ Single-range | Also uses `sirv`; same `416` edge case as `npx serve` |
| `webpack-dev-server` | ⚠️ Single-range | Multipart range requests fall back to returning the whole resource |

**Quick check:** `curl -I -H "Range: bytes=0-1023" http://localhost:PORT/file.parquet` should return `HTTP/1.1 206 Partial Content` (not `200`).

If you're stuck with a no-range server, use **inline mode** instead — fetch each file once with `fetch()` and register it via `registerParquet`.

## Examples

The `examples/` directory ships runnable browser demos. They import the
local WASM build from `pkg/`, so they always reflect the current source
— useful while iterating on the Rust or TypeScript side.

```bash
# Build the WASM binary (debug build is fine for examples)
just build-wasm-dev

# Start the static dev server with CORS + Range support
just serve
```

The server prints every demo URL on startup. Open any of them in a browser:

| Demo | URL | What it shows |
|---|---|---|
| Inline data | http://localhost:8787/examples/inline.html | `registerJson` + raw SQL `query()` |
| URL mode | http://localhost:8787/examples/url-mode.html | Remote Parquet via HTTP range requests |
| CDN smoke test | http://localhost:8787/examples/test-cdn.html | Loading the published package from unpkg |
| **Cube quickstart** | http://localhost:8787/examples/cube-quickstart.html | Minimal `cubeQuery()` — three preset queries (group-by, filter, time bucket) |
| **Cube explorer** | http://localhost:8787/examples/cube-explorer.html | Form-driven builder for `CubeQuery` — pick measures/dimensions, add filters, choose granularity + date range |
| **CSV quickstart** | http://localhost:8787/examples/csv-quickstart.html | `registerCsv()` against real files in `data/` — inferred schema, custom delimiter (TSV), and headerless CSV with explicit schema |

### Cube quickstart vs explorer

- **Quickstart** loads a single `order_metrics` cube and fires hardcoded
  `cubeQuery()` calls when you click a button. Read the source to see
  the smallest end-to-end cube example.
- **Explorer** is interactive: a checkbox/select form generates the
  `CubeQuery` JSON live (shown next to the result), and you can add as
  many filters as you like with all 12 `FilterOperator` values. The
  demo data is spread across regions / customers / months so groupings
  produce non-trivial numbers.

After Rust changes, re-run `just build-wasm-dev` and refresh the page —
the examples import directly from `pkg/wren_core_wasm.js`.

## API Reference

### `WrenEngine.init(options?)`

Initialize the engine and load the WASM binary.

```typescript
static async init(options?: WrenEngineOptions): Promise<WrenEngine>
```

| Option | Type | Description |
|--------|------|-------------|
| `wasmUrl` | `string \| URL \| BufferSource` | WASM binary source. Defaults to sibling `wren_core_wasm_bg.wasm` via `import.meta.url`. |

### `engine.loadMDL(mdl, profile)`

Load an MDL manifest to enable semantic layer query rewriting.

```typescript
async loadMDL(mdl: object, profile: WrenProfile): Promise<void>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `mdl` | `object` | MDL manifest (will be JSON-serialized) |
| `profile.source` | `string` | `"https://..."` for URL mode, `""` for pre-registered tables |

### `engine.registerParquet(name, data)`

Register a Parquet file as a named table. Call before `loadMDL` in inline mode.

```typescript
async registerParquet(name: string, data: ArrayBuffer): Promise<void>
```

### `engine.registerJson(name, data)`

Register JSON data as a named table. Call before `loadMDL` in inline mode.

```typescript
async registerJson(name: string, data: object[]): Promise<void>
```

### `engine.registerCsv(name, data, options?)`

Register CSV data as a named table. Accepts a string (treated as UTF-8) or any
`BufferSource` (ArrayBuffer / TypedArray / Node Buffer). By default the first
row is the header and the schema is inferred from the first 1000 rows.

```typescript
async registerCsv(
  name: string,
  data: string | BufferSource,
  options?: CsvReadOptions,
): Promise<void>
```

| Option (camelCase) | Type | Default | Description |
|---|---|---|---|
| `header` | `boolean` | `true` | First row is a header. |
| `delimiter` | `string` | `","` | Field delimiter (single ASCII char). |
| `quote` | `string` | `"\""` | Quote character (single ASCII char). |
| `escape` | `string` | unset | Escape character (single ASCII char). |
| `terminator` | `string` | any of `\n`, `\r\n` | Record terminator (single ASCII char). |
| `batchSize` | `number` | `8192` | RecordBatch size. |
| `inferRows` | `number` | `1000` | Rows scanned for inference. Ignored when `schema` is set. |
| `schema` | `CsvSchemaColumn[]` | inferred | Explicit Arrow schema `{ name, type, nullable? }[]`. |

Schema column types (case-insensitive): `int8`/`int16`/`int32`/`int64`,
`uint8`/`uint16`/`uint32`/`uint64`, `float32`/`float64`, `boolean`,
`string` (alias `utf8`/`varchar`/`text`), `date`/`date32`/`date64`,
`timestamp` and `timestamp_{s,ms,us,ns}`.

### `engine.query(sql)`

Execute a SQL query through the semantic layer. Returns parsed result objects.

```typescript
async query(sql: string): Promise<Record<string, unknown>[]>
```

### `engine.free()`

Release WASM memory. Call when the engine is no longer needed.

## Building from Source

Prerequisites: Rust toolchain, `wasm-pack`, Node.js 16+.

```bash
cd wren-core-wasm

# Install TypeScript dev dependencies
npm install

# Build WASM binary (requires wasm32-unknown-unknown target)
wasm-pack build --target web --release

# Build TypeScript wrapper + assemble dist/
npm run build:dist

# Run integration tests
npm test

# Type check only
npm run typecheck
```

### macOS Notes

On macOS, the WASM build may need LLVM for C dependencies:

```bash
brew install llvm

CC_wasm32_unknown_unknown=/opt/homebrew/opt/llvm/bin/clang \
AR_wasm32_unknown_unknown=/opt/homebrew/opt/llvm/bin/llvm-ar \
CFLAGS_wasm32_unknown_unknown="--target=wasm32-unknown-unknown" \
wasm-pack build --target web --release
```

## Notes

- `query()` returns `Record<string, unknown>[]` — directly usable with Chart.js, D3, Recharts, etc.
- MDL `tableReference` uses bare table names (e.g., `"orders"`), not full URLs.
- For local dev under ~50 MB, prefer **inline mode** — it eliminates the HTTP Range/CORS class of bugs.
- URL mode requires an HTTP server that supports CORS **and** range requests (see [Choosing a local dev server](#choosing-a-local-dev-server)).
- In Node, pass `wasmUrl: BufferSource` to `WrenEngine.init()` — Node's fetch can't load `file://` URLs.
- WASM binary is ~68 MB raw / ~14 MB gzip.

## License

Apache-2.0
