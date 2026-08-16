import { accessSync, constants as fsConstants, existsSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ResolvedCli } from "./agent-sdk-cli.js";

export class CodexLocalCliNotFoundError extends Error {
  constructor(attempts: readonly string[]) {
    super(`could not resolve the warble-codex-local CLI:\n${attempts.map((attempt) => `  - ${attempt}`).join("\n")}`);
    this.name = "CodexLocalCliNotFoundError";
  }
}

export async function resolveCodexLocalCli(explicit?: string): Promise<ResolvedCli> {
  if (explicit !== undefined) return { command: explicit, prefixArgs: [] };

  const fromPath = resolveOnPath("warble-codex-local");
  if (fromPath !== undefined) return { command: fromPath, prefixArgs: [] };

  const sibling = findSiblingDevInvocation();
  if (sibling !== undefined) return sibling;

  throw new CodexLocalCliNotFoundError([
    'not found on PATH as "warble-codex-local"',
    'no sibling "warble/dispatcher/codex-local" package with a tsx dev entry was found',
  ]);
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
