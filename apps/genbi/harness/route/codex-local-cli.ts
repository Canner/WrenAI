import { accessSync, constants as fsConstants, existsSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ResolvedCli } from "./agent-sdk-cli.js";
import { isWarbleSiblingCheckoutDevModeEnabled, resolveInstalledPackageBin } from "../npm-package-resolve.js";

export class CodexLocalCliNotFoundError extends Error {
  constructor(attempts: readonly string[]) {
    super(`could not resolve the warble-codex-local CLI:\n${attempts.map((attempt) => `  - ${attempt}`).join("\n")}`);
    this.name = "CodexLocalCliNotFoundError";
  }
}

/**
 * Resolves the warble `codex-local` dispatcher CLI in four tiers, mirroring
 * `resolveAgentSdkCli`/`resolveWarbleBinary`:
 *
 * 1. `explicit` — trusted as-is, no existence check.
 * 2. The pinned `@warble/codex-local` npm package this workspace depends on, run via
 *    `node <dist/cli.js>`.
 * 3. `PATH` — a `warble-codex-local` executable found by walking `PATH` directly (this resolver's
 *    existing convention, unlike `resolveAgentSdkCli`'s `--help` probe).
 * 4. A sibling `warble` repo's dev-mode invocation, gated behind the explicit
 *    `WREN_HARNESS_ALLOW_WARBLE_SIBLING_CHECKOUT=1` opt-in — must not silently win over the pinned
 *    package now that tier 2 exists.
 *
 * Throws {@link CodexLocalCliNotFoundError} (loud-fail) if none of the four work.
 */
export async function resolveCodexLocalCli(explicit?: string): Promise<ResolvedCli> {
  if (explicit !== undefined) return { command: explicit, prefixArgs: [] };

  const attempts: string[] = [];

  const packageBin = resolveInstalledPackageBin("@warble/codex-local", "warble-codex-local");
  if (packageBin !== undefined) return { command: process.execPath, prefixArgs: [packageBin] };
  attempts.push(`"@warble/codex-local" is not installed (or declares no "warble-codex-local" bin) in this workspace`);

  const fromPath = resolveOnPath("warble-codex-local");
  if (fromPath !== undefined) return { command: fromPath, prefixArgs: [] };
  attempts.push('not found on PATH as "warble-codex-local"');

  if (isWarbleSiblingCheckoutDevModeEnabled()) {
    const sibling = findSiblingDevInvocation();
    if (sibling !== undefined) return sibling;
    attempts.push('no sibling "warble/dispatcher/codex-local" package with a tsx dev entry was found');
  } else {
    attempts.push(
      `sibling "warble" checkout dev mode is disabled (set WREN_HARNESS_ALLOW_WARBLE_SIBLING_CHECKOUT=1 to enable it)`,
    );
  }

  throw new CodexLocalCliNotFoundError(attempts);
}

function resolveOnPath(binaryName: string): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, binaryName);
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Keep searching.
    }
  }
  return undefined;
}

function findSiblingDevInvocation(): ResolvedCli | undefined {
  let dir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  for (let i = 0; i < 10; i += 1) {
    const parent = dirname(dir);
    const pkgDir = join(parent, "warble", "dispatcher", "codex-local");
    const tsx = join(pkgDir, "node_modules", ".bin", "tsx");
    const entry = join(pkgDir, "src", "cli.ts");
    if (existsSync(tsx) && existsSync(entry)) return { command: tsx, prefixArgs: [entry] };
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}
