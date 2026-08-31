import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The GenBI profiles (`genbi-default`, `genbi-setup`, `genbi-enrich-context`,
 * `genbi-monitor`) live in this package's own `profiles/` tree, alongside their
 * committed `ir.golden.json`. The `warble` binary and its dispatchers still
 * come from a sibling Warble checkout (see `harness/compile/resolve-binary.ts`);
 * only the behavior source is ours.
 *
 * Resolution walks up from this module's own location looking for an ancestor
 * that contains `profiles/<id>`, so it works both from the TypeScript sources
 * (`harness/route/`) and from the built bundle (`dist-server/harness/route/`),
 * whether the caller runs from the main checkout or a nested git worktree.
 */
function resolveProfileEntry(...segments: readonly string[]): string | undefined {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  const maxDepth = 10;
  for (let i = 0; i < maxDepth; i += 1) {
    const candidate = path.join(dir, "profiles", ...segments);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return undefined;
}

/**
 * Resolves the v1 default profile (`profiles/genbi-default`). Callers that
 * already have an explicit `--profile`/`profileSource` never call this.
 * Throws (loud-fail) if this package's own profile tree is not present.
 */
export function resolveDefaultProfileSource(): string {
  const resolved = resolveProfileEntry("genbi-default");
  if (resolved !== undefined) return resolved;
  throw new Error(
    'no default profile source found (searched ancestors of this module for "<ancestor>/profiles/' +
      'genbi-default"); pass --profile explicitly',
  );
}

/**
 * Resolves the committed genbi-setup IR (`profiles/genbi-setup/ir.golden.json`)
 * via the same walk as {@link resolveDefaultProfileSource}. Unlike that
 * function, this one does NOT hard-fail when it is absent — only the setup
 * wizard's agentic connect step needs this IR, so a bootstrap-mode BFF instance
 * that never uses `/api/setup/connect` should still boot fine without it.
 * Callers should surface a clear error at the point of actually dispatching a
 * setup turn if this returns `undefined`, not at boot.
 */
export function resolveDefaultSetupIrPath(): string | undefined {
  return resolveProfileEntry("genbi-setup", "ir.golden.json");
}

/**
 * Resolves the committed genbi-enrich-context IR
 * (`profiles/genbi-enrich-context/ir.golden.json`) via the same walk as
 * {@link resolveDefaultSetupIrPath}. This profile's `context_precondition`
 * ("an existing pinned Wren project ... that parses and has a successful
 * build proof") is a host runtime obligation, not something the compiled IR
 * itself is validated against.
 *
 * This used to say the golden was "dispatched against whichever project is
 * actually bound at runtime via --project". That was the bug: a golden is the
 * profile compiled once against its own fixture binding, so dispatching it
 * described the example project's schema to an agent working on someone
 * else's. An enrichment draft now compiles against the bound project (see the
 * runner's `profileSource`), and this path remains only as the prebuilt
 * fallback for a caller that has no profile source. Does NOT hard-fail when it
 * is absent — only an enrichment draft call needs this; a BFF instance that
 * never starts an enrichment run should still boot fine without it. Callers
 * should surface a clear error at the point of actually dispatching a draft
 * turn if this returns `undefined`, not at boot.
 */
export function resolveDefaultEnrichIrPath(): string | undefined {
  return resolveProfileEntry("genbi-enrich-context", "ir.golden.json");
}
