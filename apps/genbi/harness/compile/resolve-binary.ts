import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WarbleBinaryNotFoundError } from "./errors.js";

/**
 * Resolves the `warble` binary in three tiers, in order:
 *
 * 1. `explicit` — if given, it must exist on disk (no PATH lookup, no fallback).
 * 2. `PATH` — a bare `"warble"` that `warble --help` succeeds against. NOT `--version`: the warble
 *    CLI has no `--version` flag (clap rejects it with exit 2 — the same fact
 *    `test/compile-warble-identity.test.ts` notes for a different reason), so probing with it made
 *    this tier fail for a binary that was on `PATH` and working, silently pushing every caller into
 *    tier 3. `warble --help` exits 0 and is what the sibling `warble-agent-sdk` probe already uses.
 * 3. A sibling `warble` repo's release build — this walks up from this package's own install
 *    location looking for a `warble/target/release/warble` next to an ancestor directory, so it
 *    works whether the caller runs from the main checkout or from a git worktree nested several
 *    levels under it. This tier only ever resolves in a local development layout that happens to
 *    have a `warble` checkout with a built release binary next to this repo — a plain clone of
 *    this repo on its own has no such sibling, so tier 3 always falls through for it and callers
 *    are limited to tier 1 (an explicit path) or tier 2 (`warble` on `PATH`).
 *
 * Throws {@link WarbleBinaryNotFoundError} (loud-fail, no silent degrade) if none of the three work.
 */
export async function resolveWarbleBinary(explicit?: string): Promise<string> {
  if (explicit !== undefined) {
    if (!existsSync(explicit)) {
      throw new WarbleBinaryNotFoundError([`explicit warbleBin "${explicit}" does not exist`]);
    }
    return explicit;
  }

  const attempts: string[] = [];

  if (await isExecutableOnPath("warble")) {
    return "warble";
  }
  attempts.push(`not found on PATH (tried running "warble --help")`);

  const sibling = findSiblingReleaseBuild();
  if (sibling !== undefined) {
    return sibling;
  }
  attempts.push(
    `no sibling "warble" repo release build found (searched ancestors of this package for ` +
      `"<ancestor's parent>/warble/target/release/warble")`,
  );

  throw new WarbleBinaryNotFoundError(attempts);
}

function isExecutableOnPath(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    // Callback overload (no options): output is buffered and discarded — we only care whether the
    // process launched and exited 0. `warble --help` output is tiny, so no maxBuffer concern.
    execFile(bin, ["--help"], (error) => resolve(!error));
  });
}

/**
 * Walks up from this package's own directory (`harness/compile/` in source, `dist/compile/` once
 * built — either way two levels below the package root) looking for a `warble` directory sibling
 * to each ancestor, returning `.../warble/target/release/warble` the first time it exists.
 */
function findSiblingReleaseBuild(): string | undefined {
  let dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const maxDepth = 10;
  for (let i = 0; i < maxDepth; i += 1) {
    const parent = path.dirname(dir);
    const candidate = path.join(parent, "warble", "target", "release", "warble");
    if (existsSync(candidate)) return candidate;
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return undefined;
}
