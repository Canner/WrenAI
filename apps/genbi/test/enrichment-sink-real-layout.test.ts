import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalizeProposal } from "../server/enrichment.js";

/**
 * Opt-in end-to-end coverage (skipped by default if `wren` isn't on PATH, no
 * flag needed), following the same `describe.skipIf` convention as
 * `e2e-nested-datasource-pin.test.ts`.
 *
 * Root cause under test: `server/enrichment.ts`'s per-`changeKind` sink
 * patterns must match the file layout a *real* Wren project actually has on
 * disk, not a shape re-derived from memory. A previous version of the
 * `knowledge_append` pattern (`^knowledge/[a-z0-9_-]+\.md$`) matched a flat
 * `knowledge/<file>.md` path that `wren context init` never produces, and
 * rejected the two-level `knowledge/<category>/<file>.md` shape it always
 * does. This test drives the real CLI to scaffold a project, walks the
 * `knowledge/` tree it actually creates, and feeds every resulting relative
 * path through `canonicalizeProposal` — so a hand-written fixture can never
 * quietly drift away from what the CLI really ships again.
 */
function isWrenOnPath(): boolean {
  try {
    execFileSync("wren", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const canRun = isWrenOnPath();

/** A minimal, otherwise-valid draft proposal body for one operation. */
function proposalFor(sink: string) {
  return {
    operations: [
      {
        changeKind: "knowledge_append",
        sink,
        summary: "note",
        draft: "content",
        confidence: "high",
      },
    ],
  };
}

describe.skipIf(!canRun)("knowledge_append sink pattern vs a real 'wren context init' layout [opt-in e2e, real wren CLI]", () => {
  let projectDir: string | undefined;

  afterEach(() => {
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    projectDir = undefined;
  });

  it("accepts every knowledge/<category>/<file>.md path 'wren context init' actually scaffolds, and none other", () => {
    projectDir = mkdtempSync(path.join(tmpdir(), "wren-enrich-real-layout-"));
    execFileSync("wren", ["context", "init", "--path", projectDir, "--empty"], { encoding: "utf-8" });

    const knowledgeDir = path.join(projectDir, "knowledge");
    const categories = readdirSync(knowledgeDir).filter((entry) => statSync(path.join(knowledgeDir, entry)).isDirectory());

    // The real skeleton is never flat: there is at least one category
    // subdirectory, and every real markdown sink lives two levels deep.
    expect(categories.length).toBeGreaterThan(0);

    for (const category of categories) {
      const sink = `knowledge/${category}/general.md`;
      // Must not throw: this is the exact shape a real project uses.
      expect(() => canonicalizeProposal(proposalFor(sink), "rev-1")).not.toThrow();
    }

    // The shape the old, buggy pattern accepted is never what a real project
    // produces, and must stay rejected.
    expect(() => canonicalizeProposal(proposalFor("knowledge/general.md"), "rev-1")).toThrow(
      /does not match the required layout/,
    );
  });

  it("still refuses knowledge_append sinks outside the real category set, and mdl_metric sinks outside models/<name>/metadata.yml", () => {
    projectDir = mkdtempSync(path.join(tmpdir(), "wren-enrich-real-layout-2-"));
    execFileSync("wren", ["context", "init", "--path", projectDir, "--empty"], { encoding: "utf-8" });

    expect(() => canonicalizeProposal(proposalFor("knowledge/not-a-real-category/general.md"), "rev-1")).toThrow(
      /does not match the required layout/,
    );

    const mdlMetricProposal = (sink: string) => ({
      operations: [{ changeKind: "mdl_metric", sink, summary: "note", draft: "content", confidence: "high" }],
    });
    // `models/<name>/metadata.yml` is the real sink for every model-scoped
    // change kind (see server/context-files.ts) regardless of which model
    // `wren context init --empty` did or didn't scaffold.
    expect(() => canonicalizeProposal(mdlMetricProposal("models/orders/metadata.yml"), "rev-1")).not.toThrow();
    expect(() => canonicalizeProposal(mdlMetricProposal("models/orders/description.md"), "rev-1")).toThrow(
      /does not match the required layout/,
    );
  });
});
