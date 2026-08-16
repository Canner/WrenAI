import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolves the v1 default Warble profile (`genbi-default`) the same way
 * `resolveWarbleBinary` (`harness/compile/resolve-binary.ts`) resolves the
 * `warble` binary itself: this package and `warble` are checked out as
 * sibling repos under a common `repos/` directory (see the workspace root
 * `CLAUDE.md`), so this walks up from this package's own install location
 * looking for a `warble/genbi-default` directory next to an ancestor — this
 * works whether the caller runs from the main checkout or a nested git
 * worktree. Callers that already have an explicit `--profile`/`profileSource`
 * never call this. Throws (loud-fail) if no sibling profile is found.
 */
export function resolveDefaultProfileSource(): string {
  let dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const maxDepth = 10;
  for (let i = 0; i < maxDepth; i += 1) {
    const parent = path.dirname(dir);
    const candidate = path.join(parent, "warble", "genbi-default");
    if (existsSync(candidate)) return candidate;
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  throw new Error(
    'no default profile source found (searched ancestors of this package for "<ancestor\'s ' +
      'parent>/warble/genbi-default"); pass --profile explicitly',
  );
}

/**
 * Resolves the committed genbi-setup IR (`warble/genbi-setup/ir.golden.json`)
 * via the same sibling-repo walk as `resolveDefaultProfileSource`. Unlike
 * that function, this one does NOT hard-fail when no sibling is found — only
 * the setup wizard's agentic connect step needs this IR, so a bootstrap-mode
 * BFF instance that never uses `/api/setup/connect` should still boot fine
 * without it. Callers should surface a clear error at the point of actually
 * dispatching a setup turn if this returns `undefined`, not at boot.
 */
export function resolveDefaultSetupIrPath(): string | undefined {
  let dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const maxDepth = 10;
  for (let i = 0; i < maxDepth; i += 1) {
    const parent = path.dirname(dir);
    const candidate = path.join(parent, "warble", "genbi-setup", "ir.golden.json");
    if (existsSync(candidate)) return candidate;
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return undefined;
}

/**
 * Resolves the committed genbi-enrich-context IR
 * (`warble/genbi-enrich-context/ir.golden.json`) via the same sibling-repo
 * walk as `resolveDefaultSetupIrPath`. This profile's `context_precondition`
 * ("an existing pinned Wren project ... that parses and has a successful
 * build proof") is a host runtime obligation, not something the compiled IR
 * itself is validated against.
 *
 * This used to say the golden was "dispatched against whichever project is
 * actually bound at runtime via --project". That was the bug: a golden is the
 * profile compiled once against its own fixture binding, so dispatching it
 * described warble's example project's schema to an agent working on someone
 * else's. An enrichment draft now compiles against the bound project (see the
 * runner's `profileSource`), and this path remains only as the prebuilt
 * fallback for a caller that has no profile source. Does NOT hard-fail when no
 * sibling is found — only an enrichment draft call needs this; a BFF
 * instance that never starts an enrichment run should still boot fine
 * without it. Callers should surface a clear error at the point of actually
 * dispatching a draft turn if this returns `undefined`, not at boot.
 */
export function resolveDefaultEnrichIrPath(): string | undefined {
  let dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const maxDepth = 10;
  for (let i = 0; i < maxDepth; i += 1) {
    const parent = path.dirname(dir);
    const candidate = path.join(parent, "warble", "genbi-enrich-context", "ir.golden.json");
    if (existsSync(candidate)) return candidate;
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return undefined;
}
