import { loadBundle } from "../harness/bundle/loader.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(testDir, "..", "fixtures");

export function readFixture(name: string): unknown {
  const raw = readFileSync(path.join(fixturesDir, name), "utf-8");
  return JSON.parse(raw);
}

/** Historical IR 0.6 noncomposed regression fixtures, not the current profile contract. */
export function loadLegacyFixture(name: "genbi-default.bundle.json" | "genbi-default.native.bundle.json") {
  return loadBundle(readFixture(name), { irVersion: "0.6", bundleVersions: ["0.1"] });
}
