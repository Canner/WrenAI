import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isWarbleSiblingCheckoutDevModeEnabled, resolveInstalledPackageBin } from "../npm-package-resolve.js";

/** A resolved CLI invocation: the executable plus any args that must precede the caller's own args (e.g. a script path for a `tsx <script>` dev-mode invocation). */
export interface ResolvedCli {
  readonly command: string;
  readonly prefixArgs: readonly string[];
}

export class AgentSdkCliNotFoundError extends Error {
  constructor(attempts: readonly string[]) {
    super(`could not resolve the warble-agent-sdk CLI:\n${attempts.map((attempt) => `  - ${attempt}`).join("\n")}`);
    this.name = "AgentSdkCliNotFoundError";
  }
}

/**
 * Resolves the warble `claude-agent-sdk` dispatcher CLI (dispatched's back-end)
 * in four tiers, mirroring `resolveWarbleBinary`:
 *
 * 1. `explicit` — if given, treated as a ready-to-run command with no args
 *    prefix (no existence check — a bare name is trusted to resolve on
 *    `PATH` at spawn time, matching a documented override).
 * 2. The pinned `@warble/claude-agent-sdk` npm package this workspace depends on, run via
 *    `node <dist/cli.js>` rather than relying on the file's own shebang/executable bit.
 * 3. `PATH` — a bare `"warble-agent-sdk"` that `warble-agent-sdk --help` succeeds against. Kept as
 *    a fallback for a standalone install on a machine that hasn't run `pnpm install`.
 * 4. A sibling `warble` repo's dev-mode invocation, gated behind the explicit
 *    `WREN_HARNESS_ALLOW_WARBLE_SIBLING_CHECKOUT=1` opt-in (see
 *    `isWarbleSiblingCheckoutDevModeEnabled`):
 *    `<ancestor's parent>/warble/dispatcher/claude-agent-sdk`'s
 *    `node_modules/.bin/tsx src/cli.ts`. Like `resolveWarbleBinary`'s equivalent tier, this only
 *    resolves in a local development layout with a `warble` checkout next to this repo, and must
 *    not silently win over the pinned package now that tier 2 exists.
 *
 * Throws {@link AgentSdkCliNotFoundError} (loud-fail) if none of the four work.
 */
export async function resolveAgentSdkCli(explicit?: string): Promise<ResolvedCli> {
  if (explicit !== undefined) {
    return { command: explicit, prefixArgs: [] };
  }

  const attempts: string[] = [];

  const packageBin = resolveInstalledPackageBin("@warble/claude-agent-sdk", "warble-agent-sdk");
  if (packageBin !== undefined) {
    return { command: process.execPath, prefixArgs: [packageBin] };
  }
  attempts.push(`"@warble/claude-agent-sdk" is not installed (or declares no "warble-agent-sdk" bin) in this workspace`);

  if (await isExecutableOnPath("warble-agent-sdk")) {
    return { command: "warble-agent-sdk", prefixArgs: [] };
  }
  attempts.push('not found on PATH (tried running "warble-agent-sdk --help")');

  if (isWarbleSiblingCheckoutDevModeEnabled()) {
    const sibling = findSiblingDevInvocation();
    if (sibling !== undefined) {
      return sibling;
    }
    attempts.push(
      'no sibling "warble/dispatcher/claude-agent-sdk" package found with a built tsx binary ' +
        '(searched ancestors of this package for "<ancestor\'s parent>/warble/dispatcher/claude-agent-sdk")',
    );
  } else {
    attempts.push(
      `sibling "warble" checkout dev mode is disabled (set WREN_HARNESS_ALLOW_WARBLE_SIBLING_CHECKOUT=1 to enable it)`,
    );
  }

  throw new AgentSdkCliNotFoundError(attempts);
}

function isExecutableOnPath(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(bin, ["--help"], (error) => resolve(!error));
  });
}

/**
 * Walks up from this package's own directory (two levels below the package
 * root, same convention as `resolveWarbleBinary`'s sibling lookup) looking
 * for `warble/dispatcher/claude-agent-sdk`'s dev-mode `tsx` entry point.
 */
function findSiblingDevInvocation(): ResolvedCli | undefined {
  let dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const maxDepth = 10;
  for (let i = 0; i < maxDepth; i += 1) {
    const parent = path.dirname(dir);
    const pkgDir = path.join(parent, "warble", "dispatcher", "claude-agent-sdk");
    const tsx = path.join(pkgDir, "node_modules", ".bin", "tsx");
    const entry = path.join(pkgDir, "src", "cli.ts");
    if (existsSync(tsx) && existsSync(entry)) {
      return { command: tsx, prefixArgs: [entry] };
    }
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return undefined;
}
