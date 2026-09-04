#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolveVerifiedBinary } from "../lib/verified.mjs";

try {
  const binary = resolveVerifiedBinary();
  const child = spawnSync(binary, process.argv.slice(2), { stdio: "inherit" });
  if (child.error) throw child.error;
  process.exit(child.status ?? 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
