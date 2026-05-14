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
  import { WrenEngine } from 'https://unpkg.com/@wrenai/wren-core-wasm@0.1.0/dist/index.js';
</script>
```

> **Note:** Use **unpkg**, not jsDelivr. jsDelivr's free CDN has a 50 MB
> per-file limit and the WASM binary is ~68 MB raw.

## Quick Start

### URL Mode (remote Parquet files)

Load Parquet files from a URL-accessible location. DataFusion reads them via HTTP range requests.

```javascript
import { WrenEngine } from '@wrenai/wren-core-wasm';

const engine = await WrenEngine.init();

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
  metrics: [],
  views: [],
};

await engine.loadMDL(mdl, { source: 'https://your-cdn.com/data/' });

const rows = await engine.query('SELECT customer, sum(amount) AS total FROM "Orders" GROUP BY customer');
console.table(rows);
// [{ customer: 'Alice', total: 350 }, { customer: 'Bob', total: 120 }]
```

### Inline Mode (embedded data)

Register data directly from JavaScript — no server needed.

```javascript
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

// Load MDL with empty source (uses pre-registered tables)
await engine.loadMDL(mdl, { source: '' });

const rows = await engine.query('SELECT * FROM "Orders" LIMIT 10');
```

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
| CDN smoke test | http://localhost:8787/examples/test-cdn.html | Loading the published wheel from unpkg |
| **Cube quickstart** | http://localhost:8787/examples/cube-quickstart.html | Minimal `cubeQuery()` — three preset queries (group-by, filter, time bucket) |
| **Cube explorer** | http://localhost:8787/examples/cube-explorer.html | Form-driven builder for `CubeQuery` — pick measures/dimensions, add filters, choose granularity + date range |

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
- URL mode requires an HTTP server that supports CORS and range requests.
- WASM binary is ~68 MB raw / ~14 MB gzip.

## License

Apache-2.0
