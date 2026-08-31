import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Locates a local checkout of the `warble` repository, for the opt-in tests that
 * exercise the real compiler, its dispatchers and its example projects instead
 * of a synthetic bundle.
 *
 * Resolution mirrors what the harness itself does at run time (see
 * `harness/compile/resolve-binary.ts`): walk up from this package looking for a
 * sibling `warble` directory. `WREN_TEST_WARBLE_REPO` overrides it for a
 * checkout that isn't a sibling. A candidate is recognised by Warble's own
 * shared Hub component library (`hub/components`) — the GenBI profiles no
 * longer identify a Warble checkout, since they live in this package now.
 *
 * Returns `undefined` when there is none — which is the normal case for a fresh
 * clone, and why every caller gates its suite on the paths existing rather than
 * assuming them. Nothing here may assume a particular machine's directory
 * layout: an absolute path baked into a test is a promise only its author's
 * filesystem can keep.
 */
export function findWarbleCheckout(): string | undefined {
  const override = process.env["WREN_TEST_WARBLE_REPO"];
  if (override !== undefined && override !== "") {
    return existsSync(path.join(override, "hub", "components")) ? override : undefined;
  }

  let dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const maxDepth = 10;
  for (let i = 0; i < maxDepth; i += 1) {
    const parent = path.dirname(dir);
    const candidate = path.join(parent, "warble");
    if (existsSync(path.join(candidate, "hub", "components"))) return candidate;
    if (parent === dir) break; // reached the filesystem root
    dir = parent;
  }
  return undefined;
}

/**
 * The warble checkout, or a path that is guaranteed not to exist when there is
 * none. Callers feed this straight into their `existsSync` gate, so a missing
 * checkout skips the suite instead of throwing at module load.
 */
export const WARBLE_REPO = findWarbleCheckout() ?? path.join(path.sep, "nonexistent-warble-checkout");
