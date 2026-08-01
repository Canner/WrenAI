import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..");

describe("package scaffold", () => {
  it("pins the ai package to a v7 minor", async () => {
    const packageJson = await import(path.join(repoRoot, "package.json"), {
      with: { type: "json" },
    });
    const aiVersionRange: string = packageJson.default.dependencies.ai;
    expect(aiVersionRange).toMatch(/^[~^]?7\.0\./);
  });

  it("keeps an isolated harness/providers module directory", () => {
    expect(existsSync(path.join(repoRoot, "harness", "providers"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "harness", "providers", "index.ts"))).toBe(true);
  });
});
