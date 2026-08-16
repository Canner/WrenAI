import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyProposal } from "../server/enrichment-verify.js";
import type { EnrichmentBinding, EnrichmentOperation, EnrichmentProposal } from "../server/enrichment.js";

/**
 * Opt-in end-to-end coverage (skipped by default if `wren` isn't on PATH, no
 * flag needed), following the same `describe.skipIf` convention as
 * `e2e-nested-datasource-pin.test.ts` and `enrichment-sink-real-layout.test.ts`.
 *
 * Root cause under test: `verifyProposal`'s shadow-copy ladder is supposed to
 * be byte-identical-safe for the bound project no matter what — that is its
 * whole reason to exist (see the module doc in `enrichment-verify.ts`). But
 * the existing "byte-identical" regression in `enrichment-verify.test.ts`
 * uses a *mocked* `run`, so it can never observe what the real `execFile`
 * call actually does with this process's ambient environment.
 *
 * `wren` resolves its project via `WREN_PROJECT_HOME` (when set) BEFORE
 * cwd-based discovery (`discover_project_path()` in
 * `core/wren/src/wren/context.py`). GenBI itself sets `WREN_PROJECT_HOME` for
 * native session children (`server/native-sessions.ts`, `server/bin.ts`), so
 * if it is ever set in the BFF process's own ambient environment while a
 * verification runs, an unpinned `execFile` would inherit it — and every
 * ladder step would resolve the BOUND project instead of the shadow copy,
 * even though `cwd` is the shadow. `context build` writes `target/mdl.json`
 * into whatever project it resolves, which makes the leak directly
 * observable: if it leaks, the bound project stops being byte-identical.
 *
 * This test sets `WREN_PROJECT_HOME` to the real bound project directory —
 * the exact condition that actually corrupted a bound project in a live
 * session — and drives the real, non-mocked `verifyProposal`. Before the fix
 * (removing the `env: { WREN_PROJECT_HOME: cwd }` pin in `runWren` makes this
 * fail): `context build` writes `target/mdl.json` into the bound project,
 * changing its tree digest. After the fix, the bound project's tree is
 * untouched no matter what this process's ambient `WREN_PROJECT_HOME` says.
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

function treeDigest(dir: string): string {
  const hash = createHash("sha256");
  const walk = (current: string) => {
    for (const entry of readdirSync(current).sort()) {
      const full = path.join(current, entry);
      hash.update(path.relative(dir, full));
      if (statSync(full).isDirectory()) walk(full);
      else hash.update(readFileSync(full));
    }
  };
  walk(dir);
  return hash.digest("hex");
}

function operation(overrides: Partial<EnrichmentOperation> = {}): EnrichmentOperation {
  return {
    id: "op-1",
    sink: "knowledge/rules/general.md",
    risk: "low",
    summary: "adds a rule",
    confidence: "high",
    changeKind: "knowledge_append",
    draft: "Orders are counted at fulfilment.\n",
    ...overrides,
  };
}

function proposal(...operations: EnrichmentOperation[]): EnrichmentProposal {
  return { id: "prop-1", hash: "sha256:abc", projectRevision: "rev-1", operations: operations.length > 0 ? operations : [operation()] };
}

describe.skipIf(!canRun)("verifyProposal vs an ambient WREN_PROJECT_HOME pointed at the bound project [opt-in e2e, real wren CLI]", () => {
  let boundProjectDir: string | undefined;
  let previousProjectHome: string | undefined;
  let hadPreviousProjectHome = false;

  afterEach(() => {
    if (boundProjectDir) rmSync(boundProjectDir, { recursive: true, force: true });
    boundProjectDir = undefined;
    if (hadPreviousProjectHome) {
      process.env.WREN_PROJECT_HOME = previousProjectHome;
    } else {
      delete process.env.WREN_PROJECT_HOME;
    }
    hadPreviousProjectHome = false;
  });

  it("leaves the bound project byte-identical to real 'wren' subcommands even when this process's own WREN_PROJECT_HOME points at it", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "wren-enrich-home-leak-"));
    boundProjectDir = path.join(workspace, "bound-project");
    execFileSync("wren", ["context", "init", "--path", boundProjectDir, "--empty", "--data-source", "duckdb"], { encoding: "utf-8" });

    // Sanity: the real CLI does write target/mdl.json into whatever project
    // it resolves — if it never wrote anything at all, this test would prove
    // nothing about a leak.
    const validateBaseline = execFileSync("wren", ["context", "build", "--path", boundProjectDir], { encoding: "utf-8" });
    expect(validateBaseline).toMatch(/Built: 0 models, 0 views/);
    rmSync(path.join(boundProjectDir, "target"), { recursive: true, force: true });

    const before = treeDigest(boundProjectDir);

    // The exact condition this test exists to catch: this process's own
    // ambient environment carries WREN_PROJECT_HOME pointed at the bound
    // project, exactly as GenBI sets it for native session children.
    hadPreviousProjectHome = "WREN_PROJECT_HOME" in process.env;
    previousProjectHome = process.env.WREN_PROJECT_HOME;
    process.env.WREN_PROJECT_HOME = boundProjectDir;

    const binding: EnrichmentBinding = { path: boundProjectDir, identity: "dev:ino", generation: 1, revision: "rev-1" };
    const verdict = await verifyProposal(proposal(), binding); // real runWren, no mock

    // The ladder must actually have run (not "unavailable" — that would
    // prove nothing either), and it must have resolved the operation's own
    // sink correctly against the shadow, not the bound project.
    expect(verdict.status).not.toBe("unavailable");

    expect(treeDigest(boundProjectDir)).toBe(before);
    // Named explicitly, not just implied by the digest: prove no leaked
    // target/ ever appeared in the bound project.
    expect(readdirSync(boundProjectDir)).not.toContain("target");
  }, 30_000);
});
