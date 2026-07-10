# wren-core-wasm

Wren Engine compiled to WebAssembly for browser-native analytics. Runs SQL queries on Parquet/CSV/JSON data through the MDL semantic layer entirely client-side, powered by DataFusion.

## Why a Separate Crate?

Uses **upstream DataFusion** (crates.io v53), not the Canner fork. The WASM version executes queries directly via DataFusion — no SQL unparser or dialect transpilation needed. Kept outside the `wren-core/` workspace to avoid dependency conflicts.

Shared code: `wren-core-base` (manifest types, no DataFusion dependency) and `wren-core` semantic layer (MDL analysis rules).

## Architecture

```text
Browser JS
  ├── registerParquet(name, bytes) → Arrow RecordBatch → MemTable
  ├── registerJson(name, json)     → Arrow JSON reader → MemTable
  ├── loadMDL(mdl_json, source)    → AnalyzedWrenMDL + table resolution
  │     URL mode:   source="https://..." → ListingTable via HttpStore
  │     Local mode:  source="./..."      → expects pre-registered tables
  │     Fallback:    source=""           → auto-detect from tableReference
  └── query(sql) → MDL rewrite → DataFusion execute → JSON result
```

## Key Source Files

- `src/lib.rs` — Single-file crate with `WrenEngine` struct:
  - `new()` → SessionContext with single-thread config
  - `register_json()` → JSON array → NDJSON → Arrow RecordBatch → MemTable
  - `register_parquet()` → Parquet bytes → Arrow RecordBatch → MemTable
  - `load_mdl()` → Parse manifest, analyze with wren-core, register tables by mode
  - `query()` → Apply MDL analyzer rules → DataFusion execute → JSON string
- `sdk/src/index.ts` — TypeScript wrapper (`WrenEngine` class) for npm package
- `sdk/src/wren_core_wasm.d.ts` — Hand-maintained type stubs for wasm-bindgen output
- `sdk/tests/index.test.mjs` — Node.js integration tests
- `scripts/build.mjs` — Build script: copy pkg/ artifacts + compile TS → dist/
- `examples/` — Browser HTML examples (inline, url-mode, test-cdn) + HTTP server (serve.mjs)

## Dev Commands

```bash
just build           # Full build: WASM (release) + TypeScript SDK → dist/
just build-wasm      # WASM only (wasm-pack → pkg/), macOS LLVM auto-detected
just build-wasm-dev  # WASM debug build (faster, no --release)
just build-dist      # Assemble dist/ from pkg/ + TS (requires pkg/ to exist)
just test            # SDK integration tests (requires dist/)
just typecheck       # TypeScript type check only
just serve           # HTTP server on localhost:8787 for browser examples
just size            # Report WASM binary size (raw + gzip)
just clean           # Remove pkg/, dist/, target/
```

## Dependencies

- **DataFusion v53** (upstream, crates.io) — query engine, `default-features = false` + selected features
- **Arrow v58.1** — `json` feature for JSON reader
- **Parquet v58.1** — `snap` + `lz4` only (no zstd — requires C library, can't compile to WASM)
- **object_store v0.13.1** — `aws` + `http` features for URL mode (HttpStore)
- **wren-core** (path: `../wren-core/core`) — semantic layer, `default-features = false`
- **wren-core-base** (path: `../wren-core-base`) — shared manifest types
- **wasm-bindgen / js-sys / web-sys** — WASM ↔ JS bindings
- **tokio** — `rt` + `macros` only (no multi-thread for WASM)
- **chrono** — `wasmbind` feature (uses `js_sys::Date` instead of `SystemTime`)
- **getrandom** v0.2/0.3/0.4 — all need `js`/`wasm_js` feature for `wasm32` target

## WASM-Specific Constraints

- **Single-threaded**: `SessionConfig::with_target_partitions(1)`, tokio `rt` only (no `rt-multi-thread`)
- **No zstd**: `zstd-sys` (C library) can't compile to WASM. Parquet uses snappy + lz4 (pure Rust)
- **No SystemTime**: chrono `wasmbind` feature required
- **getrandom**: All three major versions (0.2, 0.3, 0.4) in the dep tree need explicit WASM JS backend
- **macOS build**: Needs LLVM (`brew install llvm`) for C deps — justfile handles env vars automatically
- **Binary size**: ~68 MB raw / ~14 MB gzip (target: < 15 MB gzip)

## npm Package (wren-core-wasm)

`package.json` defines the npm package. TypeScript SDK wraps the raw wasm-bindgen API:
- `WrenEngine.init(options?)` — load WASM binary, create engine
- `engine.loadMDL(mdl, profile)` — load MDL manifest with `{ source }` profile
- `engine.registerParquet(name, data)` / `engine.registerJson(name, data)` — pre-register tables
- `engine.query(sql)` → `Record<string, unknown>[]` (parsed, not raw JSON string)
- `engine.free()` — release WASM memory

Build output goes to `dist/` (ESM + types + `.wasm` binary). Published to npm, usable via CDN (unpkg/jsDelivr).

## Conventions

- Rust formatted with `cargo fmt`, linted with `clippy -D warnings`
- TypeScript uses strict mode, ES2020 target
- `#[wasm_bindgen(js_name = camelCase)]` for JS-facing API names
- Errors propagate as `JsError` (visible in browser console with stack traces)
- Tests: `wasm-bindgen-test` for Rust WASM tests, `node:test` for SDK integration tests
