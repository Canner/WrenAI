#!/usr/bin/env node
/**
 * Copies `providers/*.provider.yaml` into `dist-server/providers/` after the
 * TypeScript build.
 *
 * `harness/setup/runner.ts` (`DEFAULT_SETUP_PROVIDER_PATH`) and
 * `harness/compile/pipeline.ts` (`DEFAULT_WREN_PROVIDER_PATH`) both resolve
 * their bundled provider fragment relative to their own compiled location
 * (`path.dirname(fileURLToPath(import.meta.url))/../../providers/...`). That
 * resolution lands in `dist-server/providers/` once compiled, but `tsc` only
 * emits `.js` from `.ts` — it never copies plain data files. Without this
 * step, `dist-server/providers/` is never created and `pnpm run start:bff`
 * fails the moment setup or Mode A dispatch tries to read its provider
 * fragment.
 */
import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(packageRoot, "providers");
const dest = path.join(packageRoot, "dist-server", "providers");

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
