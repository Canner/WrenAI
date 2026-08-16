import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveWarbleBinary } from "../harness/index.js";
import { collectIrTierNames, compileUnboundProfileTierNames } from "../server/runtime-binding.js";
import { WARBLE_REPO } from "./warble-checkout.js";

const DEFAULT_PROFILE = path.join(WARBLE_REPO, "genbi-default");
const SETUP_IR = path.join(WARBLE_REPO, "genbi-setup", "ir.golden.json");

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
