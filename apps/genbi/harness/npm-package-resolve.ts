import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Resolves a binary shipped by an installed npm package's own `bin` field, using Node's module
 * resolution rooted at this file — not `PATH`, and not a directory walk.
 *
 * This is what lets the `warble` binary and its dispatchers resolve to the exact pinned
 * `@warble/*` version declared in `apps/genbi/package.json`, regardless of what else happens to be
 * on `PATH` and regardless of how the current process was launched. `pnpm run <script>` prepends
 * `node_modules/.bin` to `PATH`, so a bare `PATH` probe already tends to find a workspace-installed
 * package when the process was started that way — but a process started directly (`node
 * dist-server/server/bin.js`, a packaged deployment, a test runner) inherits no such `PATH`, and
 * even when it does, `PATH` order rather than the pinned dependency version is what would decide
 * the outcome. Resolving through `require.resolve` instead is deterministic in both cases: it
 * always finds the version this package actually depends on.
 *
 * Returns `undefined` — never throws — when the package isn't installed, declares no matching
 * `bin` entry, or the resolved file doesn't exist on disk, so callers can fall through to their
 * next resolution tier.
 */
export function resolveInstalledPackageBin(packageName: string, binName: string): string | undefined {
  try {
    const pkgJsonPath = resolveInstalledPackageRoot(packageName);
    if (pkgJsonPath === undefined) return undefined;
    const manifestPath = path.join(pkgJsonPath, "package.json");
    const pkg = JSON.parse(readFileSync(manifestPath, "utf8")) as { bin?: string | Record<string, string> };
    const binField = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.[binName];
    if (binField === undefined) return undefined;
    const resolved = path.resolve(pkgJsonPath, binField);
    return existsSync(resolved) ? resolved : undefined;
  } catch {
    return undefined;
  }
}

/** Returns an installed package's canonical root through Node resolution, never by walking PATH. */
export function resolveInstalledPackageRoot(packageName: string): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    return path.dirname(require.resolve(`${packageName}/package.json`));
  } catch {
    return undefined;
  }
}

/**
 * Named, explicit opt-in that re-enables the legacy "sibling `warble` git checkout"
 * development-mode resolution tier in `resolveWarbleBinary`, `resolveAgentSdkCli`, and
 * `resolveCodexLocalCli`. Off by default: once the pinned `@warble/*` packages are installed,
 * silently preferring an ambient sibling checkout over them would make it easy to test against the
 * wrong Warble version without noticing. Set to `"1"` only when deliberately developing GenBI
 * against an uninstalled, unreleased Warble checkout.
 */
export function isWarbleSiblingCheckoutDevModeEnabled(): boolean {
  return process.env.WREN_HARNESS_ALLOW_WARBLE_SIBLING_CHECKOUT === "1";
}
