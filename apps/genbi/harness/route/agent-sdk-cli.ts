import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
 * in three tiers, mirroring `resolveWarbleBinary`:
 *
 * 1. `explicit` — if given, treated as a ready-to-run command with no args
 *    prefix (no existence check — a bare name is trusted to resolve on
 *    `PATH` at spawn time, matching a documented override).
 * 2. `PATH` — a bare `"warble-agent-sdk"` that `warble-agent-sdk --help` succeeds against.
 * 3. A sibling `warble` repo's dev-mode invocation:
 *    `<ancestor's parent>/warble/dispatcher/claude-agent-sdk`'s
 *    `node_modules/.bin/tsx src/cli.ts`. Like `resolveWarbleBinary`'s tier 3, this only resolves
 *    in a local development layout with a `warble` checkout next to this repo — a plain clone of
 *    this repo on its own has no such sibling, so tier 3 always falls through for it.
 *
 * Throws {@link AgentSdkCliNotFoundError} (loud-fail) if none of the three work.
 */
export async function resolveAgentSdkCli(explicit?: string): Promise<ResolvedCli> {
  if (explicit !== undefined) {
    return { command: explicit, prefixArgs: [] };
  }

  const attempts: string[] = [];

  if (await isExecutableOnPath("warble-agent-sdk")) {
    return { command: "warble-agent-sdk", prefixArgs: [] };
  }
  attempts.push('not found on PATH (tried running "warble-agent-sdk --help")');

  const sibling = findSiblingDevInvocation();
  if (sibling !== undefined) {
    return sibling;
  }
  attempts.push(
    'no sibling "warble/dispatcher/claude-agent-sdk" package found with a built tsx binary ' +
      '(searched ancestors of this package for "<ancestor\'s parent>/warble/dispatcher/claude-agent-sdk")',
  );

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
