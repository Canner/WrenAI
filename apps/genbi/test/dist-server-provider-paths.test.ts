import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards `scripts/copy-providers.js` (wired into `pnpm run build`): without
 * it, `dist-server/providers/` is never created, and `InProcessSetupRunner`'s
 * `DEFAULT_SETUP_PROVIDER_PATH` / `compileProfile`'s `DEFAULT_WREN_PROVIDER_PATH`
 * — both resolved relative to their own compiled file location — point at a
 * file that doesn't exist. `pnpm run start:bff` then fails the moment setup
 * or in-process dispatch reads its bundled provider fragment.
 *
 * This deliberately imports the COMPILED `dist-server/harness/**\/*.js`
 * modules (not the `harness/**\/*.ts` source) and checks the exact path
 * those modules compute for themselves — re-deriving the same
 * `path.join(..., "..", "..", "providers", ...)` here and checking it
 * against the source tree would prove nothing about the built layout this
 * bug is actually about.
 *
 * Requires a real `pnpm run build` to have run first (this suite is `vitest
 * run` against source, which never populates `dist-server/`). When
 * `dist-server/` is absent, the assertions below are skipped — loudly, via
 * `console.warn` plus a named `it.skip` — rather than silently passing.
 */

const testDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(testDir, "..");
const distServerDir = path.join(packageRoot, "dist-server");
const distServerBuilt = existsSync(distServerDir);

if (!distServerBuilt) {
  // eslint-disable-next-line no-console
  console.warn(
    '[dist-server-provider-paths.test.ts] SKIPPED: "dist-server/" not found. ' +
      'Run `pnpm run build` in apps/genbi, then re-run `pnpm test`, to actually ' +
      "exercise the built-layout provider-path guard. This run did NOT verify it.",
  );
}

it.skipIf(!distServerBuilt)(
  'dist-server/ not built — this run did NOT verify the built-layout provider-path guard (run `pnpm run build` first)',
  () => {
    // Intentionally empty: this test's only job is to show up as a visible,
    // named skip (not a silent pass) when the real guard below can't run.
  },
);

describe.skipIf(!distServerBuilt)("bundled provider fragments resolve from the BUILT dist-server layout", () => {
  it("InProcessSetupRunner's default setup provider path exists after a real build", async () => {
    const runnerModulePath = path.join(distServerDir, "harness", "setup", "runner.js");
    expect(existsSync(runnerModulePath)).toBe(true);

    const mod = (await import(runnerModulePath)) as { DEFAULT_SETUP_PROVIDER_PATH: string };
    expect(mod.DEFAULT_SETUP_PROVIDER_PATH.startsWith(distServerDir)).toBe(true);
    expect(existsSync(mod.DEFAULT_SETUP_PROVIDER_PATH)).toBe(true);
  });

  it("compileProfile's default wren provider path exists after a real build", async () => {
    const pipelineModulePath = path.join(distServerDir, "harness", "compile", "pipeline.js");
    expect(existsSync(pipelineModulePath)).toBe(true);

    const mod = (await import(pipelineModulePath)) as { DEFAULT_WREN_PROVIDER_PATH: string };
    expect(mod.DEFAULT_WREN_PROVIDER_PATH.startsWith(distServerDir)).toBe(true);
    expect(existsSync(mod.DEFAULT_WREN_PROVIDER_PATH)).toBe(true);
  });
});
