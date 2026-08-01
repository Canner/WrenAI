import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(testDir, "..", "fixtures");

export function readFixture(name: string): unknown {
  const raw = readFileSync(path.join(fixturesDir, name), "utf-8");
  return JSON.parse(raw);
}
