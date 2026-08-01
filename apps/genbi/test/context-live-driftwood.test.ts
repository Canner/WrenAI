import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeKnowledgeStatus } from "../server/context-files.js";
import { mapContextShowToOverview } from "../server/context-map.js";
import { loadContextShow } from "../server/context-source.js";
import { computeImpact } from "../server/impact.js";

/**
 * Opt-in end-to-end coverage (skipped by default, no flag needed) for
 * The whole real-project pipeline: `wren context show` -> overview remap ->
 * impact graph, run against a real built project rather than a fixture. Gated
 * on both a real `wren` binary and a pre-built project being present, mirroring
 * test/e2e-wren-native.test.ts's gating — this is the only other test in the
 * suite that shells out to a real `wren`.
 */
// No default: this needs a real, populated wren project, and there is no
// portable place to guess one — point WREN_TEST_PROJECT at a built project to
// opt in. Without it the suite skips, rather than passing only on a machine
// that happens to have one at some assumed path.
const DEFAULT_PROJECT_DIR = path.join(path.sep, "nonexistent-wren-project");
const projectDir = process.env["WREN_TEST_PROJECT"] ?? DEFAULT_PROJECT_DIR;

function isWrenOnPath(): boolean {
  try {
    execFileSync("wren", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const canRun = existsSync(path.join(projectDir, "wren_project.yml")) && existsSync(path.join(projectDir, "target", "mdl.json")) && isWrenOnPath();

describe.skipIf(!canRun)("context pipeline against a real, pre-built wren project [opt-in e2e]", () => {
  it("loadContextShow returns real models/relationships/cubes, non-empty", async () => {
    const contextShow = await loadContextShow(projectDir);
    expect(contextShow.models.length).toBeGreaterThan(0);
    expect(contextShow.relationships.length).toBeGreaterThan(0);
    expect(contextShow.cubes.length).toBeGreaterThan(0);
  });

  it("mapContextShowToOverview produces a wire-shaped overview with no fabricated position field", async () => {
    const contextShow = await loadContextShow(projectDir);
    const knowledge = computeKnowledgeStatus(projectDir);
    const overview = mapContextShowToOverview(contextShow, "driftwood", projectDir, knowledge);
    expect(overview.models.length).toBe(contextShow.models.length);
    expect(overview.models.every((m) => !("position" in m))).toBe(true);
    expect(overview.knowledge.instructionsPresent).toBe(true); // driftwood ships knowledge/rules/*.md
    expect(overview.knowledge.verifiedPairCount).toBe(0);
  });

  it("computeImpact walks the real relationship graph for a known model", async () => {
    const contextShow = await loadContextShow(projectDir);
    const seedModel = contextShow.models.find((m) => contextShow.relationships.some((r) => r.models.includes(m.name)));
    expect(seedModel).toBeDefined();
    const impact = computeImpact(contextShow, seedModel!.name);
    expect(impact.blastRadius.downstream.length).toBeGreaterThan(0);
    expect(impact.blastRadius.severity).toBe("structural");
    expect(impact.brokenPairs).toEqual([]);
  });
});
