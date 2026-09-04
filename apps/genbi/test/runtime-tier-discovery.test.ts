import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveWarbleBinary } from "../harness/index.js";
import { collectIrTierNames, compileUnboundProfileTierNames } from "../server/runtime-binding.js";

/** This package's own `profiles/` tree — the GenBI profiles now live here, not in a Warble checkout. */
const PROFILES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "profiles");

const DEFAULT_PROFILE = path.join(PROFILES_DIR, "genbi-default");
const SETUP_IR = path.join(PROFILES_DIR, "genbi-setup", "ir.golden.json");

async function isWarbleAvailable(): Promise<boolean> {
  try {
    await resolveWarbleBinary();
    return true;
  } catch {
    return false;
  }
}

const canRun = existsSync(DEFAULT_PROFILE) && existsSync(SETUP_IR) && (await isWarbleAvailable());

describe.skipIf(!canRun)("unbound runtime tier discovery [opt-in Warble contract]", () => {
  it("compiles genbi-default without a user-project rebind and contains every genbi-setup tier", async () => {
    const runtimeTiers = await compileUnboundProfileTierNames({ profileSource: DEFAULT_PROFILE });
    const setupTiers = collectIrTierNames(JSON.parse(await readFile(SETUP_IR, "utf8")) as unknown);

    expect(runtimeTiers).toEqual(["cheap", "strong"]);
    expect(setupTiers).toEqual(["strong"]);
    expect(setupTiers.every((tier) => runtimeTiers.includes(tier))).toBe(true);
  });
});

/**
 * The shipped profiles bind a context path that resolves only inside a checkout
 * of this repository (`../../../../examples/v5-jaffle`). An installed package
 * has no such path, so a tier read that compiles cannot work there — that is
 * what took the Setup form's tier rows out in `0.0.1`.
 *
 * This reproduces the installed layout rather than describing it: the profile
 * is copied somewhere the bound path does not resolve, and no `warbleBin` is
 * passed. It fails on any implementation that shells out to Warble, which is
 * the point — a test that merely reads tiers from a healthy checkout passes
 * either way and proves nothing.
 */
describe("tier discovery on an installed profile [no Warble, unresolvable binding]", () => {
  it("reads the tier contract from the golden IR beside the profile", async () => {
    const staged = await mkdtemp(path.join(tmpdir(), "genbi-installed-profile-"));
    try {
      const profileDir = path.join(staged, "profiles", "genbi-default");
      await mkdir(path.join(profileDir, "context"), { recursive: true });
      for (const file of ["profile.yml", "ir.golden.json"]) {
        await copyFile(path.join(DEFAULT_PROFILE, file), path.join(profileDir, file));
      }
      await copyFile(
        path.join(DEFAULT_PROFILE, "context", "binding.yml"),
        path.join(profileDir, "context", "binding.yml"),
      );

      // The copy is only a faithful reproduction if the bound path really is
      // gone; assert that rather than trusting the staging layout.
      const binding = await readFile(path.join(profileDir, "context", "binding.yml"), "utf8");
      const bound = /^project:\s*(.+)$/m.exec(binding)?.[1]?.trim();
      expect(bound).toBeDefined();
      expect(existsSync(path.resolve(profileDir, bound as string))).toBe(false);

      await expect(compileUnboundProfileTierNames({ profileSource: profileDir })).resolves.toEqual([
        "cheap",
        "strong",
      ]);
    } finally {
      await rm(staged, { recursive: true, force: true });
    }
  });
});
