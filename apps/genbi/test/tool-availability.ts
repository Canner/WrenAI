import { spawnSync } from "node:child_process";

/**
 * Whether an external CLI this package shells out to is present and runnable.
 *
 * A few tests exercise real tooling rather than a mock — the `wren` binary, a
 * provider CLI, Warble's own producer preflight. On a developer machine those
 * tools are installed and the tests are meaningful; on a bare CI runner they are
 * not there at all, and the tests were failing rather than opting out. Guard
 * them with `describe.skipIf(!hasTool("wren"))` so a clean machine skips them,
 * which is what this package's README has always claimed happens.
 *
 * Probed once per process: these are `--version` calls, and a suite that runs
 * hundreds of tests should not pay for them repeatedly.
 */
const probed = new Map<string, boolean>();

export function hasTool(command: string, versionFlag = "--version"): boolean {
  const cached = probed.get(command);
  if (cached !== undefined) return cached;
  let available = false;
  try {
    available = spawnSync(command, [versionFlag], { stdio: "ignore", timeout: 10_000 }).status === 0;
  } catch { available = false; }
  probed.set(command, available);
  return available;
}
