#!/usr/bin/env node
// Size gate for the production WASM artifact, shared by wasm-ci.yml (main
// path) and both npm publish workflows via `npm run check:size`.
//
// Measures the artifact with system gzip using the file-argument form
// (`gzip -c -- <file>`) so the filename header is included. Reports the exact
// gzip byte count and MiB figures truncated to one decimal place.
//
// The gate fails closed: missing artifact, invalid limit, or gzip failure
// all exit 1.
//
// Usage: node scripts/check-size.mjs [wasmPath]
//   MAX_GZIP_MIB  override the limit in MiB (default 15); must be a finite,
//                 non-negative number, otherwise the gate fails.
import { statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const MIB = 1024 * 1024;
const DEFAULT_WASM = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist",
  "wren_core_wasm_bg.wasm",
);

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

// Truncate (not round) to one decimal place.
function truncMib(bytes) {
  return (Math.floor((bytes / MIB) * 10) / 10).toFixed(1);
}

const wasmPath = process.argv[2] ?? DEFAULT_WASM;

const rawLimit = process.env.MAX_GZIP_MIB;
const maxGzipMib =
  rawLimit === undefined || rawLimit === "" ? 15 : Number(rawLimit);
if (!Number.isFinite(maxGzipMib) || maxGzipMib < 0) {
  fail(`Invalid MAX_GZIP_MIB value: ${rawLimit}`);
}
const maxGzipBytes = Math.round(maxGzipMib * MIB);

let rawBytes;
try {
  rawBytes = statSync(wasmPath).size;
} catch (err) {
  fail(`Cannot read WASM artifact at ${wasmPath}: ${err.message}`);
}

const gzip = spawnSync("gzip", ["-c", "--", wasmPath], {
  maxBuffer: 512 * MIB,
});
if (gzip.error) {
  fail(`Failed to run system gzip: ${gzip.error.message}`);
}
if (gzip.status !== 0) {
  fail(`gzip exited with status ${gzip.status}: ${gzip.stderr}`);
}
const gzipBytes = gzip.stdout.length;

console.log(
  `WASM binary: ${truncMib(rawBytes)} MiB raw, ${truncMib(gzipBytes)} MiB gzip ` +
    `(${gzipBytes} bytes gzip, limit ${maxGzipMib} MiB gzip)`,
);
if (gzipBytes > maxGzipBytes) {
  fail(
    `WASM binary gzip size (${truncMib(gzipBytes)} MiB) exceeds ${maxGzipMib} MiB limit`,
  );
}
