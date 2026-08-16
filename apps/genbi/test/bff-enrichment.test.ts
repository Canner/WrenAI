import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthChoice } from "../harness/index.js";
import { createApp } from "../server/app.js";
import { Store } from "../server/db.js";
import { hashEnrichmentOperation, resolveEnrichmentBinding, resolveProjectIdentity, type EnrichmentApprovalProvider, type EnrichmentApprovalRequest } from "../server/enrichment.js";
import { createModeBEnrichmentDraftRunner } from "../server/enrichment-runner.js";
import type { TurnDeps } from "../server/turn.js";

const dirs: string[] = [];
function project(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "genbi-enrichment-")); dirs.push(dir);
  mkdirSync(path.join(dir, "target")); writeFileSync(path.join(dir, "wren_project.yml"), "name: demo\n"); writeFileSync(path.join(dir, "target", "mdl.json"), '{"models":[{"name":"orders"}]}');
  return dir;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

const testApprovalProvider: EnrichmentApprovalProvider = {
  attest: async (input) => ({
    evidenceRef: `evidence-${input.runId}`,
    nonce: `nonce-${input.runId}-${input.operation.id}`,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    binding: input.binding,
    proposalHash: input.proposalHash,
    operationHash: input.operation.hash,
  }),
};

/**
 * These suites are about the ledger, decisions, approvals and apply. Whether a
 * drafted document survives the verification ladder is `enrichment-verify`'s
 * subject and has its own suite; stubbing a pass here keeps each case testing
 * what it is named for.
 */
const passVerification = async (proposal: { hash: string; projectRevision: string }) =>
  ({ status: "verified" as const, proposalHash: proposal.hash, projectRevision: proposal.projectRevision, stepsRun: [] });

function build(bound = true, withApply = true, crash = false, approvalProvider: EnrichmentApprovalProvider | null = testApprovalProvider, draft: unknown = { id: "forged", hash: "forged", projectRevision: "forged", operations: [{ id: "op-low", sink: "knowledge/rules/business.md", changeKind: "knowledge_append", risk: "low", summary: "Append a glossary entry", draft: "Term: order", confidence: 0.9 }, { id: "op-high", sink: "cubes/revenue/metadata.yml", changeKind: "new_cube", risk: "low", summary: "Add a metric", draft: "cube: revenue", confidence: 0.8 }] }, applyFailure?: string) {
  const userProject = project(); const store = new Store(":memory:");
  if (bound) {
    store.setSetupSteps(store.getSetupSteps().map((step) => step.key === "bind" ? { ...step, state: "done" } : step));
    store.activateEnrichmentBinding(resolveEnrichmentBinding(userProject));
  }
  const deps: TurnDeps = {
    store, baseRouteOptions: { authChoice: { mode: "api-key", adapter: "mock" }, profileSource: "fixture", userProject }, route: async () => ({ backend: "agent", warnings: [], kind: "answer", envelope: { blocks: [], summary: "ok" }, trace: { steps: [] } }),
    enrichmentRunner: { draft: async () => draft }, verifyEnrichmentProposal: passVerification,
    ...(approvalProvider !== null ? { enrichmentApprovalProvider: approvalProvider } : {}),
    ...(withApply ? { enrichmentApplyRunner: { apply: async () => { if (applyFailure) throw new Error(applyFailure); if (crash) throw new Error("external write outcome unknown"); return { validationDigest: "validate:ok", buildDigest: "build:ok" }; }, reconcile: async () => ({ state: crash ? "applied" as const : "not_applied" as const, ...(crash ? { validationDigest: "validate:ok", buildDigest: "build:ok" } : {}) }) } } : {}),
  };
  return { app: createApp(deps), store, userProject };
}

describe("bindProject foundation: resolveProjectIdentity + activateEnrichmentBinding", () => {
  it("binds an unbuilt project without throwing, canonicalizes the path, and advances generation on every call including a rebind to the same directory", () => {
    // Regression for the bug where binding required the enrichment revision
    // (target/mdl.json) as a precondition. This exercises the foundation
    // primitives directly -- the same two calls server/bin.ts's real
    // bindProject makes -- independent of any route, to isolate AC2's
    // "bindProject never throws / still canonicalizes, records identity,
    // advances generation on every call including rebind" from the
    // route-level "connect completes past bind" regression above.
    const unbuilt = mkdtempSync(path.join(tmpdir(), "genbi-bind-unbuilt-"));
    dirs.push(unbuilt);
    writeFileSync(path.join(unbuilt, "wren_project.yml"), "name: acme\n");
    // No target/mdl.json anywhere in this test: bindProject must never need one.
    const store = new Store(":memory:");

    function bindProject(dir: string) {
      const identity = resolveProjectIdentity(dir);
      store.activateEnrichmentBinding(identity);
      return identity;
    }

    const first = bindProject(unbuilt);
    expect(first.path).toBe(resolveProjectIdentity(unbuilt).path);
    const afterFirst = store.getEnrichmentBinding();
    expect(afterFirst?.generation).toBe(1);
    expect(afterFirst?.path).toBe(first.path);
    expect(afterFirst?.identity).toBe(first.identity);

    // Rebind to the SAME directory: must still succeed and still advance
    // generation -- generation tracks bind events, not a change of target.
    const second = bindProject(unbuilt);
    expect(second.path).toBe(first.path);
    expect(second.identity).toBe(first.identity);
    const afterSecond = store.getEnrichmentBinding();
    expect(afterSecond?.generation).toBe(2);
    expect(afterSecond?.path).toBe(first.path);
    expect(afterSecond?.identity).toBe(first.identity);

    // Still no target/mdl.json anywhere -- confirms bindProject never read/required one.
    expect(existsSync(path.join(unbuilt, "target", "mdl.json"))).toBe(false);
  });
});

describe("post-bind enrichment BFF", () => {
  it("hydrates numeric confidence from an existing REAL-affinity enrichment ledger as display text", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "genbi-enrichment-real-confidence-")); dirs.push(dir);
    const dbPath = path.join(dir, "legacy.sqlite");
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`CREATE TABLE enrichment_operations (
      run_id TEXT NOT NULL, operation_id TEXT NOT NULL, sink TEXT NOT NULL, risk TEXT NOT NULL,
      summary TEXT NOT NULL, draft TEXT NOT NULL DEFAULT '', change_kind TEXT NOT NULL DEFAULT 'knowledge_append', confidence REAL NOT NULL,
      decision TEXT, completed INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'awaiting_decision', attempt INTEGER NOT NULL DEFAULT 0,
      lease_token TEXT, lease_expires_at TEXT, idempotency_key TEXT NOT NULL DEFAULT '', PRIMARY KEY (run_id, operation_id)
    )`);
    legacy.close();

    const store = new Store(dbPath);
    const binding = store.activateEnrichmentBinding(resolveEnrichmentBinding(project()));
    const run = store.createEnrichmentRun({
      id: "legacy-confidence",
      mode: "grill",
      binding,
      proposalId: "proposal",
      proposalHash: "hash",
      operations: [{ id: "op", sink: "knowledge/rules/a.md", risk: "low", summary: "summary", draft: "draft", changeKind: "knowledge_append", confidence: 0.85 }],
    });
    expect(store.getEnrichmentOperation(run.id, "op")?.confidence).toBe("0.85");
    store.close();

    const persisted = new DatabaseSync(dbPath, { readOnly: true });
    expect(persisted.prepare("SELECT typeof(confidence) AS storage_type FROM enrichment_operations WHERE run_id = ?").get(run.id)).toEqual({ storage_type: "real" });
    persisted.close();
  });

  it("reports callback readiness without implementation identity and fails closed when drafting is absent", async () => {
    const userProject = project(); const store = new Store(":memory:");
    store.activateEnrichmentBinding(resolveEnrichmentBinding(userProject));
    const app = createApp({ store, baseRouteOptions: { authChoice: { mode: "api-key", adapter: "mock" }, profileSource: "fixture", userProject }, route: async () => ({ backend: "agent", warnings: [], kind: "answer", envelope: { blocks: [], summary: "ok" }, trace: { steps: [] } }) });
    const status = await (await app.request("/api/context/enrichment")).json() as { foundationReady: boolean; capabilities: Record<string, { available: boolean; reason?: string }> };
    expect(status.foundationReady).toBe(true);
    expect(status.capabilities).toEqual({ draft: { available: false, reason: "callback_unavailable" }, apply: { available: false, reason: "callback_unavailable" }, approval: { available: false, reason: "callback_unavailable" }, reconcile: { available: false, reason: "callback_unavailable" } });
    expect(JSON.stringify(status)).not.toMatch(/provider|runner|sdk|model/i);
    expect((await app.request("/api/context/enrichment/start", { method: "POST", body: JSON.stringify({ mode: "grill" }) })).status).toBe(503);
    expect(store.getLatestEnrichmentRun()).toBeUndefined();
  });

  it("is unavailable before bind and does not alter Ask's bind gate", async () => {
    const { app } = build(false);
    expect((await (await app.request("/api/context/enrichment")).json() as { foundationReady: boolean }).foundationReady).toBe(false);
    expect((await app.request("/api/context/enrichment/start", { method: "POST", body: JSON.stringify({ mode: "grill" }) })).status).toBe(409);
  });

  it("refuses a run against a bound-but-unbuilt project without ever throwing out of a route handler", async () => {
    // bindProject (the foundation path) never requires a revision, so an
    // active binding can legitimately point at a project that has never
    // been built. Enrichment must still refuse cleanly here -- lazy
    // revision resolution is not lenient: an unbuilt project stays a
    // legitimate refusal at every enrichment call site.
    const unbuiltProject = mkdtempSync(path.join(tmpdir(), "genbi-enrichment-unbuilt-"));
    dirs.push(unbuiltProject);
    writeFileSync(path.join(unbuiltProject, "wren_project.yml"), "name: demo\n");
    // No target/mdl.json.
    const store = new Store(":memory:");
    // Mirrors server/bin.ts's real bindProject: identity only, no revision.
    store.activateEnrichmentBinding(resolveProjectIdentity(unbuiltProject));
    const app = createApp({
      store,
      baseRouteOptions: { authChoice: { mode: "api-key", adapter: "mock" }, profileSource: "fixture", userProject: unbuiltProject },
      route: async () => ({ backend: "agent", warnings: [], kind: "answer", envelope: { blocks: [], summary: "ok" }, trace: { steps: [] } }),
      enrichmentRunner: { draft: async () => ({ operations: [] }) }, verifyEnrichmentProposal: passVerification,
    });

    const status = await app.request("/api/context/enrichment");
    expect(status.status).toBe(200);
    expect((await status.json() as { foundationReady: boolean }).foundationReady).toBe(false);

    const start = await app.request("/api/context/enrichment/start", { method: "POST", body: JSON.stringify({ mode: "grill" }) });
    expect(start.status).toBe(409);
    expect(await start.json()).toMatchObject({ error: expect.stringContaining("Compile & bind") });
    expect(store.getLatestEnrichmentRun()).toBeUndefined();
  });

  it("accepts direct bound mode without wizard history and rejects an unbound bootstrap", async () => {
    const directProject = project(); const directStore = new Store(":memory:");
    directStore.activateEnrichmentBinding(resolveEnrichmentBinding(directProject));
    const directApp = createApp({ store: directStore, baseRouteOptions: { authChoice: { mode: "api-key", adapter: "mock" }, profileSource: "fixture", userProject: directProject }, route: async () => ({ backend: "agent", warnings: [], kind: "answer", envelope: { blocks: [], summary: "ok" }, trace: { steps: [] } }) });
    expect((await (await directApp.request("/api/context/enrichment")).json() as { foundationReady: boolean }).foundationReady).toBe(true);
    expect((await directApp.request("/api/context/enrichment/start", { method: "POST", body: JSON.stringify({ mode: "grill" }) })).status).toBe(503);
    const bootstrapProject = project(); const bootstrapStore = new Store(":memory:");
    const bootstrapApp = createApp({ store: bootstrapStore, baseRouteOptions: { authChoice: { mode: "api-key", adapter: "mock" }, profileSource: "fixture", userProject: bootstrapProject }, route: async () => ({ backend: "agent", warnings: [], kind: "answer", envelope: { blocks: [], summary: "ok" }, trace: { steps: [] } }) });
    expect((await (await bootstrapApp.request("/api/context/enrichment")).json() as { foundationReady: boolean }).foundationReady).toBe(false);
    expect((await bootstrapApp.request("/api/context/enrichment/start", { method: "POST", body: JSON.stringify({ mode: "grill" }) })).status).toBe(409);
  });

  it("reports a completed wizard bind as enrichment-ready when its canonical binding is active", async () => {
    const { app } = build();
    expect((await (await app.request("/api/context/enrichment")).json() as { foundationReady: boolean }).foundationReady).toBe(true);
  });

  it("omits prior-generation runs after rebind and never serializes internal execution fields", async () => {
    const { app, store, userProject } = build();
    const run = await (await app.request("/api/context/enrichment/start", { method: "POST", body: JSON.stringify({ mode: "grill" }) })).json() as { id: string; proposalHash: string; projectRevision: string; version: number; operations: { id: string }[] };
    const decided = await (await app.request(`/api/context/enrichment/${run.id}/decision`, { method: "POST", body: JSON.stringify({ operationId: run.operations[1]!.id, decision: "accept", proposalHash: run.proposalHash, projectRevision: run.projectRevision, expectedVersion: run.version }) })).json() as { version: number };
    expect((await app.request(`/api/context/enrichment/${run.id}/approval`, { method: "POST", body: JSON.stringify({ operationId: run.operations[1]!.id, proposalHash: run.proposalHash, projectRevision: run.projectRevision, expectedVersion: decided.version }) })).status).toBe(200);
    const detail = await (await app.request(`/api/context/enrichment/${run.id}`)).json();
    expect(JSON.stringify(detail)).not.toMatch(/attempt|leaseToken|leaseExpiresAt|idempotencyKey|validationDigest|buildDigest|applyProof|reconcileProof|evidenceRef|nonce|expiresAt|operationHash|projectPath|projectIdentity/);
    store.activateEnrichmentBinding(resolveEnrichmentBinding(userProject));
    expect((await (await app.request("/api/context/enrichment")).json() as { run?: unknown }).run).toBeUndefined();
  });

  it("publishes only typed per-operation audit summaries and outcome history", async () => {
    const { app, store } = build();
    const run = await (await app.request("/api/context/enrichment/start", { method: "POST", body: JSON.stringify({ mode: "grill" }) })).json() as { id: string };
    store.appendEnrichmentEvent(run.id, "reverted", "do not expose this internal event message");
    const detail = await (await app.request(`/api/context/enrichment/${run.id}`)).json() as { events: { message?: string }[]; audit: { entries: { confidence: string; summary: string; outcome?: string }[]; history: { outcome: string }[] } };
    expect(detail.events.every((event) => event.message === undefined)).toBe(true);
    expect(detail.audit.entries[0]).toMatchObject({ confidence: expect.any(String), summary: expect.any(String) });
    expect(detail.audit.history).toContainEqual({ outcome: "reverted", createdAt: expect.any(String) });
    expect(JSON.stringify(detail)).not.toContain("do not expose this internal event message");
  });

  it("persists a revision-locked Grill proposal and rejects stale/replayed decisions", async () => {
    const { app } = build();
    const started = await app.request("/api/context/enrichment/start", { method: "POST", body: JSON.stringify({ mode: "grill" }) });
    expect(started.status).toBe(201); const run = await started.json() as { id: string; proposalHash: string; projectRevision: string; version: number; mode: string; operations: { id: string }[] };
    expect(run.mode).toBe("grill");
    expect(JSON.stringify(run)).not.toContain("provider");
    const low = run.operations[0]!.id;
    expect((await app.request(`/api/context/enrichment/${run.id}/decision`, { method: "POST", body: JSON.stringify({ operationId: low, decision: "accept", proposalHash: "stale", projectRevision: run.projectRevision, expectedVersion: run.version }) })).status).toBe(409);
    const accepted = await app.request(`/api/context/enrichment/${run.id}/decision`, { method: "POST", body: JSON.stringify({ operationId: low, decision: "accept", proposalHash: run.proposalHash, projectRevision: run.projectRevision, expectedVersion: run.version }) });
    expect(accepted.status).toBe(200);
    // A different operation is still available, so this rejection proves the
    // stale snapshot token rather than merely replaying the first operation.
    expect((await app.request(`/api/context/enrichment/${run.id}/decision`, { method: "POST", body: JSON.stringify({ operationId: run.operations[1]!.id, decision: "accept", proposalHash: run.proposalHash, projectRevision: run.projectRevision, expectedVersion: run.version }) })).status).toBe(409);
    expect((await app.request(`/api/context/enrichment/${run.id}/decision`, { method: "POST", body: JSON.stringify({ operationId: low, decision: "accept", proposalHash: run.proposalHash, projectRevision: run.projectRevision, expectedVersion: run.version }) })).status).toBe(409);
  });

  it("recanonicalizes a bounded browser edit under the current binding and version", async () => {
    const { app } = build();
    const run = await (await app.request("/api/context/enrichment/start", { method: "POST", body: JSON.stringify({ mode: "grill" }) })).json() as { id: string; proposalHash: string; projectRevision: string; version: number; operations: { id: string }[] };
    const paused = await (await app.request(`/api/context/enrichment/${run.id}/decision`, { method: "POST", body: JSON.stringify({ operationId: run.operations[0]!.id, decision: "edit", proposalHash: run.proposalHash, projectRevision: run.projectRevision, expectedVersion: run.version }) })).json() as { version: number };
    const response = await app.request(`/api/context/enrichment/${run.id}/edit`, { method: "POST", body: JSON.stringify({ operationId: run.operations[0]!.id, sink: "cubes/revenue/metadata.yml", changeKind: "new_cube", summary: "Add a governed metric", draft: "cube: gross_margin", confidence: 0.7, risk: "low", proposalHash: "forged", expectedVersion: paused.version }) });
    expect(response.status).toBe(200);
    const edited = await response.json() as { version: number; proposalHash: string; operations: { id: string; risk: string; decision: string | null; state: string; sink: string; confidence: string }[] };
    expect(edited.proposalHash).not.toBe(run.proposalHash);
    expect(edited.operations[0]).toMatchObject({ risk: "high", decision: null, state: "awaiting_decision", sink: "cubes/revenue/metadata.yml", confidence: "0.9" });
    expect(edited.operations[0]?.id).not.toBe(run.operations[0]?.id);
    expect((await app.request(`/api/context/enrichment/${run.id}/edit`, { method: "POST", body: JSON.stringify({ operationId: run.operations[0]!.id, sink: "cubes/revenue/metadata.yml", changeKind: "new_cube", summary: "stale", draft: "cube: stale", confidence: 0.5, expectedVersion: paused.version }) })).status).toBe(409);
  });

  it("rolls back an edited proposal, run version, and event when the edit transaction faults", () => {
    const source = resolveEnrichmentBinding(project());
    let fault = false;
    const store = new Store(":memory:", { onEnrichmentTransitionWrite: (phase) => { if (fault && phase === "after_event") throw new Error("injected edit fault"); } });
    const binding = store.activateEnrichmentBinding(source);
    const run = store.createEnrichmentRun({ id: "edit-fault", mode: "grill", binding, proposalId: "proposal-old", proposalHash: "hash-old", operations: [{ id: "op-old", sink: "knowledge/rules/a.md", changeKind: "knowledge_append", risk: "low", summary: "old", draft: "old", confidence: 0.5 }] });
    expect(store.transitionEnrichmentMetadata({ runId: run.id, expectedVersion: run.version, binding, operation: { id: "op-old", expectedState: "awaiting_decision", expectedDecision: null, decision: "edit", nextState: "awaiting_decision" }, status: "awaiting_decision", event: { kind: "edit", message: "editing" } })).toBe(true);
    const paused = store.getEnrichmentRun(run.id)!;
    const eventsBefore = store.listEnrichmentEvents(run.id).length;
    fault = true;
    expect(() => store.transitionEnrichmentEdit({ runId: run.id, expectedVersion: paused.version, binding, operationId: "op-old", operation: { id: "op-new", sink: "knowledge/rules/a.md", changeKind: "knowledge_append", risk: "low", summary: "new", draft: "new", confidence: 0.8 }, proposalId: "proposal-new", proposalHash: "hash-new", event: { kind: "edited", message: "edited" } })).toThrow("injected edit fault");
    expect(store.getEnrichmentRun(run.id)).toMatchObject({ proposalId: "proposal-old", proposalHash: "hash-old", version: paused.version });
    expect(store.getEnrichmentOperation(run.id, "op-old")).toMatchObject({ decision: "edit", state: "awaiting_decision" });
    expect(store.getEnrichmentOperation(run.id, "op-new")).toBeUndefined();
    expect(store.listEnrichmentEvents(run.id)).toHaveLength(eventsBefore);
  });

  it("requires a host approval for high-risk changes and fails closed without apply transport", async () => {
    const { app } = build(true, false);
    const run = await (await app.request("/api/context/enrichment/start", { method: "POST", body: JSON.stringify({ mode: "grill" }) })).json() as { id: string; proposalHash: string; projectRevision: string; version: number; operations: { id: string }[] };
    const decision = await app.request(`/api/context/enrichment/${run.id}/decision`, { method: "POST", body: JSON.stringify({ operationId: run.operations[1]!.id, decision: "accept", proposalHash: run.proposalHash, projectRevision: run.projectRevision, expectedVersion: run.version }) });
    const decided = await decision.json() as { status: string; version: number };
    expect(decided).toMatchObject({ status: "awaiting_approval" });
    const approval = await app.request(`/api/context/enrichment/${run.id}/approval`, { method: "POST", body: JSON.stringify({ operationId: run.operations[1]!.id, proposalHash: run.proposalHash, projectRevision: run.projectRevision, expectedVersion: decided.version }) });
    const body = await approval.json() as { error?: string };
    expect(JSON.stringify(body)).toContain("host callback");
  });

  it("does not let a browser forge an approval when the host callback is absent", async () => {
    const { app, store } = build(true, true, false, null);
    const run = await (await app.request("/api/context/enrichment/start", { method: "POST", body: JSON.stringify({ mode: "grill" }) })).json() as { id: string; proposalHash: string; projectRevision: string; version: number; operations: { id: string }[] };
    const decided = await (await app.request(`/api/context/enrichment/${run.id}/decision`, { method: "POST", body: JSON.stringify({ operationId: run.operations[1]!.id, decision: "accept", proposalHash: run.proposalHash, projectRevision: run.projectRevision, expectedVersion: run.version }) })).json() as { version: number };
    const approval = await app.request(`/api/context/enrichment/${run.id}/approval`, { method: "POST", body: JSON.stringify({ operationId: run.operations[1]!.id, proposalHash: run.proposalHash, projectRevision: run.projectRevision, expectedVersion: decided.version, attestation: { evidenceRef: "forged-evidence-0001", nonce: "forged-nonce-0001" } }) });
    expect(approval.status).toBe(503);
    expect(store.getEnrichmentRun(run.id)?.version).toBe(decided.version);
    expect(store.getEnrichmentOperation(run.id, run.operations[1]!.id)?.state).toBe("awaiting_approval");
  });

  it("rejects mismatched, expired, and replayed approval attestations without minting authorization", async () => {
    const rejectedProviders: readonly EnrichmentApprovalProvider[] = [
      { attest: async (input) => ({ evidenceRef: "evidence-mismatch-0001", nonce: "nonce-mismatch-0001", expiresAt: new Date(Date.now() + 60_000).toISOString(), binding: { ...input.binding, generation: input.binding.generation + 1 }, proposalHash: input.proposalHash, operationHash: input.operation.hash }) },
      { attest: async (input) => ({ evidenceRef: "evidence-expired-0001", nonce: "nonce-expired-0001", expiresAt: new Date(Date.now() - 60_000).toISOString(), binding: input.binding, proposalHash: input.proposalHash, operationHash: input.operation.hash }) },
    ];
    for (const provider of rejectedProviders) {
      const { app, store } = build(true, true, false, provider);
      const run = await (await app.request("/api/context/enrichment/start", { method: "POST", body: JSON.stringify({ mode: "grill" }) })).json() as { id: string; proposalHash: string; projectRevision: string; version: number; operations: { id: string }[] };
      const decided = await (await app.request(`/api/context/enrichment/${run.id}/decision`, { method: "POST", body: JSON.stringify({ operationId: run.operations[1]!.id, decision: "accept", proposalHash: run.proposalHash, projectRevision: run.projectRevision, expectedVersion: run.version }) })).json() as { version: number };
      expect((await app.request(`/api/context/enrichment/${run.id}/approval`, { method: "POST", body: JSON.stringify({ operationId: run.operations[1]!.id, proposalHash: run.proposalHash, projectRevision: run.projectRevision, expectedVersion: decided.version }) })).status).toBe(503);
      expect(store.hasExactEnrichmentAttestation(run.id, run.operations[1]!.id)).toBe(false);
    }

    const replayProvider: EnrichmentApprovalProvider = { attest: async (input) => ({ evidenceRef: "evidence-replay-0001", nonce: "nonce-replay-0001", expiresAt: new Date(Date.now() + 60_000).toISOString(), binding: input.binding, proposalHash: input.proposalHash, operationHash: input.operation.hash }) };
    const { app } = build(true, true, false, replayProvider);
    for (let index = 0; index < 2; index += 1) {
      const run = await (await app.request("/api/context/enrichment/start", { method: "POST", body: JSON.stringify({ mode: "grill" }) })).json() as { id: string; proposalHash: string; projectRevision: string; version: number; operations: { id: string }[] };
      const decided = await (await app.request(`/api/context/enrichment/${run.id}/decision`, { method: "POST", body: JSON.stringify({ operationId: run.operations[1]!.id, decision: "accept", proposalHash: run.proposalHash, projectRevision: run.projectRevision, expectedVersion: run.version }) })).json() as { version: number };
      const response = await app.request(`/api/context/enrichment/${run.id}/approval`, { method: "POST", body: JSON.stringify({ operationId: run.operations[1]!.id, proposalHash: run.proposalHash, projectRevision: run.projectRevision, expectedVersion: decided.version }) });
      expect(response.status).toBe(index === 0 ? 200 : 409);
    }
  });

  it("autopilot completes only the leading low-risk operation then pauses at escalation", async () => {
    const { app } = build();
    const body = await (await app.request("/api/context/enrichment/start", { method: "POST", body: JSON.stringify({ mode: "autopilot" }) })).json() as { status: string; operations: { id: string; completed: boolean }[] };
    expect(body.status).toBe("awaiting_approval");
    expect(body.operations[0]?.completed).toBe(true);
    expect(body.operations[1]?.completed).toBe(false);
  });

  it("fails closed when the bound revision changes after drafting", async () => {
    const { app, userProject } = build();
    const run = await (await app.request("/api/context/enrichment/start", { method: "POST", body: JSON.stringify({ mode: "grill" }) })).json() as { id: string; proposalHash: string; projectRevision: string; version: number; operations: { id: string }[] };
    writeFileSync(path.join(userProject, "target", "mdl.json"), '{"models":[{"name":"changed"}]}');
    const accepted = await app.request(`/api/context/enrichment/${run.id}/decision`, { method: "POST", body: JSON.stringify({ operationId: run.operations[0]!.id, decision: "accept", proposalHash: run.proposalHash, projectRevision: run.projectRevision, expectedVersion: run.version }) });
    expect(JSON.stringify(await accepted.json())).toContain("revision changed");
  });

  it("reconciles an ambiguous external write with the same idempotency key and never reapplies", async () => {
    const { app } = build(true, true, true);
    const run = await (await app.request("/api/context/enrichment/start", { method: "POST", body: JSON.stringify({ mode: "grill" }) })).json() as { id: string; proposalHash: string; projectRevision: string; version: number; operations: { id: string }[] };
    await app.request(`/api/context/enrichment/${run.id}/decision`, { method: "POST", body: JSON.stringify({ operationId: run.operations[0]!.id, decision: "accept", proposalHash: run.proposalHash, projectRevision: run.projectRevision, expectedVersion: run.version }) });
    const accepted = await (await app.request(`/api/context/enrichment/${run.id}/approval`, { method: "POST", body: JSON.stringify({ operationId: run.operations[0]!.id, proposalHash: run.proposalHash, projectRevision: run.projectRevision, expectedVersion: run.version + 1 }) })).json() as { status: string; version: number; operations: { state: string }[] };
    expect(accepted.status).toBe("reconcile_required"); expect(accepted.operations[0]?.state).toBe("reconcile_required");
    const retried = await (await app.request(`/api/context/enrichment/${run.id}/retry`, { method: "POST", body: JSON.stringify({ expectedVersion: accepted.version }) })).json() as { operations: { state: string }[] };
    expect(retried.operations[0]).toMatchObject({ state: "applied" });
  });

  it("canonicalizes symlinks and advances generation on every bind, including the same path", () => {
    const target = project(); const link = `${target}-link`; symlinkSync(target, link); dirs.push(link);
    const store = new Store(":memory:");
    const first = store.activateEnrichmentBinding(resolveEnrichmentBinding(link));
    const second = store.activateEnrichmentBinding(resolveEnrichmentBinding(target));
    expect(first.path).toBe(resolveEnrichmentBinding(target).path);
    expect(first.identity).toBe(second.identity);
    expect(second.generation).toBe(first.generation + 1);
  });

  it("rejects a rebind that occurs while the draft callback is awaiting, persisting a 'drafting' run visible mid-flight that resolves to 'failed' rather than vanishing", async () => {
    // Regression for the bug where a run was created only from the resolved
    // draft, so a run that never gets that far (rebind, throw, restart, or a
    // client that simply stops waiting) left the DB with zero rows and the
    // UI with nothing to show for minutes of real dispatch. The run must
    // exist, and be visible via GET, for the entire in-flight window, and
    // must land on a terminal status here -- never disappear.
    const first = project(); const second = project(); const store = new Store(":memory:");
    store.setSetupSteps(store.getSetupSteps().map((step) => step.key === "bind" ? { ...step, state: "done" } : step));
    store.activateEnrichmentBinding(resolveEnrichmentBinding(first));
    let active = first; let release!: () => void; let entered!: () => void;
    const draft = new Promise<{ operations: [] }>((resolve) => { release = () => resolve({ operations: [] }); });
    const enteredDraft = new Promise<void>((resolve) => { entered = resolve; });
    const app = createApp({ store, baseRouteOptions: { authChoice: { mode: "api-key", adapter: "mock" }, profileSource: "fixture", userProject: first }, getUserProject: () => active, route: async () => ({ backend: "agent", warnings: [], kind: "answer", envelope: { blocks: [], summary: "ok" }, trace: { steps: [] } }), enrichmentRunner: { draft: async () => { entered(); return draft; } }, verifyEnrichmentProposal: passVerification });
    const starting = app.request("/api/context/enrichment/start", { method: "POST", body: JSON.stringify({ mode: "grill" }) });
    await enteredDraft;
    // Visible while the model turn is still in flight, before any draft has
    // resolved -- this is the run a user who reloads mid-Grill must see.
    const midFlight = await (await app.request("/api/context/enrichment")).json() as { run?: { status: string } };
    expect(midFlight.run?.status).toBe("drafting");
    const midFlightId = store.getLatestEnrichmentRun()!.id;
    active = second;
    store.activateEnrichmentBinding(resolveEnrichmentBinding(second));
    release();
    expect((await starting).status).toBe(409);
    const after = store.getLatestEnrichmentRun();
    expect(after?.id).toBe(midFlightId);
    expect(after?.status).toBe("failed");
    expect(after?.errorMessage).toContain("binding changed");
  });

  it("rejects an attestation that returns after a rebind without changing the approval state", async () => {
    const first = project(); const second = project(); const store = new Store(":memory:");
    store.setSetupSteps(store.getSetupSteps().map((step) => step.key === "bind" ? { ...step, state: "done" } : step));
    store.activateEnrichmentBinding(resolveEnrichmentBinding(first));
    let active = first; let entered!: () => void; let release!: (value: Awaited<ReturnType<EnrichmentApprovalProvider["attest"]>>) => void; let approvalInput!: EnrichmentApprovalRequest;
    const deferred = new Promise<Awaited<ReturnType<EnrichmentApprovalProvider["attest"]>>>((resolve) => { release = resolve; });
    const enteredAttestation = new Promise<void>((resolve) => { entered = resolve; });
    const app = createApp({ store, baseRouteOptions: { authChoice: { mode: "api-key", adapter: "mock" }, profileSource: "fixture", userProject: first }, getUserProject: () => active, route: async () => ({ backend: "agent", warnings: [], kind: "answer", envelope: { blocks: [], summary: "ok" }, trace: { steps: [] } }), enrichmentRunner: { draft: async () => ({ operations: [{ sink: "cubes/revenue/metadata.yml", changeKind: "new_cube", summary: "Add a metric", draft: "cube: revenue", confidence: 1 }] }) }, verifyEnrichmentProposal: passVerification, enrichmentApprovalProvider: { attest: async (input) => { approvalInput = input; entered(); return deferred; } } });
    const run = await (await app.request("/api/context/enrichment/start", { method: "POST", body: JSON.stringify({ mode: "grill" }) })).json() as { id: string; proposalHash: string; projectRevision: string; version: number; operations: { id: string }[] };
    const decided = await (await app.request(`/api/context/enrichment/${run.id}/decision`, { method: "POST", body: JSON.stringify({ operationId: run.operations[0]!.id, decision: "accept", proposalHash: run.proposalHash, projectRevision: run.projectRevision, expectedVersion: run.version }) })).json() as { version: number };
    const approving = app.request(`/api/context/enrichment/${run.id}/approval`, { method: "POST", body: JSON.stringify({ operationId: run.operations[0]!.id, proposalHash: run.proposalHash, projectRevision: run.projectRevision, expectedVersion: decided.version }) });
    await enteredAttestation;
    active = second;
    store.activateEnrichmentBinding(resolveEnrichmentBinding(second));
    release({ evidenceRef: "evidence-stale-0001", nonce: "nonce-stale-0001", expiresAt: new Date(Date.now() + 60_000).toISOString(), binding: approvalInput.binding, proposalHash: approvalInput.proposalHash, operationHash: approvalInput.operation.hash });
    expect((await approving).status).toBe(409);
    expect(store.getEnrichmentOperation(run.id, run.operations[0]!.id)?.state).toBe("awaiting_approval");
    expect(store.hasExactEnrichmentAttestation(run.id, run.operations[0]!.id)).toBe(false);
  });

  it("accepts one of two same-version CAS transitions and atomically rolls back operation, run, and event writes on fault", () => {
    const bindingSource = resolveEnrichmentBinding(project());
    const store = new Store(":memory:"); const binding = store.activateEnrichmentBinding(bindingSource);
    const created = store.createEnrichmentRun({ id: "r", mode: "autopilot", binding, proposalId: "p", proposalHash: "h", operations: [{ id: "o", sink: "knowledge/rules/a.md", changeKind: "knowledge_append", risk: "low", summary: "s", draft: "d", confidence: 1 }] });
    const transition = () => store.transitionEnrichmentMetadata({ runId: created.id, expectedVersion: created.version, binding, operation: { id: "o", expectedState: "awaiting_decision", expectedDecision: null, decision: "accept", nextState: "ready" }, status: "ready", event: { kind: "accepted", message: "Accepted knowledge/rules/a.md." } });
    expect([transition(), transition()].filter(Boolean)).toHaveLength(1);
    expect(store.getEnrichmentRun(created.id)?.version).toBe(created.version + 1);

    const faultStore = new Store(":memory:", { onEnrichmentTransitionWrite: (phase) => { if (phase === "after_event") throw new Error("injected transition fault"); } });
    const faultBinding = faultStore.activateEnrichmentBinding(bindingSource);
    const faultRun = faultStore.createEnrichmentRun({ id: "fault", mode: "autopilot", binding: faultBinding, proposalId: "p", proposalHash: "h", operations: [{ id: "o", sink: "knowledge/rules/a.md", changeKind: "knowledge_append", risk: "low", summary: "s", draft: "d", confidence: 1 }] });
    const eventCount = faultStore.listEnrichmentEvents(faultRun.id).length;
    expect(() => faultStore.transitionEnrichmentMetadata({ runId: faultRun.id, expectedVersion: faultRun.version, binding: faultBinding, operation: { id: "o", expectedState: "awaiting_decision", expectedDecision: null, decision: "accept", nextState: "ready" }, status: "ready", event: { kind: "accepted", message: "Accepted knowledge/rules/a.md." } })).toThrow("injected transition fault");
    expect(faultStore.getEnrichmentRun(faultRun.id)).toMatchObject({ version: faultRun.version, status: "awaiting_decision" });
    expect(faultStore.getEnrichmentOperation(faultRun.id, "o")).toMatchObject({ decision: null, state: "awaiting_decision" });
    expect(faultStore.listEnrichmentEvents(faultRun.id)).toHaveLength(eventCount);
  });

  it("rolls back a callback-minted attestation with its operation, run, and event", () => {
    const source = resolveEnrichmentBinding(project());
    const store = new Store(":memory:", { onEnrichmentTransitionWrite: (phase) => { if (phase === "after_event") throw new Error("injected attestation fault"); } });
    const binding = store.activateEnrichmentBinding(source);
    const run = store.createEnrichmentRun({ id: "attestation-fault", mode: "grill", binding, proposalId: "p", proposalHash: "h", operations: [{ id: "o", sink: "cubes/revenue/metadata.yml", changeKind: "new_cube", risk: "high", summary: "s", draft: "d", confidence: 1 }] });
    const operation = store.getEnrichmentOperation(run.id, "o")!;
    const attestation = { evidenceRef: "evidence-fault-0001", nonce: "nonce-fault-0001", expiresAt: new Date(Date.now() + 60_000).toISOString(), binding, proposalHash: run.proposalHash, operationHash: hashEnrichmentOperation(operation) };
    expect(() => store.transitionEnrichmentMetadata({ runId: run.id, expectedVersion: run.version, binding, operation: { id: operation.id, expectedState: "awaiting_decision", expectedDecision: null, decision: "accept", nextState: "ready" }, attestation, status: "ready", event: { kind: "approved", message: "Approved cubes/revenue/metadata.yml." } })).toThrow("injected attestation fault");
    expect(store.getEnrichmentRun(run.id)?.version).toBe(run.version);
    expect(store.getEnrichmentOperation(run.id, operation.id)?.state).toBe("awaiting_decision");
    expect(store.hasExactEnrichmentAttestation(run.id, operation.id)).toBe(false);
  });

  it("rejects malformed or excessive drafts, classifying the persisted run as 'failed' rather than leaving it stuck at 'drafting' or absent, and persists only redacted display text", async () => {
    for (const draft of [{ operations: "not-an-array" }, { operations: [{ sink: "knowledge/rules/a.md", changeKind: "knowledge_append", summary: "x".repeat(513), draft: "safe", confidence: 1 }] }]) {
      const { app, store } = build(true, true, false, testApprovalProvider, draft);
      expect((await app.request("/api/context/enrichment/start", { method: "POST", body: JSON.stringify({ mode: "grill" }) })).status).toBe(400);
      // A contract failure is a classifiable terminal, not an absent run.
      const failed = store.getLatestEnrichmentRun();
      expect(failed?.status).toBe("failed");
      expect(failed?.errorMessage).toBeTruthy();
    }
    const secret = "do-not-store-this-secret";
    const { app, store } = build(true, true, false, testApprovalProvider, { operations: [{ sink: "knowledge/rules/a.md", changeKind: "knowledge_append", summary: `api_key=${secret}`, draft: `prompt: ${secret} provider: claude /Users/agent/private`, confidence: 1, evidence: secret, sessionId: secret }] });
    const started = await app.request("/api/context/enrichment/start", { method: "POST", body: JSON.stringify({ mode: "grill" }) });
    const body = await started.json();
    expect(started.status).toBe(201);
    expect(JSON.stringify(body)).not.toMatch(new RegExp(`${secret}|claude|/Users/agent/private|evidence|sessionId`, "i"));
    expect(JSON.stringify(store.getEnrichmentOperation((body as { id: string }).id, (body as { operations: { id: string }[] }).operations[0]!.id))).not.toContain(secret);
  });

  it("redacts callback diagnostics before they reach public status, events, or errors", async () => {
    const secret = "do-not-leak-this-key";
    const { app } = build(true, true, false, testApprovalProvider, { operations: [{ sink: "knowledge/rules/a.md", changeKind: "knowledge_append", summary: "safe", draft: "safe", confidence: 1 }] }, `api_key=${secret} provider: claude /Users/agent/private`);
    const response = await app.request("/api/context/enrichment/start", { method: "POST", body: JSON.stringify({ mode: "autopilot" }) });
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(JSON.stringify(body)).not.toMatch(new RegExp(`${secret}|claude|/Users/agent/private|api_key`, "i"));
  });

  it("creates a run, every operation, and its draft event atomically", () => {
    const source = resolveEnrichmentBinding(project());
    const store = new Store(":memory:", { onEnrichmentCreationWrite: (phase) => { if (phase === "after_event") throw new Error("injected creation fault"); } });
    const binding = store.activateEnrichmentBinding(source);
    expect(() => store.createEnrichmentRun({ id: "creation-fault", mode: "grill", binding, proposalId: "p", proposalHash: "h", operations: [{ id: "o", sink: "knowledge/rules/a.md", changeKind: "knowledge_append", risk: "low", summary: "s", draft: "d", confidence: 1 }] })).toThrow("injected creation fault");
    expect(store.getEnrichmentRun("creation-fault")).toBeUndefined();
    expect(store.listEnrichmentOperations("creation-fault")).toEqual([]);
    expect(store.listEnrichmentEvents("creation-fault")).toEqual([]);
  });

  it("commits a final skip's operation, terminal run version, and both events together", async () => {
    const { app } = build();
    const run = await (await app.request("/api/context/enrichment/start", { method: "POST", body: JSON.stringify({ mode: "grill" }) })).json() as { id: string; proposalHash: string; projectRevision: string; version: number; operations: { id: string }[] };
    const first = await (await app.request(`/api/context/enrichment/${run.id}/decision`, { method: "POST", body: JSON.stringify({ operationId: run.operations[0]!.id, decision: "skip", proposalHash: run.proposalHash, projectRevision: run.projectRevision, expectedVersion: run.version }) })).json() as { version: number };
    const final = await (await app.request(`/api/context/enrichment/${run.id}/decision`, { method: "POST", body: JSON.stringify({ operationId: run.operations[1]!.id, decision: "skip", proposalHash: run.proposalHash, projectRevision: run.projectRevision, expectedVersion: first.version }) })).json() as { status: string; version: number; events: { kind: string }[] };
    expect(final).toMatchObject({ status: "completed", version: run.version + 2 });
    expect(final.events.slice(-2).map((event) => event.kind)).toEqual(["skip", "completed"]);

    const source = resolveEnrichmentBinding(project());
    const faultStore = new Store(":memory:", { onEnrichmentTransitionWrite: (phase) => { if (phase === "after_event") throw new Error("injected final-skip fault"); } });
    const binding = faultStore.activateEnrichmentBinding(source);
    const faultRun = faultStore.createEnrichmentRun({ id: "final-skip-fault", mode: "grill", binding, proposalId: "p", proposalHash: "h", operations: [{ id: "o", sink: "knowledge/rules/a.md", changeKind: "knowledge_append", risk: "low", summary: "s", draft: "d", confidence: 1 }] });
    expect(() => faultStore.transitionEnrichmentMetadata({ runId: faultRun.id, expectedVersion: faultRun.version, binding, operation: { id: "o", expectedState: "awaiting_decision", expectedDecision: null, decision: "skip", nextState: "skipped" }, status: "completed", event: { kind: "skip", message: "Skipped knowledge/rules/a.md." }, additionalEvents: [{ kind: "completed", message: "Enrichment run completed with host-verified validation and build proof." }] })).toThrow("injected final-skip fault");
    expect(faultStore.getEnrichmentRun(faultRun.id)).toMatchObject({ status: "awaiting_decision", version: faultRun.version });
    expect(faultStore.getEnrichmentOperation(faultRun.id, "o")).toMatchObject({ decision: null, state: "awaiting_decision" });
    expect(faultStore.listEnrichmentEvents(faultRun.id)).toHaveLength(1);
  });

  it("fences execution attempts, preserves the idempotency key, and permits reapply only after trusted not_applied", () => {
    const now = new Date("2026-08-06T00:00:00.000Z");
    const store = new Store(":memory:", { now: () => now });
    const binding = store.activateEnrichmentBinding(resolveEnrichmentBinding(project()));
    const run = store.createEnrichmentRun({ id: "lease", mode: "autopilot", binding, proposalId: "p", proposalHash: "h", operations: [{ id: "o", sink: "knowledge/rules/a.md", changeKind: "knowledge_append", risk: "low", summary: "s", draft: "d", confidence: 1 }] });
    const claim = () => store.transitionEnrichmentExecution({ runId: run.id, expectedVersion: run.version, binding, operationId: "o", expectedStates: ["awaiting_decision"], nextState: "applying", nextAttempt: 1, leaseToken: "lease-1", leaseExpiresAt: "2026-08-06T00:01:00.000Z", status: "ready", event: { kind: "applying", message: "applying" } });
    expect([claim(), claim()].filter(Boolean)).toHaveLength(1);
    const claimed = store.getEnrichmentRun(run.id)!;
    expect(store.getEnrichmentOperation(run.id, "o")).toMatchObject({ attempt: 1, leaseToken: "lease-1", idempotencyKey: "lease:o" });
    // A late completion from a prior fence cannot alter the newer attempt.
    expect(store.transitionEnrichmentExecution({ runId: run.id, expectedVersion: claimed.version, binding, operationId: "o", expectedStates: ["applying"], expectedAttempt: 0, expectedLeaseToken: "lease-1", nextState: "applied", leaseToken: null, leaseExpiresAt: null, completed: true, status: "completed", event: { kind: "applied", message: "late" } })).toBe(false);
    expect(store.transitionEnrichmentExecution({ runId: run.id, expectedVersion: claimed.version, binding, operationId: "o", expectedStates: ["applying"], expectedAttempt: 1, expectedLeaseToken: "lease-1", nextState: "reconcile_required", leaseToken: "lease-1", leaseExpiresAt: null, status: "reconcile_required", event: { kind: "reconcile_required", message: "unknown" } })).toBe(true);
    const ambiguous = store.getEnrichmentRun(run.id)!;
    expect(store.transitionEnrichmentExecution({ runId: run.id, expectedVersion: ambiguous.version, binding, operationId: "o", expectedStates: ["reconcile_required"], expectedAttempt: 1, expectedLeaseToken: "lease-1", nextState: "ready_to_reapply", leaseToken: null, leaseExpiresAt: null, status: "ready", event: { kind: "reconciled_not_applied", message: "not applied" } })).toBe(true);
    const reapplicable = store.getEnrichmentRun(run.id)!;
    expect(store.getEnrichmentOperation(run.id, "o")).toMatchObject({ state: "ready_to_reapply", idempotencyKey: "lease:o" });
    expect(store.transitionEnrichmentExecution({ runId: run.id, expectedVersion: reapplicable.version, binding, operationId: "o", expectedStates: ["ready_to_reapply"], expectedAttempt: 1, expectedLeaseToken: null, nextState: "applying", nextAttempt: 2, leaseToken: "lease-2", leaseExpiresAt: "2026-08-06T00:02:00.000Z", status: "ready", event: { kind: "applying", message: "reapply" } })).toBe(true);
    expect(store.getEnrichmentOperation(run.id, "o")).toMatchObject({ attempt: 2, leaseToken: "lease-2", idempotencyKey: "lease:o" });

    const faultStore = new Store(":memory:", { onEnrichmentTransitionWrite: (phase) => { if (phase === "after_event") throw new Error("injected execution fault"); } });
    const faultBinding = faultStore.activateEnrichmentBinding(resolveEnrichmentBinding(project()));
    const faultRun = faultStore.createEnrichmentRun({ id: "execution-fault", mode: "autopilot", binding: faultBinding, proposalId: "p", proposalHash: "h", operations: [{ id: "o", sink: "knowledge/rules/a.md", changeKind: "knowledge_append", risk: "low", summary: "s", draft: "d", confidence: 1 }] });
    expect(() => faultStore.transitionEnrichmentExecution({ runId: faultRun.id, expectedVersion: faultRun.version, binding: faultBinding, operationId: "o", expectedStates: ["awaiting_decision"], nextState: "applying", nextAttempt: 1, leaseToken: "lease", leaseExpiresAt: "2026-08-06T00:01:00.000Z", status: "ready", event: { kind: "applying", message: "applying" } })).toThrow("injected execution fault");
    expect(faultStore.getEnrichmentRun(faultRun.id)).toMatchObject({ version: faultRun.version, status: "awaiting_decision" });
    expect(faultStore.getEnrichmentOperation(faultRun.id, "o")).toMatchObject({ state: "awaiting_decision", attempt: 0, leaseToken: null });
  });

  it("rejects cancel during applying, reconciliation, and terminal completion", async () => {
    const { app, store, userProject } = build();
    const binding = store.activateEnrichmentBinding(resolveEnrichmentBinding(userProject));
    const run = store.createEnrichmentRun({ id: "cancel-fence", mode: "autopilot", binding, proposalId: "p", proposalHash: "h", operations: [{ id: "o", sink: "knowledge/rules/a.md", changeKind: "knowledge_append", risk: "low", summary: "s", draft: "d", confidence: 1 }] });
    expect(store.transitionEnrichmentExecution({ runId: run.id, expectedVersion: run.version, binding, operationId: "o", expectedStates: ["awaiting_decision"], nextState: "applying", nextAttempt: 1, leaseToken: "lease", leaseExpiresAt: "2099-01-01T00:00:00.000Z", status: "ready", event: { kind: "applying", message: "applying" } })).toBe(true);
    let current = store.getEnrichmentRun(run.id)!;
    expect((await app.request(`/api/context/enrichment/${run.id}/cancel`, { method: "POST", body: JSON.stringify({ expectedVersion: current.version }) })).status).toBe(409);
    expect(store.transitionEnrichmentExecution({ runId: run.id, expectedVersion: current.version, binding, operationId: "o", expectedStates: ["applying"], expectedAttempt: 1, expectedLeaseToken: "lease", nextState: "reconcile_required", leaseToken: "lease", leaseExpiresAt: null, status: "reconcile_required", event: { kind: "reconcile_required", message: "unknown" } })).toBe(true);
    current = store.getEnrichmentRun(run.id)!;
    expect((await app.request(`/api/context/enrichment/${run.id}/cancel`, { method: "POST", body: JSON.stringify({ expectedVersion: current.version }) })).status).toBe(409);
    expect(store.transitionEnrichmentExecution({ runId: run.id, expectedVersion: current.version, binding, operationId: "o", expectedStates: ["reconcile_required"], expectedAttempt: 1, expectedLeaseToken: "lease", nextState: "applied", leaseToken: null, leaseExpiresAt: null, completed: true, status: "completed", validationDigest: "validate:ok", buildDigest: "build:ok", event: { kind: "applied", message: "applied" } })).toBe(true);
    current = store.getEnrichmentRun(run.id)!;
    expect((await app.request(`/api/context/enrichment/${run.id}/cancel`, { method: "POST", body: JSON.stringify({ expectedVersion: current.version }) })).status).toBe(409);
  });

  it("fences a delayed endpoint apply completion after lease expiry into reconciliation", async () => {
    vi.useFakeTimers();
    try {
      const userProject = project(); const store = new Store(":memory:");
      store.setSetupSteps(store.getSetupSteps().map((step) => step.key === "bind" ? { ...step, state: "done" } : step));
      store.activateEnrichmentBinding(resolveEnrichmentBinding(userProject));
      let resolveApply!: (proof: { validationDigest: string; buildDigest: string }) => void;
      const applyDeferred = new Promise<{ validationDigest: string; buildDigest: string }>((resolve) => { resolveApply = resolve; });
      const app = createApp({ store, baseRouteOptions: { authChoice: { mode: "api-key", adapter: "mock" }, profileSource: "fixture", userProject }, route: async () => ({ backend: "agent", warnings: [], kind: "answer", envelope: { blocks: [], summary: "ok" }, trace: { steps: [] } }), enrichmentRunner: { draft: async () => ({ operations: [{ sink: "knowledge/rules/a.md", changeKind: "knowledge_append", summary: "s", draft: "d", confidence: 1 }] }) }, verifyEnrichmentProposal: passVerification, enrichmentApplyRunner: { apply: async () => applyDeferred, reconcile: async () => ({ state: "still_unknown" as const }) } });
      const starting = app.request("/api/context/enrichment/start", { method: "POST", body: JSON.stringify({ mode: "autopilot" }) });
      await vi.advanceTimersByTimeAsync(61_000);
      resolveApply({ validationDigest: "validate:late", buildDigest: "build:late" });
      const response = await starting;
      const run = await response.json() as { status: string; version: number; validationDigest?: string; buildDigest?: string; operations: { state: string }[]; events: { kind: string }[] };
      // Persisting the run in a 'drafting' state before dispatch, then
      // finalizing it once the draft resolves, is itself one extra version
      // bump versus the old single-step create -- version 5 here, not 4.
      expect(run).toMatchObject({ status: "reconcile_required", version: 5 });
      expect(run.validationDigest).toBeUndefined(); expect(run.buildDigest).toBeUndefined();
      expect(run.operations[0]).toMatchObject({ state: "reconcile_required" });
      expect(run.events.map((event) => event.kind)).toContain("lease_expired");
    } finally { vi.useRealTimers(); }
  });

  describe("a run is durable and visible for the entire draft dispatch, not only after it resolves", () => {
    it("shows a 'drafting' run via GET while the draft callback is still in flight, then the same run row as 'awaiting_decision' once it resolves", async () => {
      const userProject = project(); const store = new Store(":memory:");
      store.setSetupSteps(store.getSetupSteps().map((step) => step.key === "bind" ? { ...step, state: "done" } : step));
      store.activateEnrichmentBinding(resolveEnrichmentBinding(userProject));
      // `canonicalizeProposal` rejects an empty `operations` array as an
      // incompatible proposal (see `server/enrichment.ts`), so the resolved
      // draft below must carry at least one valid operation -- the run's
      // OWN `operations` list is still asserted empty while 'drafting',
      // since `finalizeEnrichmentDraft` has not run yet at that point.
      const validOperation = { sink: "knowledge/rules/a.md", changeKind: "knowledge_append", summary: "s", draft: "d", confidence: 1 };
      let release!: (value: { operations: (typeof validOperation)[] }) => void; let entered!: () => void;
      const draft = new Promise<{ operations: (typeof validOperation)[] }>((resolve) => { release = resolve; });
      const enteredDraft = new Promise<void>((resolve) => { entered = resolve; });
      const app = createApp({ store, baseRouteOptions: { authChoice: { mode: "api-key", adapter: "mock" }, profileSource: "fixture", userProject }, route: async () => ({ backend: "agent", warnings: [], kind: "answer", envelope: { blocks: [], summary: "ok" }, trace: { steps: [] } }), enrichmentRunner: { draft: async () => { entered(); return draft; } }, verifyEnrichmentProposal: passVerification });
      const starting = app.request("/api/context/enrichment/start", { method: "POST", body: JSON.stringify({ mode: "grill" }) });
      await enteredDraft;

      const midFlight = await (await app.request("/api/context/enrichment")).json() as { run?: { id: string; status: string; operations: unknown[] } };
      expect(midFlight.run).toMatchObject({ status: "drafting", operations: [] });
      const midFlightId = midFlight.run!.id;

      release({ operations: [validOperation] });
      const started = await (await starting).json() as { id: string; status: string };
      expect(started.id).toBe(midFlightId);
      expect(started.status).toBe("awaiting_decision");
      expect(store.getEnrichmentRun(midFlightId)?.status).toBe("awaiting_decision");
    });

    it("resolves to a classifiable 'failed' terminal, never leaving the run stuck at 'drafting', when the draft callback throws", async () => {
      // `build()`'s own `applyFailure` parameter only ever wires into
      // `enrichmentApplyRunner.apply`, never into `enrichmentRunner.draft`
      // (see its signature above), so a *draft*-throw case cannot be
      // expressed through `build()` -- construct the app directly instead,
      // matching the sibling in-flight tests in this describe block.
      const userProject = project(); const store = new Store(":memory:");
      store.setSetupSteps(store.getSetupSteps().map((step) => step.key === "bind" ? { ...step, state: "done" } : step));
      store.activateEnrichmentBinding(resolveEnrichmentBinding(userProject));
      const app = createApp({ store, baseRouteOptions: { authChoice: { mode: "api-key", adapter: "mock" }, profileSource: "fixture", userProject }, route: async () => ({ backend: "agent", warnings: [], kind: "answer", envelope: { blocks: [], summary: "ok" }, trace: { steps: [] } }), enrichmentRunner: { draft: async () => { throw new Error("the draft subprocess exited unexpectedly"); } }, verifyEnrichmentProposal: passVerification });
      const response = await app.request("/api/context/enrichment/start", { method: "POST", body: JSON.stringify({ mode: "grill" }) });
      expect(response.status).toBe(503);
      const body = await response.json() as { error: string };
      expect(body.error).toContain("draft subprocess exited unexpectedly");
      const run = store.getLatestEnrichmentRun();
      expect(run?.status).toBe("failed");
      expect(run?.errorMessage).toContain("draft subprocess exited unexpectedly");
    });

    it("still resolves the run to a classifiable terminal even when nothing ever reads the HTTP response -- the server-side persistence, not a client that stuck around, is what makes the run durable", async () => {
      // There is no cancellation token wired from the HTTP layer into
      // `enrichmentRunner.draft()` for this route (deliberately -- SSE/abort
      // wiring is a separate follow-up), so a real client walking away
      // cannot interrupt the in-flight dispatch either: the request handler
      // keeps running to completion regardless of whether anyone is still
      // listening. That is exactly the property under test here: kick off
      // the request, confirm dispatch has started, and NEVER consume the
      // resulting Response -- only the store is asserted on, standing in
      // for "the browser tab closed".
      const userProject = project(); const store = new Store(":memory:");
      store.setSetupSteps(store.getSetupSteps().map((step) => step.key === "bind" ? { ...step, state: "done" } : step));
      store.activateEnrichmentBinding(resolveEnrichmentBinding(userProject));
      // `canonicalizeProposal` rejects an empty `operations` array as an
      // incompatible proposal (see `server/enrichment.ts`), so the resolved
      // draft below must carry at least one valid operation, exactly like
      // the sibling "durable and visible" test above.
      const validOperation = { sink: "knowledge/rules/a.md", changeKind: "knowledge_append", summary: "s", draft: "d", confidence: 1 };
      let release!: (value: { operations: (typeof validOperation)[] }) => void; let entered!: () => void;
      const draft = new Promise<{ operations: (typeof validOperation)[] }>((resolve) => { release = resolve; });
      const enteredDraft = new Promise<void>((resolve) => { entered = resolve; });
      const app = createApp({ store, baseRouteOptions: { authChoice: { mode: "api-key", adapter: "mock" }, profileSource: "fixture", userProject }, route: async () => ({ backend: "agent", warnings: [], kind: "answer", envelope: { blocks: [], summary: "ok" }, trace: { steps: [] } }), enrichmentRunner: { draft: async () => { entered(); return draft; } }, verifyEnrichmentProposal: passVerification });
      const abandoned = app.request("/api/context/enrichment/start", { method: "POST", body: JSON.stringify({ mode: "grill" }) });
      void Promise.resolve(abandoned).catch(() => {}); // the "client" never inspects this
      await enteredDraft;
      expect(store.getLatestEnrichmentRun()?.status).toBe("drafting");
      release({ operations: [validOperation] });
      // Synchronize the test's own timing on the still-running handler
      // WITHOUT using its result for anything -- standing in for the wall
      // clock passing while nobody is reading the response.
      await abandoned;
      expect(store.getLatestEnrichmentRun()?.status).toBe("awaiting_decision");
    });
  });

  describe("a run interrupted by a BFF restart is reconciled to a terminal state on the next boot, not left running forever", () => {
    it("converts an orphaned 'drafting' run to 'failed' when the store reopens against the same file, mirroring reconcileOrphanedSetupTurns for turns", () => {
      const dbDir = mkdtempSync(path.join(tmpdir(), "genbi-enrichment-restart-store-"));
      dirs.push(dbDir);
      const dbPath = path.join(dbDir, "bff.sqlite");
      const source = resolveEnrichmentBinding(project());

      const beforeRestart = new Store(dbPath);
      const binding = beforeRestart.activateEnrichmentBinding(source);
      const orphan = beforeRestart.createDraftingEnrichmentRun({ id: "orphaned-draft", mode: "grill", binding });
      expect(orphan.status).toBe("drafting");
      beforeRestart.close();

      const reopened = new Store(dbPath);
      const run = reopened.getEnrichmentRun("orphaned-draft");
      expect(run?.status).toBe("failed");
      expect(run?.errorMessage).toContain("BFF restart");
      expect(run?.version).toBe(2);
      const events = reopened.listEnrichmentEvents("orphaned-draft").map((event) => event.kind);
      expect(events).toEqual(["started", "failed"]);
    });

    it("leaves an already-terminal run (and an unrelated in-progress setup turn) untouched across a restart", () => {
      const dbDir = mkdtempSync(path.join(tmpdir(), "genbi-enrichment-restart-noop-"));
      dirs.push(dbDir);
      const dbPath = path.join(dbDir, "bff.sqlite");
      const source = resolveEnrichmentBinding(project());

      const beforeRestart = new Store(dbPath);
      const binding = beforeRestart.activateEnrichmentBinding(source);
      const finished = beforeRestart.createEnrichmentRun({ id: "finished-run", mode: "grill", binding, proposalId: "p", proposalHash: "h", operations: [] });
      beforeRestart.close();

      const reopened = new Store(dbPath);
      expect(reopened.getEnrichmentRun("finished-run")).toMatchObject({ status: finished.status, version: finished.version });
    });
  });
});

describe("draft capability reflects the runner's own live readiness, not just its existence", () => {
  /**
   * Wires the real `createModeBEnrichmentDraftRunner` (not a bare mock)
   * against a live, mutable `AuthChoice`, exactly the shape `server/bin.ts`
   * uses in production -- so this exercises the actual seam (route forwards
   * `runner.readiness()` verbatim) rather than re-asserting a hand-rolled
   * mock's behavior.
   */
  function buildWithRealRunner(initialAuth: AuthChoice) {
    const userProject = project();
    const store = new Store(":memory:");
    store.setSetupSteps(store.getSetupSteps().map((step) => (step.key === "bind" ? { ...step, state: "done" } : step)));
    store.activateEnrichmentBinding(resolveEnrichmentBinding(userProject));
    // A fully valid runtime-settings row so a later PUT patch (which only
    // changes `subscriptionProvider`) passes tier-binding validation without
    // needing to restate every field.
    store.setRuntimeSettings({
      ...store.getRuntimeSettings(),
      authMode: "subscription",
      subscriptionProvider: initialAuth.mode === "subscription" ? initialAuth.provider : "claude",
      subscriptionDriverModel: "claude-opus",
      apiKeyModel: "claude-sonnet",
      tierModels: [
        { tier: "cheap", model: "claude-haiku" },
        { tier: "strong", model: "claude-sonnet" },
      ],
    });
    let liveAuth: AuthChoice = initialAuth;
    const deps: TurnDeps = {
      store,
      baseRouteOptions: { authChoice: liveAuth, profileSource: "fixture", userProject },
      route: async () => ({ backend: "agent", warnings: [], kind: "answer", envelope: { blocks: [], summary: "ok" }, trace: { steps: [] } }),
      enrichmentRunner: createModeBEnrichmentDraftRunner({ getAuthChoice: () => liveAuth }),
      getAuthChoice: () => liveAuth,
      setAuthChoice: (choice) => { liveAuth = choice; },
      getRuntimeTierNames: async () => ["cheap", "strong"],
    };
    return { app: createApp(deps) };
  }

  it("reports draft unavailable with a truthful reason for Codex subscription auth -- not the false callback_unavailable", async () => {
    const { app } = buildWithRealRunner({ mode: "subscription", provider: "codex" });
    const status = await (await app.request("/api/context/enrichment")).json() as { capabilities: { draft: { available: boolean; reason?: string } } };
    expect(status.capabilities.draft).toEqual({ available: false, reason: "requires_claude_subscription" });
    // Names the actual cause (which provider IS required) without leaking the caller's own
    // already-chosen provider ("codex" never appears), a runner/SDK internal, or a path.
    expect(JSON.stringify(status)).not.toMatch(/codex|runner_id|sdk[_ -]?session|resume[_ -]?session|\/Users\/|\/home\//i);
  });

  it("reports draft available for Claude subscription auth, byte-identical to the pre-existing shape", async () => {
    const { app } = buildWithRealRunner({ mode: "subscription", provider: "claude" });
    const status = await (await app.request("/api/context/enrichment")).json() as { capabilities: { draft: unknown } };
    expect(status.capabilities.draft).toEqual({ available: true });
  });

  it("reports draft unavailable for a non-subscription auth mode (api-key)", async () => {
    const { app } = buildWithRealRunner({ mode: "api-key", adapter: "mock" });
    const status = await (await app.request("/api/context/enrichment")).json() as { capabilities: { draft: { available: boolean; reason?: string } } };
    expect(status.capabilities.draft).toEqual({ available: false, reason: "requires_claude_subscription" });
  });

  it("flips the reported draft capability the moment PUT /api/config/runtime switches provider, with no restart", async () => {
    const { app } = buildWithRealRunner({ mode: "subscription", provider: "claude" });
    const before = await (await app.request("/api/context/enrichment")).json() as { capabilities: { draft: unknown } };
    expect(before.capabilities.draft).toEqual({ available: true });

    const put = await app.request("/api/config/runtime", {
      method: "PUT",
      body: JSON.stringify({ subscriptionProvider: "codex" }),
    });
    expect(put.status).toBe(200);

    const after = await (await app.request("/api/context/enrichment")).json() as { capabilities: { draft: { available: boolean; reason?: string } } };
    expect(after.capabilities.draft).toEqual({ available: false, reason: "requires_claude_subscription" });
  });
});
