#!/usr/bin/env node
/**
 * Build script for wren-core-wasm npm package.
 *
 * Assembles dist/ from wasm-pack output (pkg/) and TypeScript wrapper (sdk/).
 * Run `npm run build:wasm` first to populate pkg/, then `npm run build:dist`.
 * Or use `npm run build` to run both.
 */

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const pkg = resolve(root, "pkg");
const dist = resolve(root, "dist");

// Verify wasm-pack output exists
if (!existsSync(resolve(pkg, "wren_core_wasm_bg.wasm"))) {
  console.error(
    "Error: pkg/ not found. Run `npm run build:wasm` (wasm-pack build) first."
  );
  process.exit(1);
}

// Clean dist
if (existsSync(dist)) {
  rmSync(dist, { recursive: true });
}
mkdirSync(dist, { recursive: true });

// 1. Copy wasm-pack artifacts to dist/
const pkgFiles = [
  "wren_core_wasm.js",
  "wren_core_wasm.d.ts",
  "wren_core_wasm_bg.wasm",
  "wren_core_wasm_bg.wasm.d.ts",
];

for (const file of pkgFiles) {
  const src = resolve(pkg, file);
  if (existsSync(src)) {
    cpSync(src, resolve(dist, file));
    console.log(`  copied pkg/${file} → dist/${file}`);
  }
}

// 2. Compile TypeScript wrapper → dist/
console.log("\nCompiling TypeScript...");
execSync("npx tsc -p sdk/tsconfig.json", { cwd: root, stdio: "inherit" });

// 3. Report
const wasmPath = resolve(dist, "wren_core_wasm_bg.wasm");
if (existsSync(wasmPath)) {
  const stats = statSync(wasmPath);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
  console.log(`\n✓ dist/ ready (WASM binary: ${sizeMB} MB)`);
} else {
  console.log("\n✓ dist/ ready");
}
