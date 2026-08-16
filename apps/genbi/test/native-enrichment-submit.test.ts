import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveArtifactsDir, type RouteOptions, type RouteResult } from "../harness/index.js";
import { createApp } from "../server/app.js";
import { Store, type NativeSessionVendor } from "../server/db.js";
import {
  NATIVE_ENRICHMENT_SUBMIT_MCP_TOOL_NAME,
  resolveEnrichmentBinding,
  type EnrichmentBinding,
} from "../server/enrichment.js";
import { NativeArtifactService, NATIVE_MCP_TOOL_NAME } from "../server/native-artifacts.js";
import type { TurnDeps } from "../server/turn.js";

// This suite is the regression for the reported defect: a native
// `context_enrichment` session could draft a proposal but had no channel to
// hand it to the host, so a submission never reached the enrichment ledger.
// See the discriminating-test confirmation note at the bottom of this file
// for how each of these was proven to fail against the pre-fix code.

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

const NATIVE_MCP_URL = "http://127.0.0.1:4787/api/native-sessions/mcp";

function project(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "genbi-native-enrich-project-"));
  dirs.push(dir);
  mkdirSync(path.join(dir, "target"));
  writeFileSync(path.join(dir, "wren_project.yml"), "name: demo\n");
  writeFileSync(path.join(dir, "target", "mdl.json"), '{"models":[{"name":"orders"}]}');
  return dir;
}

/** Deterministic content fingerprint of every file under `dir`, used to prove
 * the bound project is byte-identical before and after a submission. */
function fingerprint(dir: string): string {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(dir);
  files.sort();
  const hash = createHash("sha256");
  for (const file of files) { hash.update(path.relative(dir, file)); hash.update(readFileSync(file)); }
  return hash.digest("hex");
}

const passVerification = async (proposal: { hash: string; projectRevision: string }) =>
  ({ status: "verified" as const, proposalHash: proposal.hash, projectRevision: proposal.projectRevision, stepsRun: [] });

function refutedAt(step: "sink" | "grammar" | "validate" | "build" | "dry_plan" | "dry_run", reason: string) {
  return async (proposal: { hash: string; projectRevision: string; operations: readonly { id: string }[] }) => ({
    status: "refuted" as const,
    proposalHash: proposal.hash,
    projectRevision: proposal.projectRevision,
    stepsRun: ["sink", "grammar"] as const,
    refutation: { operationId: proposal.operations[0]!.id, step, reason },
  });
}

const validOperations = [
  { sink: "knowledge/rules/business.md", changeKind: "knowledge_append", summary: "Append a glossary entry", draft: "Term: order" },
  { sink: "cubes/revenue/metadata.yml", changeKind: "new_cube", summary: "Add a revenue metric", draft: "cube: revenue" },
];

/** Builds a bound project, a `context_enrichment` native session over it, and
 * an issued MCP credential -- the fixture every test below submits through. */
function createEnrichmentSessionFixture(vendor: NativeSessionVendor = "codex") {
  const projectDir = project();
  const store = new Store(":memory:");
  const binding = store.activateEnrichmentBinding(resolveEnrichmentBinding(projectDir));
  const outDir = path.join(projectDir, "out");
  const row = store.createNativeSession({
    id: `native-enrich-${vendor}`, purpose: "context_enrichment", vendor, agent: "draft_enrichment",
    scopeKind: "bound_project", scopeId: `scope-enrich-${vendor}`, projectIdentity: binding.identity,
    bindingGeneration: binding.generation, projectRevision: binding.revision,
  });
  store.transitionNativeSession(row.id, "running", { started: true });
  let currentBinding: EnrichmentBinding | undefined = binding;
  const service = new NativeArtifactService({
    store, artifactsRoot: resolveArtifactsDir(outDir), expectedMcpUrl: NATIVE_MCP_URL, mcpUrl: NATIVE_MCP_URL,
    getBinding: () => currentBinding,
  });
  const descriptor = service.issue(store.getNativeSession(row.id)!, binding);
  return {
    projectDir, outDir, binding, store, service, credential: descriptor.credential,
    stale: () => { currentBinding = { ...binding, generation: binding.generation + 1, revision: "sha256:changed" }; },
  };
}

function depsFor(store: Store, projectDir: string, outDir: string, nativeArtifacts: NativeArtifactService, extra: Partial<TurnDeps> = {}): TurnDeps {
  return {
    store,
    route: async (_options: RouteOptions): Promise<RouteResult> => ({ backend: "agent", warnings: [], kind: "answer", envelope: { blocks: [] }, trace: { steps: [] } }),
    baseRouteOptions: { authChoice: { mode: "api-key", adapter: "mock" }, profileSource: "/fixture/profile", userProject: projectDir, outDir },
    nativeArtifacts,
    verifyEnrichmentProposal: passVerification,
    ...extra,
  };
}

function submit(credential: string, operations: unknown = validOperations) {
  return {
    method: "POST",
    headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: NATIVE_ENRICHMENT_SUBMIT_MCP_TOOL_NAME, arguments: { operations } } }),
  };
}

describe("native context_enrichment submission tool", () => {
  it("is offered submit_context_proposal, and only that tool, to a context_enrichment session -- never save_dashboard", async () => {
    // AC#1 / AC#8: the tool list served to a context_enrichment session must
    // differ from the analysis one. Asserting the exact array contents (not
    // "contains") makes this fail if enrichment ever falls back into the
    // analysis arm and inherits save_dashboard instead.
    const fixture = createEnrichmentSessionFixture();
    const app = createApp(depsFor(fixture.store, fixture.projectDir, fixture.outDir, fixture.service));
    const headers = { authorization: `Bearer ${fixture.credential}`, "content-type": "application/json" };

    const listed = await app.request("/api/native-sessions/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    const listedBody = await listed.json() as { result: { tools: { name: string }[] } };
    expect(listedBody.result.tools.map((tool) => tool.name)).toEqual([NATIVE_ENRICHMENT_SUBMIT_MCP_TOOL_NAME]);
    expect(listedBody.result.tools.map((tool) => tool.name)).not.toContain(NATIVE_MCP_TOOL_NAME);

    // Calling the analysis tool name against this session must be refused,
    // not silently accepted.
    const wrongTool = await app.request("/api/native-sessions/mcp", {
      method: "POST", headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: NATIVE_MCP_TOOL_NAME, arguments: {} } }),
    });
    expect(wrongTool.status).toBe(400);
    fixture.store.close();
  });

  it("records a submitted proposal in the same enrichment ledger Mode B uses, in the same public shape", async () => {
    // AC#2 and AC#9 (the defect regression): before this feature, a native
    // session had no channel to reach the ledger at all, so this call would
    // have hit `methodNotFound` and `getLatestEnrichmentRun()` would stay
    // undefined. See the bottom of this file for how this was confirmed
    // discriminating against the pre-fix code.
    const fixture = createEnrichmentSessionFixture();
    const app = createApp(depsFor(fixture.store, fixture.projectDir, fixture.outDir, fixture.service));

    expect(fixture.store.getLatestEnrichmentRun()).toBeUndefined();
    const response = await app.request("/api/native-sessions/mcp", submit(fixture.credential));
    expect(response.status).toBe(200);
    const body = await response.json() as { result: { structuredContent: { runId: string; proposalId: string; proposalHash: string; operationCount: number } } };
    expect(body.result.structuredContent.operationCount).toBe(2);

    const run = fixture.store.getLatestEnrichmentRun();
    expect(run).toBeDefined();
    expect(run!.status).toBe("awaiting_decision");
    expect(run!.mode).toBe("grill");
    const operations = fixture.store.listEnrichmentOperations(run!.id);
    expect(operations).toHaveLength(2);
    expect(operations.map((operation) => operation.sink).sort()).toEqual(["cubes/revenue/metadata.yml", "knowledge/rules/business.md"]);
    // Same public shape the UI's accept/edit/skip surface reads for Mode B --
    // no UI change was made, so the ledger record this feature creates must
    // already look exactly like what that UI already knows how to render.
    const viaHttp = await (await app.request(`/api/context/enrichment/${run!.id}`)).json() as { operations: { sink: string; decision: string | null }[] };
    expect(viaHttp.operations).toHaveLength(2);
    expect(viaHttp.operations.every((operation) => operation.decision === null)).toBe(true);
    fixture.store.close();
  });

  it("runs the identical canonicalize -> verify -> finalize pipeline as POST /start, producing parity ledger state for the same operations", async () => {
    // AC#3: proves the native path shares code with `/start` rather than
    // re-implementing it, by running the same operations through both and
    // comparing the resulting ledger records (only run id/timestamps differ).
    const nativeFixture = createEnrichmentSessionFixture();
    const nativeApp = createApp(depsFor(nativeFixture.store, nativeFixture.projectDir, nativeFixture.outDir, nativeFixture.service));
    const nativeResponse = await nativeApp.request("/api/native-sessions/mcp", submit(nativeFixture.credential));
    expect(nativeResponse.status).toBe(200);
    const nativeRun = nativeFixture.store.getLatestEnrichmentRun()!;
    const nativeOperations = nativeFixture.store.listEnrichmentOperations(nativeRun.id);

    const startProjectDir = project();
    const startStore = new Store(":memory:");
    startStore.activateEnrichmentBinding(resolveEnrichmentBinding(startProjectDir));
    const startApp = createApp({
      store: startStore,
      route: async () => ({ backend: "agent", warnings: [], kind: "answer", envelope: { blocks: [] }, trace: { steps: [] } }),
      baseRouteOptions: { authChoice: { mode: "api-key", adapter: "mock" }, profileSource: "/fixture/profile", userProject: startProjectDir },
      enrichmentRunner: { draft: async () => ({ operations: validOperations }) },
      verifyEnrichmentProposal: passVerification,
    });
    const startResponse = await startApp.request("/api/context/enrichment/start", { method: "POST", body: JSON.stringify({ mode: "grill" }) });
    expect(startResponse.status).toBe(201);
    const startRun = startStore.getLatestEnrichmentRun()!;
    const startOperations = startStore.listEnrichmentOperations(startRun.id);

    // Both projects are freshly created by the same `project()` helper, so
    // they carry the identical revision -- the same operations therefore
    // canonicalize to the identical proposal hash and per-operation hashes
    // through either entry point.
    expect(nativeRun.proposalHash).toBe(startRun.proposalHash);
    expect(nativeRun.mode).toBe(startRun.mode);
    expect(nativeOperations.map((operation) => ({ sink: operation.sink, changeKind: operation.changeKind, risk: operation.risk, summary: operation.summary, draft: operation.draft, id: operation.id })))
      .toEqual(startOperations.map((operation) => ({ sink: operation.sink, changeKind: operation.changeKind, risk: operation.risk, summary: operation.summary, draft: operation.draft, id: operation.id })));

    nativeFixture.store.close();
    startStore.close();
  });

  it("never finalizes a refuted proposal, and returns the refuting step and reason as an actionable tool result", async () => {
    // AC#4: a refutation is a tool result, not a JSON-RPC error, and it must
    // never reach the ledger as anything but a failed run.
    const fixture = createEnrichmentSessionFixture();
    const app = createApp(depsFor(fixture.store, fixture.projectDir, fixture.outDir, fixture.service, {
      verifyEnrichmentProposal: refutedAt("grammar", "draft contains a disallowed drift marker"),
    }));

    const response = await app.request("/api/native-sessions/mcp", submit(fixture.credential));
    expect(response.status).toBe(200);
    const body = await response.json() as { result: { isError: boolean; structuredContent: { refuted: boolean; step: string; reason: string; operationId: string } } };
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent).toMatchObject({ refuted: true, step: "grammar", reason: "draft contains a disallowed drift marker" });

    const run = fixture.store.getLatestEnrichmentRun();
    expect(run).toBeDefined();
    expect(run!.status).toBe("failed");
    expect(fixture.store.listEnrichmentOperations(run!.id)).toHaveLength(0);
    fixture.store.close();
  });

  it("leaves the bound project byte-identical after a verified submission and after a refuted one", async () => {
    // AC#5: the write stays host-side and lands only in the SQLite ledger --
    // the bound project directory itself must never be touched, whether
    // verification succeeds or refutes.
    const verifiedFixture = createEnrichmentSessionFixture();
    const beforeVerified = fingerprint(verifiedFixture.projectDir);
    const verifiedApp = createApp(depsFor(verifiedFixture.store, verifiedFixture.projectDir, verifiedFixture.outDir, verifiedFixture.service));
    expect((await verifiedApp.request("/api/native-sessions/mcp", submit(verifiedFixture.credential))).status).toBe(200);
    expect(fingerprint(verifiedFixture.projectDir)).toBe(beforeVerified);
    verifiedFixture.store.close();

    const refutedFixture = createEnrichmentSessionFixture();
    const beforeRefuted = fingerprint(refutedFixture.projectDir);
    const refutedApp = createApp(depsFor(refutedFixture.store, refutedFixture.projectDir, refutedFixture.outDir, refutedFixture.service, {
      verifyEnrichmentProposal: refutedAt("build", "compile failed"),
    }));
    expect((await refutedApp.request("/api/native-sessions/mcp", submit(refutedFixture.credential))).status).toBe(200);
    expect(fingerprint(refutedFixture.projectDir)).toBe(beforeRefuted);
    refutedFixture.store.close();

    const thrownFixture = createEnrichmentSessionFixture();
    const beforeThrown = fingerprint(thrownFixture.projectDir);
    const thrownApp = createApp(depsFor(thrownFixture.store, thrownFixture.projectDir, thrownFixture.outDir, thrownFixture.service, {
      verifyEnrichmentProposal: async () => { throw new Error("verification ladder crashed"); },
    }));
    expect((await thrownApp.request("/api/native-sessions/mcp", submit(thrownFixture.credential))).status).toBe(503);
    expect(fingerprint(thrownFixture.projectDir)).toBe(beforeThrown);
    thrownFixture.store.close();
  });

  it("rejects a submission if the active project binding changed since session launch, matching /start's own staleness rule", async () => {
    // AC#7: rebind the store to a different project after the session was
    // issued its credential -- without touching the native-session credential
    // layer's own binding -- to isolate the handler's own binding re-check
    // (the same `currentEnrichmentBinding` call `/start` uses) from the
    // separately-tested generic native-session credential staleness below.
    // This lands on the same "enrichment is available only after Compile &
    // bind succeeds" 409 `/start` itself returns when `currentEnrichmentBinding`
    // no longer resolves -- `isEnrichmentFoundationReady` and the handler's
    // own re-check call that same function, so a rebind away from the
    // session's project is caught before either check can disagree. What
    // matters for AC#7 is the outcome (rejected, nothing persisted), not
    // which of the two 409 messages is reached.
    const fixture = createEnrichmentSessionFixture();
    const app = createApp(depsFor(fixture.store, fixture.projectDir, fixture.outDir, fixture.service));
    const otherProject = project();
    fixture.store.activateEnrichmentBinding(resolveEnrichmentBinding(otherProject));

    const response = await app.request("/api/native-sessions/mcp", submit(fixture.credential));
    expect(response.status).toBe(409);
    const body = await response.json() as { error: { message: string } };
    expect(body.error.message).toMatch(/stale|bind/i);
    expect(fixture.store.getLatestEnrichmentRun()).toBeUndefined();
    fixture.store.close();
  });

  it("rejects a submission once the native session's own credential binding has gone stale", async () => {
    // The generic native-session credential layer (`NativeArtifactService.authorize`)
    // already fences every native MCP call, including this new tool -- this
    // confirms the enrichment submit tool actually goes through it rather
    // than bypassing it.
    const fixture = createEnrichmentSessionFixture();
    const app = createApp(depsFor(fixture.store, fixture.projectDir, fixture.outDir, fixture.service));
    fixture.stale();

    const response = await app.request("/api/native-sessions/mcp", submit(fixture.credential));
    expect(response.status).toBe(409);
    expect(fixture.store.getLatestEnrichmentRun()).toBeUndefined();
    fixture.store.close();
  });
});

// AC#6 (the seed prompt names the tool instead of saying changes cannot be
// applied) is not re-tested in this file: `welcomePromptFor` is an internal,
// unexported helper in `server/native-sessions.ts` exercised only through a
// real dispatch round-trip. `test/native-sessions.test.ts`'s `welcomeFor`
// fixture and its dispatch-argv assertions (which this packet updated to the
// new prompt text) are the authoritative regression for it.

/**
 * How AC#9's discriminating-test requirement was confirmed:
 *
 * With every change in this packet still uncommitted,
 * `git stash push -- server/app.ts server/enrichment.ts
 * server/native-sessions.ts test/native-sessions.test.ts` was run from
 * `apps/genbi` -- a scoped stash of exactly the tracked source edits, which
 * leaves this untracked test file in place. `pnpm exec vitest run
 * test/native-enrichment-submit.test.ts` was then run against that reverted
 * (pre-fix) tree: 6 of the 7 tests failed. `server/enrichment.ts` on the
 * reverted tree genuinely has no `NATIVE_ENRICHMENT_SUBMIT_MCP_TOOL_NAME`
 * export (confirmed by grep), but under vitest's esbuild-based module
 * transform this does not raise a load-time error the way a raw Node ESM
 * `import` of a missing named export would -- the binding simply resolves to
 * `undefined` at the import site. Concretely: the `submit()` helper builds
 * its JSON-RPC body from `{ name: NATIVE_ENRICHMENT_SUBMIT_MCP_TOOL_NAME,
 * ... }`; with that identifier `undefined`, `JSON.stringify` drops the `name`
 * key entirely, so the pre-fix server never sees a request naming the new
 * tool and every `tools/call` falls through to `methodNotFound` (HTTP 400)
 * instead of routing to the (nonexistent) enrichment-submit handler. The
 * `tools/list` assertion fails for the complementary reason: on the pre-fix
 * tree a `context_enrichment` session's tool list still resolves to
 * `["save_dashboard"]` -- the pre-fix widened-else behaviour that binding
 * decision #1 explicitly forbids -- rather than the new tool's name. Only
 * the credential-layer staleness test (`fixture.stale()`) passed pre-fix:
 * that exercises `NativeArtifactService.authorize`, a pre-existing mechanism
 * this packet does not change, so it is expected to hold on both trees and
 * is not itself a discriminator for this feature. `git stash pop` then
 * restored the fix, and the full file was re-run to confirm all 7 tests pass
 * again on the fixed tree. This confirms the suite is red (6/7) on the
 * pre-fix tree and green (7/7) only once the native submission channel
 * exists.
 */
