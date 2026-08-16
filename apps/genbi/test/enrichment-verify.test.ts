/**
 * The three defect shapes below are not invented: a live enrichment draft
 * produced all of them on 2026-08-06. Each is deterministically refutable, and
 * each has a case here naming the ladder step that refutes it — because the
 * point of this module is that none of them should ever have needed a human to
 * notice.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyProposal } from "../server/enrichment-verify.js";
import type { VerificationStep } from "../server/enrichment-verify.js";
import type { EnrichmentBinding, EnrichmentOperation, EnrichmentProposal } from "../server/enrichment.js";

let workspace: string;
let projectDir: string;

beforeEach(() => {
  workspace = mkdtempSync(path.join(tmpdir(), "wren-enrich-verify-test-"));
  projectDir = path.join(workspace, "acme");
  mkdirSync(path.join(projectDir, "models", "orders"), { recursive: true });
  writeFileSync(path.join(projectDir, "wren_project.yml"), "name: acme\ndata_source: duckdb\n");
  writeFileSync(path.join(projectDir, ".env"), "DUCKDB_URL=/tmp/acme\n");
  writeFileSync(path.join(projectDir, "models", "orders", "metadata.yml"), "name: orders\n");
});

afterEach(() => rmSync(workspace, { recursive: true, force: true }));

const binding: () => EnrichmentBinding = () => ({ path: projectDir, identity: "dev:ino", generation: 1, revision: "rev-1" });

function operation(overrides: Partial<EnrichmentOperation> = {}): EnrichmentOperation {
  return {
    id: "op-1",
    sink: "cubes/order_metrics/metadata.yml",
    risk: "high",
    summary: "adds an order metrics cube",
    confidence: "high",
    changeKind: "new_cube",
    draft: "name: order_metrics\nbase_object: orders\nmeasures:\n  - name: total\n    expression: SUM(amount)\n",
    ...overrides,
  };
}

function proposal(...operations: EnrichmentOperation[]): EnrichmentProposal {
  return { id: "prop-1", hash: "sha256:abc", projectRevision: "rev-1", operations: operations.length > 0 ? operations : [operation()] };
}

/** Records what the ladder asked for, so ordering and short-circuiting are observable. */
function recorder(outcomes: Partial<Record<string, { stdout?: string; stderr?: string; error?: NodeJS.ErrnoException | null }>> = {}) {
  const calls: string[] = [];
  const run = async (args: readonly string[], cwd: string) => {
    const key = args.slice(0, 2).join(" ");
    calls.push(key);
    // `cube query --sql-only` prints the generated SQL; the ladder feeds that to
    // dry-run. Default to a plausible generation so cases can focus on one step.
    const fallback: { stdout?: string; stderr?: string; error?: NodeJS.ErrnoException | null } =
      key === "cube query" ? { stdout: 'SELECT SUM(units_on_hand) AS total FROM inventory\n' } : {};
    const outcome = outcomes[key] ?? fallback;
    // Prove the ladder runs somewhere that is not the bound project.
    expect(cwd).not.toBe(projectDir);
    return { stdout: outcome.stdout ?? "", stderr: outcome.stderr ?? "", error: outcome.error ?? null };
  };
  return { calls, run };
}

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

describe("verifyProposal — the three defects a live draft actually produced", () => {
  it("refutes non-Wren cube grammar at the grammar step", async () => {
    // The live draft wrote model/columns/metrics — plausible, and another
    // product's vocabulary entirely.
    const { run, calls } = recorder();
    const verdict = await verifyProposal(
      proposal(operation({ draft: "name: order_metrics\nmodel: orders\ncolumns:\n  - amount\nmetrics:\n  - total\n" })),
      binding(),
      { run },
    );
    expect(verdict.status).toBe("refuted");
    if (verdict.status !== "refuted") return;
    expect(verdict.refutation.step).toBe("grammar");
    expect(verdict.refutation.reason).toMatch(/"columns".*not Wren's grammar|not Wren's grammar/);
    // Cheapest-first: nothing was executed at all for a defect readable off the text.
    expect(calls).toEqual([]);
  });

  it("refutes an unresolvable column reference in a cube measure", async () => {
    // The live draft invented `quantity_on_hand` where the schema had
    // `units_on_hand`. Grammar and YAML structure are both fine.
    //
    // The first version of this module planned `SELECT * FROM "<cube>"` and
    // believed that resolved the measure. Verified against a real project, it
    // does not: a cube is not a FROM-able relation, so that query fails with
    // `table not found` for EVERY cube, sound or not — catching nothing while
    // refuting everything. `context validate` and `context build` both accept
    // the invented column and compile it into target/mdl.json.
    const { run, calls } = recorder({
      "dry-run --sql": { error: Object.assign(new Error("exit 1"), { code: "1" }) as NodeJS.ErrnoException, stderr: 'Binder Error: Referenced column "quantity_on_hand" not found in FROM clause!' },
    });
    const verdict = await verifyProposal(proposal(), binding(), { run });
    expect(verdict.status).toBe("refuted");
    if (verdict.status !== "refuted") return;
    expect(verdict.refutation.reason).toContain("quantity_on_hand");
    expect(calls).toEqual(["context validate", "context build", "cube query", "dry-run --sql"]);
  });

  it("never probes a cube as though it were a relation", async () => {
    // The regression that makes the case above meaningful: if this ever goes
    // back to `SELECT * FROM "<cube>"`, every cube proposal is refuted with a
    // misleading `table not found` and no invented column is ever caught.
    const seen: string[] = [];
    const run = async (args: readonly string[]) => {
      seen.push(args.join(" "));
      return { stdout: args[0] === "cube" ? "SELECT 1\n" : "", stderr: "", error: null };
    };
    await verifyProposal(proposal(), binding(), { run });
    expect(seen.some((call) => call.startsWith("dry-plan"))).toBe(false);
    expect(seen.some((call) => /SELECT \* FROM "order_metrics"/.test(call))).toBe(false);
  });

  it("still plans a view or model as a relation, where that does resolve", async () => {
    const { run, calls } = recorder({
      "dry-plan --sql": { error: Object.assign(new Error("exit 1"), { code: "1" }) as NodeJS.ErrnoException, stderr: "column quantity_on_hand not found" },
    });
    const verdict = await verifyProposal(
      proposal(operation({ id: "op-v", sink: "views/order_totals/metadata.yml", changeKind: "new_view", draft: "name: order_totals\nstatement: SELECT SUM(quantity_on_hand) FROM orders\n" })),
      binding(),
      { run },
    );
    expect(verdict.status).toBe("refuted");
    if (verdict.status !== "refuted") return;
    expect(verdict.refutation.step).toBe("dry_plan");
    expect(calls).toEqual(["context validate", "context build", "dry-plan --sql"]);
  });

  it("refuses a sink that passes through a symlink instead of following it", async () => {
    // `fs.cp` does not dereference symlinks, so a symlink in the bound project
    // is copied AS a symlink into the shadow. The containment check is lexical
    // — it never touches the filesystem — so it passes, and `writeFile` would
    // then follow the link and write OUTSIDE the shadow, defeating the
    // guarantee this module states about never touching anything real.
    const outside = path.join(workspace, "outside.yml");
    writeFileSync(outside, "untouched\n");
    mkdirSync(path.join(projectDir, "cubes", "order_metrics"), { recursive: true });
    symlinkSync(outside, path.join(projectDir, "cubes", "order_metrics", "metadata.yml"));

    const { run } = recorder();
    const verdict = await verifyProposal(proposal(), binding(), { run });
    expect(verdict.status).toBe("refuted");
    if (verdict.status !== "refuted") return;
    expect(verdict.refutation.step).toBe("sink");
    expect(verdict.refutation.reason).toMatch(/symlink/);
    expect(readFileSync(outside, "utf-8")).toBe("untouched\n");
  });

  it("refutes a sink that escapes the project", async () => {
    // canonicalizeProposal's sink contract already rejects this shape before a
    // proposal reaches here; the ladder asserts it again rather than trusting
    // an upstream guarantee about a path it is about to write to.
    const { run } = recorder();
    const verdict = await verifyProposal(proposal(operation({ sink: "../../etc/metadata.yml" })), binding(), { run });
    expect(verdict.status).toBe("refuted");
    if (verdict.status !== "refuted") return;
    expect(verdict.refutation.step).toBe("sink");
  });
});

describe("verifyProposal — the ladder's contract", () => {
  it("leaves the bound project byte-identical, including when a step fails", async () => {
    const before = treeDigest(projectDir);
    const { run } = recorder({ "context validate": { error: Object.assign(new Error("exit 1"), { code: "1" }) as NodeJS.ErrnoException, stderr: "invalid" } });
    await verifyProposal(proposal(), binding(), { run });
    expect(treeDigest(projectDir)).toBe(before);
  });

  it("leaves the bound project byte-identical when a step throws", async () => {
    const before = treeDigest(projectDir);
    const verdict = await verifyProposal(proposal(), binding(), {
      run: async () => {
        throw new Error("boom");
      },
    });
    expect(verdict.status).toBe("unavailable");
    expect(treeDigest(projectDir)).toBe(before);
  });

  it("stops at the first refutation rather than running the rest of the ladder", async () => {
    const { run, calls } = recorder({ "context validate": { error: Object.assign(new Error("exit 1"), { code: "1" }) as NodeJS.ErrnoException, stderr: "bad yaml" } });
    await verifyProposal(proposal(), binding(), { run });
    expect(calls).toEqual(["context validate"]);
  });

  it("reaches the data source only for a cube, and only after the local steps pass", async () => {
    // Nothing local resolves a cube's expressions, so the alternative to this
    // round trip is not checking cubes at all. `dry-run` parses and validates
    // without returning rows.
    const cube = recorder();
    await verifyProposal(proposal(), binding(), { run: cube.run });
    expect(cube.calls).toEqual(["context validate", "context build", "cube query", "dry-run --sql"]);

    // A view resolves locally, so it never reaches the source.
    const view = recorder();
    await verifyProposal(
      proposal(operation({ id: "op-v", sink: "views/order_totals/metadata.yml", changeKind: "new_view", draft: "name: order_totals\nstatement: SELECT 1\n" })),
      binding(),
      { run: view.run },
    );
    expect(view.calls).not.toContain("dry-run --sql");
  });

  it("binds the verdict to the proposal hash and project revision it was earned against", async () => {
    const { run } = recorder();
    const verdict = await verifyProposal({ ...proposal(), hash: "sha256:specific", projectRevision: "rev-9" }, binding(), { run });
    expect(verdict.proposalHash).toBe("sha256:specific");
    expect(verdict.projectRevision).toBe("rev-9");
  });

  it("reports an unrunnable checker as unavailable, never as verified", async () => {
    // "We could not check" and "we checked and it holds" must not be the same
    // value, or a broken checker becomes an approval.
    const { run } = recorder({ "context validate": { error: Object.assign(new Error("spawn wren ENOENT"), { code: "ENOENT" }) as NodeJS.ErrnoException } });
    const verdict = await verifyProposal(proposal(), binding(), { run });
    expect(verdict.status).toBe("unavailable");
    if (verdict.status !== "unavailable") return;
    expect(verdict.reason).toContain("not on PATH");
  });

  it("verifies a sound proposal and reports the steps it actually ran", async () => {
    const { run } = recorder();
    const verdict = await verifyProposal(proposal(), binding(), { run });
    expect(verdict.status).toBe("verified");
    if (verdict.status !== "verified") return;
    const expected: VerificationStep[] = ["sink", "grammar", "validate", "build", "dry_plan", "dry_run"];
    expect(verdict.stepsRun).toEqual(expected);
  });

  it("plans nothing for a change with no queryable object, rather than inventing a probe", async () => {
    const { run, calls } = recorder();
    const verdict = await verifyProposal(
      proposal(operation({ id: "op-k", sink: "knowledge/orders.md", changeKind: "knowledge_append", risk: "low", draft: "Orders are counted at fulfilment.\n" })),
      binding(),
      { run },
    );
    expect(verdict.status).toBe("verified");
    expect(calls).toEqual(["context validate", "context build"]);
  });
});
