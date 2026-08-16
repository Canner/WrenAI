import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { serve } from "@hono/node-server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveArtifactsDir, type RouteOptions, type RouteResult } from "../harness/index.js";
import { createApp } from "../server/app.js";
import { MAX_NATIVE_STRUCTURED_ANSWERS_PER_SESSION, Store, type NativeSessionVendor } from "../server/db.js";
import { NativeArtifactError, NativeArtifactService, NATIVE_MCP_PERSIST_ANSWER_TOOL_NAME, NATIVE_MCP_TOOL_NAME, NATIVE_PERSIST_ANSWER_CONTRACT, NATIVE_SAVE_DASHBOARD_CONTRACT, NATIVE_SAVE_DASHBOARD_INPUT_SCHEMA } from "../server/native-artifacts.js";
import { NATIVE_SETUP_RECOVERY_MCP_TOOL_NAME } from "../server/native-sessions.js";
import type { TurnDeps } from "../server/turn.js";

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

const ENVELOPE = {
  blocks: [
    { type: "kpi_card", label: "Orders", value: 42 },
    { type: "chart", chart_type: "bar", x: "month", series: ["orders"], rows: [{ month: "Jan", orders: 42 }] },
    { type: "table", columns: ["month", "orders"], rows: [{ month: "Jan", orders: 42 }] },
    { type: "definition", sql: "SELECT month, orders FROM metrics", source_tables: ["metrics"], filters: [] },
    { type: "narrative", text: "Orders were verified." },
  ],
  summary: "Orders dashboard",
  verified: true,
};
const NATIVE_MCP_URL = "http://127.0.0.1:4787/api/native-sessions/mcp";
const CANONICAL_BLOCKS = [
  { type: "kpi_card", label: "Orders", value: 42, unit: null, delta: null },
  { type: "table", columns: ["month", "orders"], rows: [["Jan", 42]] },
  { type: "chart", chart_type: "bar", x: "month", series: ["orders"], rows: [["Jan", 42]] },
  { type: "definition", sql: "SELECT month, orders FROM metrics", source_tables: ["metrics"], filters: [] },
  { type: "narrative", text: "Orders were verified.", title: "Verification" },
] as const;
const STRUCTURED_ANSWER_ENVELOPE = {
  verified: true,
  blocks: [
    { type: "table", columns: ["month", "orders"], rows: [["Jan", 42]] },
    { type: "definition", sql: "SELECT month, orders FROM metrics", source_tables: ["metrics"], filters: [] },
  ],
} as const;

function payload(overrides: Record<string, unknown> = {}) {
  return { version: "1", name: "Orders", envelope: ENVELOPE, idempotency_key: "native-save-0001", ...overrides };
}

function structuredAnswerPayload(overrides: Record<string, unknown> = {}) {
  return { version: "1", idempotency_key: "answer-persist-0001", envelope: STRUCTURED_ANSWER_ENVELOPE, ...overrides };
}

function createFixture(vendor: NativeSessionVendor = "codex") {
  const root = mkdtempSync(path.join(tmpdir(), "genbi-native-artifacts-"));
  dirs.push(root);
  const outDir = path.join(root, "out");
  const binding = { identity: "project-identity", generation: 4, revision: "sha256:revision", path: root };
  const store = new Store(":memory:");
  const row = store.createNativeSession({
    id: `native-${vendor}`, purpose: "analysis", vendor, agent: vendor === "claude" ? "answer_query" : "genbi-analysis",
    scopeKind: "bound_project", scopeId: `scope-${vendor}`, projectIdentity: binding.identity,
    bindingGeneration: binding.generation, projectRevision: binding.revision,
  });
  store.transitionNativeSession(row.id, "running", { started: true });
  let currentBinding = binding;
  const service = new NativeArtifactService({
    store,
    artifactsRoot: resolveArtifactsDir(outDir),
    expectedMcpUrl: NATIVE_MCP_URL,
    mcpUrl: NATIVE_MCP_URL,
    getBinding: () => currentBinding,
  });
  return {
    root, outDir, binding, store, row: store.getNativeSession(row.id)!, service,
    issue: () => service.issue(store.getNativeSession(row.id)!, binding),
    stale: () => { currentBinding = { ...binding, generation: 5, revision: "sha256:changed" }; },
    setBinding: (next: typeof binding) => { currentBinding = next; },
  };
}

function depsFor(store: Store, outDir: string, nativeArtifacts: NativeArtifactService): TurnDeps {
  return {
    store,
    route: async (_options: RouteOptions): Promise<RouteResult> => ({ backend: "agent", warnings: [], kind: "answer", envelope: { blocks: [] }, trace: { steps: [] } }),
    baseRouteOptions: { authChoice: { mode: "api-key", adapter: "mock" }, profileSource: "/fixture/profile", userProject: "/fixture/project", outDir },
    nativeArtifacts,
  };
}

function mcpCall(credential: string, argumentsValue: unknown) {
  return {
    method: "POST",
    headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: NATIVE_MCP_TOOL_NAME, arguments: argumentsValue } }),
  };
}

function persistMcpCall(credential: string, argumentsValue: unknown) {
  return {
    method: "POST",
    headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: NATIVE_MCP_PERSIST_ANSWER_TOOL_NAME, arguments: argumentsValue } }),
  };
}

describe("native-session artifact service", () => {
  it("accepts only the BFF's exact canonical MCP endpoint", () => {
    const fixture = createFixture();
    expect(fixture.service.readiness()).toEqual({ available: true });
    expect(fixture.service.health()).toEqual({ server: "GenBI MCP", tool: NATIVE_MCP_TOOL_NAME, destination: "GenBI Artifacts", available: true });
    expect(fixture.issue()).toMatchObject({ version: "1", url: NATIVE_MCP_URL, credential: expect.any(String) });
    fixture.store.close();
  });

  it.each([
    "http://127.attacker.invalid:4787/api/native-sessions/mcp",
    "http://127.0.0.2:4787/api/native-sessions/mcp",
    "http://127.0.0.1:4788/api/native-sessions/mcp",
    "http://127.0.0.1:4787/not-mcp",
    "http://user@127.0.0.1:4787/api/native-sessions/mcp",
    "http://127.0.0.1:4787/api/native-sessions/mcp?unexpected=1",
    "http://127.0.0.1:4787/api/native-sessions/mcp#fragment",
  ])("rejects noncanonical configured MCP endpoint %s", (mcpUrl) => {
    const fixture = createFixture();
    const service = new NativeArtifactService({
      store: fixture.store, artifactsRoot: resolveArtifactsDir(fixture.outDir), expectedMcpUrl: NATIVE_MCP_URL, mcpUrl,
      getBinding: () => fixture.binding,
    });
    expect(service.readiness()).toEqual({ available: false, reason: "native MCP URL is invalid" });
    expect(() => service.issue(fixture.row, fixture.binding)).toThrow("native MCP URL is invalid");
    fixture.store.close();
  });

  it("allowlists the closed Setup recovery MCP tool without granting artifact writes", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "genbi-native-setup-mcp-"));
    dirs.push(root);
    const store = new Store(":memory:");
    const row = store.createNativeSession({ id: "native-setup", purpose: "setup", vendor: "codex", agent: "genbi-setup", scopeKind: "bootstrap", scopeId: "scope-setup" });
    store.transitionNativeSession(row.id, "running", { started: true });
    const artifacts = new NativeArtifactService({ store, artifactsRoot: resolveArtifactsDir(root), expectedMcpUrl: NATIVE_MCP_URL, mcpUrl: NATIVE_MCP_URL, getBinding: () => undefined });
    const descriptor = artifacts.issue(store.getNativeSession(row.id)!, undefined);
    const reportSetupRecovery = vi.fn().mockReturnValue({ version: 1 });
    const app = createApp({ ...depsFor(store, root, artifacts), workspaceRoot: root, nativeSessions: {
      get: (id: string) => id === row.id ? store.getNativeSession(id) : undefined,
      recovery: () => undefined,
      reportSetupRecovery,
    } as never });
    const headers = { authorization: `Bearer ${descriptor.credential}`, "content-type": "application/json" };
    const listed = await app.request("/api/native-sessions/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(await listed.json()).toMatchObject({ result: { tools: [{ name: NATIVE_SETUP_RECOVERY_MCP_TOOL_NAME }] } });
    const artifactAttempt = await app.request("/api/native-sessions/mcp", mcpCall(descriptor.credential, payload()));
    expect(artifactAttempt.status).toBe(400);
    const report = { version: "1", sequence: 1, phase: "connect", state: "working", code: "in_progress" };
    const accepted = await app.request("/api/native-sessions/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: NATIVE_SETUP_RECOVERY_MCP_TOOL_NAME, arguments: report } }) });
    expect(accepted.status).toBe(200);
    expect(reportSetupRecovery).toHaveBeenCalledWith(row.id, report, false);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });
    mkdirSync(path.join(root, "acme", "target"), { recursive: true });
    writeFileSync(path.join(root, "acme", "wren_project.yml"), "name: acme\n");
    writeFileSync(path.join(root, "acme", "target", "mdl.json"), JSON.stringify({ models: [{ name: "orders" }] }));
    const complete = { version: "1", sequence: 2, phase: "context", state: "reported_complete", code: "completion_reported" };
    const completed = await app.request("/api/native-sessions/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: NATIVE_SETUP_RECOVERY_MCP_TOOL_NAME, arguments: complete } }) });
    expect(completed.status).toBe(200);
    expect(reportSetupRecovery).toHaveBeenLastCalledWith(row.id, complete, true);
    expect(JSON.stringify(await accepted.json())).not.toContain(descriptor.credential);
    store.close();
  });

  it.each(["claude", "codex"] as const)("accepts a verified %s dashboard through the MCP contract and retains its source", async (vendor) => {
    const fixture = createFixture(vendor);
    const descriptor = fixture.issue();
    const app = createApp(depsFor(fixture.store, fixture.outDir, fixture.service));

    const tools = await app.request("/api/native-sessions/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${descriptor.credential}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(tools.status).toBe(200);
    const listedTools = await tools.json() as { result: { tools: Array<{ name: string }> } };
    expect(listedTools.result.tools.map((tool) => tool.name)).toEqual([NATIVE_MCP_PERSIST_ANSWER_TOOL_NAME, NATIVE_MCP_TOOL_NAME]);

    const saved = await app.request("/api/native-sessions/mcp", mcpCall(descriptor.credential, payload()));
    expect(saved.status).toBe(200);
    const body = await saved.json() as { result: { structuredContent: { artifact_id: string; source_href: string } } };
    expect(body.result.structuredContent).toMatchObject({ artifact_id: expect.stringMatching(/^artifact-/), source_href: `/sessions/${fixture.row.id}` });

    const artifactId = body.result.structuredContent.artifact_id;
    const listed = await (await app.request("/api/artifacts")).json() as Array<{ id: string; nativeSessionId?: string; savedAt?: string }>;
    expect(listed).toEqual([expect.objectContaining({ id: artifactId, nativeSessionId: fixture.row.id, savedAt: expect.any(String) })]);
    const content = await (await app.request(`/api/artifacts/${artifactId}/content`)).json() as { form: string; envelope?: unknown };
    expect(content).toMatchObject({ form: "envelope", envelope: ENVELOPE });
    expect(JSON.parse(readFileSync(path.join(resolveArtifactsDir(fixture.outDir), "native", `${artifactId}.json`), "utf8"))).toEqual(ENVELOPE);
    expect(JSON.stringify({ listed, session: fixture.store.getNativeSession(fixture.row.id) })).not.toContain(descriptor.credential);

    expect((await app.request(`/api/artifacts/${artifactId}/unsave`, { method: "POST" })).status).toBe(200);
    expect(await (await app.request("/api/artifacts")).json()).toEqual([]);
    expect((await app.request(`/api/artifacts/${artifactId}/save`, { method: "POST" })).status).toBe(200);
    expect(await (await app.request("/api/artifacts")).json()).toEqual([expect.objectContaining({ id: artifactId })]);

    const retry = await app.request("/api/native-sessions/mcp", mcpCall(descriptor.credential, payload()));
    expect((await retry.json()) as unknown).toMatchObject({ result: { structuredContent: { artifact_id: artifactId } } });
    expect(fixture.store.listArtifacts()).toHaveLength(1);
  });

  it("canonicalizes mixed Claude Code version aliases to one idempotent artifact", async () => {
    const fixture = createFixture("claude");
    const descriptor = fixture.issue();
    const app = createApp(depsFor(fixture.store, fixture.outDir, fixture.service));
    const numeric = await app.request("/api/native-sessions/mcp", mcpCall(descriptor.credential, payload({ version: 1, idempotency_key: "mixed-alias-0001" })));
    const canonical = await app.request("/api/native-sessions/mcp", mcpCall(descriptor.credential, payload({ version: "1", idempotency_key: "mixed-alias-0001" })));
    expect(numeric.status).toBe(200);
    expect(canonical.status).toBe(200);
    const numericBody = await numeric.json() as { result: { structuredContent: { artifact_id: string } } };
    const canonicalBody = await canonical.json() as { result: { structuredContent: { artifact_id: string } } };
    expect(canonicalBody.result.structuredContent.artifact_id).toBe(numericBody.result.structuredContent.artifact_id);
    expect(fixture.store.listArtifacts()).toHaveLength(1);
    const artifact = fixture.store.getArtifact(numericBody.result.structuredContent.artifact_id);
    expect(artifact).toMatchObject({ name: "Orders", nativeSessionId: fixture.row.id });
    expect(JSON.parse(readFileSync(path.join(resolveArtifactsDir(fixture.outDir), artifact!.location), "utf8"))).toEqual(ENVELOPE);
    fixture.store.close();
  });

  it("persists and reference-saves exact answer bytes through MCP without invoking the host query route", async () => {
    const fixture = createFixture();
    const descriptor = fixture.issue();
    const queryRoute = vi.fn(async (_options: RouteOptions): Promise<RouteResult> => ({ backend: "agent", warnings: [], kind: "answer", envelope: { blocks: [] }, trace: { steps: [] } }));
    const app = createApp({ ...depsFor(fixture.store, fixture.outDir, fixture.service), route: queryRoute });
    const persistResponse = await app.request("/api/native-sessions/mcp", persistMcpCall(descriptor.credential, structuredAnswerPayload()));
    expect(persistResponse.status).toBe(200);
    const persisted = (await persistResponse.json() as { result: { structuredContent: { answer_ref: string; digest: string; persisted_at: string } } }).result.structuredContent;

    expect(persisted).toMatchObject({ answer_ref: expect.stringMatching(/^answer-/), digest: expect.stringMatching(/^sha256:/), persisted_at: expect.any(String) });
    const stored = fixture.store.getNativeStructuredAnswer(persisted.answer_ref);
    expect(stored).toMatchObject({ nativeSessionId: fixture.row.id, idempotencyKey: "answer-persist-0001", digest: persisted.digest, createdAt: persisted.persisted_at, envelopeJson: JSON.stringify(STRUCTURED_ANSWER_ENVELOPE) });

    const saveResponse = await app.request("/api/native-sessions/mcp", mcpCall(descriptor.credential, {
      version: "1", name: "Saved exact answer", answer_ref: persisted.answer_ref, idempotency_key: "reference-save-0001",
    }));
    expect(saveResponse.status).toBe(200);
    const saved = (await saveResponse.json() as { result: { structuredContent: { artifact_id: string } } }).result.structuredContent;
    expect(queryRoute).toHaveBeenCalledTimes(0);

    const artifact = fixture.store.getArtifact(saved.artifact_id)!;
    const artifactJson = readFileSync(path.join(resolveArtifactsDir(fixture.outDir), artifact.location), "utf8");
    expect(artifactJson).toBe(stored!.envelopeJson);
    expect(JSON.parse(artifactJson)).toEqual(STRUCTURED_ANSWER_ENVELOPE);
    expect(artifact).toMatchObject({ nativeSessionId: fixture.row.id, sourceAnswerId: persisted.answer_ref, contentDigest: persisted.digest });
    fixture.store.close();
  });

  it("accepts table-only and table-plus-definition answers but rejects third render shapes", () => {
    const fixture = createFixture();
    const descriptor = fixture.issue();
    expect(() => fixture.service.persistAnswer(descriptor.credential, structuredAnswerPayload({
      idempotency_key: "answer-table-only", envelope: { verified: true, blocks: [STRUCTURED_ANSWER_ENVELOPE.blocks[0]] },
    }))).not.toThrow();
    expect(() => fixture.service.persistAnswer(descriptor.credential, structuredAnswerPayload({ idempotency_key: "answer-table-definition" }))).not.toThrow();
    for (const [idempotency_key, block] of [
      ["answer-reject-chart", CANONICAL_BLOCKS[2]],
      ["answer-reject-summary", { type: "narrative", text: "summary" }],
      ["answer-reject-raw", { type: "raw", value: "dump" }],
    ] as const) {
      expect(() => fixture.service.persistAnswer(descriptor.credential, structuredAnswerPayload({
        idempotency_key, envelope: { verified: true, blocks: [STRUCTURED_ANSWER_ENVELOPE.blocks[0], block] },
      }))).toThrow(/invalid (?:dashboard render envelope|structured answer payload)/);
    }
    expect(() => fixture.service.persistAnswer(descriptor.credential, structuredAnswerPayload({
      idempotency_key: "answer-reject-envelope-summary", envelope: { ...STRUCTURED_ANSWER_ENVELOPE, summary: "not retained" },
    }))).toThrow("invalid structured answer payload: envelope must contain exactly one table and at most one definition block");
    fixture.store.close();
  });

  it("rejects missing, cross-session, stale, malformed, and divergent structured-answer references", () => {
    const fixture = createFixture();
    const descriptor = fixture.issue();
    const persisted = fixture.service.persistAnswer(descriptor.credential, structuredAnswerPayload());
    expect(() => fixture.service.save(descriptor.credential, { version: "1", name: "Malformed", answer_ref: "answer-not-a-uuid", idempotency_key: "reference-save-0002" })).toThrow(new NativeArtifactError("invalid Save to Artifacts payload: answer_ref is invalid"));
    expect(() => fixture.service.save(descriptor.credential, { version: "1", name: "Missing", answer_ref: "answer-00000000-0000-4000-8000-000000000000", idempotency_key: "reference-save-0003" })).toThrow(new NativeArtifactError("persisted answer reference was not found", 404));
    expect(() => fixture.service.persistAnswer(descriptor.credential, structuredAnswerPayload({ envelope: { ...STRUCTURED_ANSWER_ENVELOPE, blocks: [{ type: "table", columns: ["month"], rows: [["Feb"]] }, STRUCTURED_ANSWER_ENVELOPE.blocks[1]] } }))).toThrow(new NativeArtifactError("structured answer idempotency key is already bound to a different answer", 409));

    const other = fixture.store.createNativeSession({ id: "native-other-reference", purpose: "analysis", vendor: "codex", agent: "genbi-analysis", scopeKind: "bound_project", scopeId: "scope-other-reference", projectIdentity: fixture.binding.identity, bindingGeneration: fixture.binding.generation, projectRevision: fixture.binding.revision });
    fixture.store.transitionNativeSession(other.id, "running", { started: true });
    const otherCredential = fixture.service.issue(fixture.store.getNativeSession(other.id)!, fixture.binding);
    expect(() => fixture.service.save(otherCredential.credential, { version: "1", name: "Cross session", answer_ref: persisted.answer_ref, idempotency_key: "reference-save-0004" })).toThrow(new NativeArtifactError("persisted answer reference does not belong to this native session", 409));

    fixture.stale();
    expect(() => fixture.service.save(descriptor.credential, { version: "1", name: "Stale", answer_ref: persisted.answer_ref, idempotency_key: "reference-save-0005" })).toThrow(new NativeArtifactError("GenBI MCP session is no longer active or is stale. Start a new native session.", 409));
    fixture.store.close();
  });

  it("validates answer references before honoring a save idempotency retry", () => {
    const fixture = createFixture();
    const descriptor = fixture.issue();
    const first = fixture.service.persistAnswer(descriptor.credential, structuredAnswerPayload());
    fixture.service.save(descriptor.credential, {
      version: "1", name: "First answer", answer_ref: first.answer_ref, idempotency_key: "reference-fence-0001",
    });

    expect(() => fixture.service.save(descriptor.credential, {
      version: "1", name: "First answer", idempotency_key: "reference-fence-0001",
    })).toThrow("invalid Save to Artifacts payload: provide exactly one of envelope or answer_ref");
    expect(() => fixture.service.save(descriptor.credential, {
      version: "1", name: "First answer", answer_ref: "answer-00000000-0000-4000-8000-000000000000", idempotency_key: "reference-fence-0001",
    })).toThrow(new NativeArtifactError("persisted answer reference was not found", 404));
    expect(() => fixture.service.save(descriptor.credential, {
      version: "1", name: "First answer", answer_ref: "answer-not-a-uuid", idempotency_key: "reference-fence-0001",
    })).toThrow(new NativeArtifactError("invalid Save to Artifacts payload: answer_ref is invalid"));

    const second = fixture.service.persistAnswer(descriptor.credential, structuredAnswerPayload({
      idempotency_key: "answer-persist-0002",
      envelope: { verified: true, blocks: [{ type: "table", columns: ["month", "orders"], rows: [["Feb", 7]] }] },
    }));
    expect(() => fixture.service.save(descriptor.credential, {
      version: "1", name: "First answer", answer_ref: second.answer_ref, idempotency_key: "reference-fence-0001",
    })).toThrow(new NativeArtifactError("artifact idempotency key is already bound to a different save request", 409));
    expect(() => fixture.service.save(descriptor.credential, {
      version: "1", name: "Renamed answer", answer_ref: first.answer_ref, idempotency_key: "reference-fence-0001",
    })).toThrow(new NativeArtifactError("artifact idempotency key is already bound to a different save request", 409));
    fixture.store.close();
  });

  it("recomputes the referenced answer digest before an idempotent artifact return", () => {
    const root = mkdtempSync(path.join(tmpdir(), "genbi-native-answer-integrity-"));
    dirs.push(root);
    const dbPath = path.join(root, "state.sqlite");
    const store = new Store(dbPath);
    const binding = { identity: "project-identity", generation: 4, revision: "sha256:revision", path: root };
    const created = store.createNativeSession({ id: "native-answer-integrity", purpose: "analysis", vendor: "codex", agent: "genbi-analysis", scopeKind: "bound_project", scopeId: "scope-answer-integrity", projectIdentity: binding.identity, bindingGeneration: binding.generation, projectRevision: binding.revision });
    store.transitionNativeSession(created.id, "running", { started: true });
    const service = new NativeArtifactService({ store, artifactsRoot: resolveArtifactsDir(root), expectedMcpUrl: NATIVE_MCP_URL, mcpUrl: NATIVE_MCP_URL, getBinding: () => binding });
    const descriptor = service.issue(store.getNativeSession(created.id)!, binding);
    const persisted = service.persistAnswer(descriptor.credential, structuredAnswerPayload());
    service.save(descriptor.credential, { version: "1", name: "Integrity", answer_ref: persisted.answer_ref, idempotency_key: "reference-integrity-0001" });

    const tamper = new DatabaseSync(dbPath);
    tamper.prepare("UPDATE native_structured_answers SET envelope_json = ? WHERE id = ?").run(JSON.stringify({ verified: true, blocks: [{ type: "table", columns: ["month"], rows: [["Divergent"]] }] }), persisted.answer_ref);
    tamper.close();
    expect(() => service.save(descriptor.credential, {
      version: "1", name: "Integrity", answer_ref: persisted.answer_ref, idempotency_key: "reference-integrity-0001",
    })).toThrow(new NativeArtifactError("persisted answer reference failed integrity validation", 409));
    store.close();
  });

  it("bounds retained answers per native session and treats evicted references as stale", () => {
    const fixture = createFixture();
    const descriptor = fixture.issue();
    const references = Array.from({ length: MAX_NATIVE_STRUCTURED_ANSWERS_PER_SESSION + 1 }, (_, index) => fixture.service.persistAnswer(descriptor.credential, structuredAnswerPayload({
      idempotency_key: `answer-retention-${String(index).padStart(4, "0")}`,
      envelope: { verified: true, blocks: [{ type: "table", columns: ["index"], rows: [[index]] }] },
    })).answer_ref);

    expect(fixture.store.getNativeStructuredAnswer(references[0]!)).toBeUndefined();
    expect(references.slice(1).every((reference) => fixture.store.getNativeStructuredAnswer(reference) !== undefined)).toBe(true);
    expect(() => fixture.service.save(descriptor.credential, {
      version: "1", name: "Evicted", answer_ref: references[0]!, idempotency_key: "reference-evicted-0001",
    })).toThrow(new NativeArtifactError("persisted answer reference was not found", 404));
    fixture.store.close();
  });

  it("cascades retained answers when their canonical native session is deleted", () => {
    const root = mkdtempSync(path.join(tmpdir(), "genbi-native-answer-lifecycle-"));
    dirs.push(root);
    const dbPath = path.join(root, "state.sqlite");
    const store = new Store(dbPath);
    const session = store.createNativeSession({ id: "native-answer-owner", purpose: "analysis", vendor: "codex", agent: "genbi-analysis", scopeKind: "bound_project", scopeId: "scope-answer-owner", projectIdentity: "project-identity", bindingGeneration: 4, projectRevision: "sha256:revision" });
    store.createNativeStructuredAnswer({ id: "answer-00000000-0000-4000-8000-000000000001", nativeSessionId: session.id, idempotencyKey: "answer-lifecycle-0001", envelopeJson: JSON.stringify(STRUCTURED_ANSWER_ENVELOPE), digest: "sha256:test" });
    store.close();

    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA foreign_keys = ON");
    expect(db.prepare("PRAGMA foreign_key_list(native_structured_answers)").all()).toEqual([expect.objectContaining({ table: "native_sessions", from: "native_session_id", on_delete: "CASCADE" })]);
    db.prepare("DELETE FROM native_sessions WHERE id = ?").run(session.id);
    expect(db.prepare("SELECT COUNT(*) AS count FROM native_structured_answers WHERE native_session_id = ?").get(session.id)).toMatchObject({ count: 0 });
    db.close();
  });

  it("surfaces structured-answer persistence failure without claiming a later save can recompute", async () => {
    const fixture = createFixture();
    const failing = new NativeArtifactService({
      store: fixture.store, artifactsRoot: resolveArtifactsDir(fixture.outDir), expectedMcpUrl: NATIVE_MCP_URL, mcpUrl: NATIVE_MCP_URL,
      getBinding: () => fixture.binding,
      persistStructuredAnswer: () => { throw new Error("do not disclose storage details"); },
    });
    const descriptor = failing.issue(fixture.row, fixture.binding);
    expect(() => failing.persistAnswer(descriptor.credential, structuredAnswerPayload())).toThrow(new NativeArtifactError("structured answer persistence failed; this answer cannot be saved by reference", 500));
    const app = createApp(depsFor(fixture.store, fixture.outDir, failing));
    const response = await app.request("/api/native-sessions/mcp", persistMcpCall(descriptor.credential, structuredAnswerPayload()));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { message: "structured answer persistence failed; this answer cannot be saved by reference" } });
    fixture.store.close();
  });

  it("returns bounded validation diagnostics", async () => {
    const fixture = createFixture();
    const descriptor = fixture.issue();
    const app = createApp(depsFor(fixture.store, fixture.outDir, fixture.service));
    const invalidVersion = await app.request("/api/native-sessions/mcp", mcpCall(descriptor.credential, payload({ version: 2 })));
    expect(await invalidVersion.json()).toMatchObject({ error: { message: "invalid Save to Artifacts payload: version must be the string \"1\" or numeric 1" } });
    const invalidBlock = await app.request("/api/native-sessions/mcp", mcpCall(descriptor.credential, payload({ envelope: { ...ENVELOPE, blocks: [{ type: "chart", chart_type: "bar", x: "month", series: ["orders"], rows: [{ month: "Jan" }], secret: "no" }] } })));
    const invalidBody = await invalidBlock.json();
    expect(invalidBody).toMatchObject({ error: { message: "invalid dashboard render envelope: block 1 has an unsupported type, field, or row shape" } });
    expect(JSON.stringify(invalidBody)).not.toContain(descriptor.credential);
    fixture.store.close();
  });

  it("runs every advertised dashboard block through Claude's Streamable HTTP lifecycle", async () => {
    const fixture = createFixture();
    const descriptor = fixture.issue();
    const app = createApp(depsFor(fixture.store, fixture.outDir, fixture.service));
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
    if (!server.listening) await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("loopback MCP probe did not receive a TCP address");
    const endpoint = `http://127.0.0.1:${address.port}/api/native-sessions/mcp`;
    const request = async (body: unknown) => fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${descriptor.credential}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    try {
      const initialized = await request({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2.1.227" } },
      });
      expect(initialized.status).toBe(200);
      expect(initialized.headers.get("content-type")).toContain("application/json");
      expect(await initialized.json()).toMatchObject({ result: { serverInfo: { name: "genbi-session" }, capabilities: { tools: {} } } });

      const initializedNotification = await request({ jsonrpc: "2.0", method: "notifications/initialized" });
      expect(initializedNotification.status).toBe(202);
      expect(await initializedNotification.text()).toBe("");

      const ping = await request({ jsonrpc: "2.0", id: 2, method: "ping" });
      expect(ping.status).toBe(200);
      expect(await ping.json()).toEqual({ jsonrpc: "2.0", id: 2, result: {} });

      const listed = await request({ jsonrpc: "2.0", id: 3, method: "tools/list" });
      expect(listed.status).toBe(200);
      expect((await listed.json() as { result: { tools: Array<{ name: string }> } }).result.tools.map((tool) => tool.name)).toEqual([NATIVE_MCP_PERSIST_ANSWER_TOOL_NAME, NATIVE_MCP_TOOL_NAME]);
      const listedBody = await (await request({ jsonrpc: "2.0", id: 4, method: "tools/list" })).json() as { result: { tools: Array<{ name: string }> } };
      expect(listedBody.result.tools.map((tool) => tool.name)).toEqual([NATIVE_MCP_PERSIST_ANSWER_TOOL_NAME, NATIVE_MCP_TOOL_NAME]);
      const listedSchemas = (await (await request({ jsonrpc: "2.0", id: 5, method: "tools/list" })).json() as { result: { tools: Array<{ name: string; inputSchema: typeof NATIVE_SAVE_DASHBOARD_INPUT_SCHEMA }> } }).result.tools;
      expect(listedSchemas[0]!.inputSchema).toEqual(NATIVE_PERSIST_ANSWER_CONTRACT.inputSchema);
      const persistedBlockTypes = NATIVE_PERSIST_ANSWER_CONTRACT.inputSchema.properties.envelope.properties.blocks.items.oneOf.map((variant) => variant.properties.type.const);
      expect(persistedBlockTypes).toEqual(["table", "definition"]);
      const advertisedSchema = listedSchemas[1]!.inputSchema;
      expect(advertisedSchema).toEqual(NATIVE_SAVE_DASHBOARD_CONTRACT.inputSchema);
      const variants = advertisedSchema.properties.envelope.properties.blocks.items.oneOf;
      expect(variants.map((variant) => variant.properties.type.const)).toEqual(["kpi_card", "table", "chart", "definition", "narrative"]);
      expect(advertisedSchema.properties.name.pattern).toBe("\\S");
      expect(variants[1]!.properties.rows.items).toMatchObject({ type: "array" });
      expect(variants[2]!.properties.rows.items).toMatchObject({ type: "array" });
      expect(variants[1]!.properties.rows.description).toBe(NATIVE_SAVE_DASHBOARD_CONTRACT.semanticConstraints.table.positionalRows);
      expect(variants[2]!.properties.x.description).toBe(NATIVE_SAVE_DASHBOARD_CONTRACT.semanticConstraints.chart.x);
      expect(variants[2]!.properties.series.description).toBe(NATIVE_SAVE_DASHBOARD_CONTRACT.semanticConstraints.chart.series);
      expect(variants[2]!.properties.rows.description).toBe(NATIVE_SAVE_DASHBOARD_CONTRACT.semanticConstraints.chart.positionalRows);

      const call = (id: number, argumentsValue: unknown) => request({ jsonrpc: "2.0", id, method: "tools/call", params: { name: NATIVE_MCP_TOOL_NAME, arguments: argumentsValue } });
      const first = await call(6, { version: 1, name: "Canonical dashboard", envelope: { verified: true, blocks: [CANONICAL_BLOCKS[0]] }, idempotency_key: "real-transport-0001" });
      expect(first.status).toBe(200);
      const firstBody = await first.json() as { result: { structuredContent: { artifact_id: string } } };
      const retry = await call(7, { version: "1", name: "Canonical dashboard", envelope: { verified: true, blocks: [CANONICAL_BLOCKS[0]] }, idempotency_key: "real-transport-0001" });
      expect(retry.status).toBe(200);
      expect((await retry.json() as { result: { structuredContent: { artifact_id: string } } }).result.structuredContent.artifact_id).toBe(firstBody.result.structuredContent.artifact_id);

      for (const [offset, block] of CANONICAL_BLOCKS.slice(1).entries()) {
        const saved = await call(8 + offset, { version: "1", name: `Canonical block ${offset + 2}`, envelope: { verified: true, blocks: [block] }, idempotency_key: `real-transport-000${offset + 2}` });
        expect(saved.status).toBe(200);
        const response = await saved.json() as { result: { structuredContent: { artifact_id: string } } };
        expect(fixture.store.getArtifact(response.result.structuredContent.artifact_id)).toMatchObject({ nativeSessionId: fixture.row.id, savedAt: expect.any(String) });
      }
      expect(fixture.store.listArtifacts()).toHaveLength(CANONICAL_BLOCKS.length);

      // The row/cardinality and x-overlap cases are structurally valid JSON
      // Schema instances; the advertised executable semantic contract must
      // reject them before persistence.
      for (const invalid of [
        { version: "1", name: "   ", envelope: { verified: true, blocks: [CANONICAL_BLOCKS[0]] }, idempotency_key: "real-transport-0101" },
        { version: "1", name: "Extra field", envelope: { verified: true, blocks: [{ ...CANONICAL_BLOCKS[1], extra: "no" }] }, idempotency_key: "real-transport-0102" },
        { version: "1", name: "Executable text", envelope: { verified: true, blocks: [{ type: "narrative", text: "javascript:alert(1)" }] }, idempotency_key: "real-transport-0103" },
        { version: "1", name: "Short table row", envelope: { verified: true, blocks: [{ ...CANONICAL_BLOCKS[1], rows: [["Jan"]] }] }, idempotency_key: "real-transport-0104" },
        { version: "1", name: "Long table row", envelope: { verified: true, blocks: [{ ...CANONICAL_BLOCKS[1], rows: [["Jan", 42, "/private/project-path"]] }] }, idempotency_key: "real-transport-0105" },
        { version: "1", name: "Short chart row", envelope: { verified: true, blocks: [{ ...CANONICAL_BLOCKS[2], rows: [["Jan"]] }] }, idempotency_key: "real-transport-0106" },
        { version: "1", name: "Long chart row", envelope: { verified: true, blocks: [{ ...CANONICAL_BLOCKS[2], rows: [["Jan", 42, "Bearer credential-like-value"]] }] }, idempotency_key: "real-transport-0107" },
        { version: "1", name: "x overlaps series", envelope: { verified: true, blocks: [{ ...CANONICAL_BLOCKS[2], series: ["month"] }] }, idempotency_key: "real-transport-0108" },
      ]) {
        const rejected = await call(20, invalid);
        expect(rejected.status).toBe(400);
        const body = await rejected.text();
        if (/row|overlaps/.test(invalid.name)) expect(body).toContain("invalid dashboard render envelope: block 1 has an unsupported type, field, or row shape");
        expect(body).not.toContain(descriptor.credential);
        expect(body).not.toContain("/private/project-path");
        expect(body).not.toContain("Bearer credential-like-value");
      }
      expect(fixture.store.listArtifacts()).toHaveLength(CANONICAL_BLOCKS.length);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      fixture.store.close();
    }
  });

  it.each([
    ["initialize", { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "deterministic-probe", version: "1" } } }],
    ["notifications/initialized", { jsonrpc: "2.0", method: "notifications/initialized" }],
    ["ping", { jsonrpc: "2.0", id: 2, method: "ping" }],
    ["tools/list", { jsonrpc: "2.0", id: 2, method: "tools/list" }],
    ["tools/call", { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: NATIVE_MCP_TOOL_NAME, arguments: payload() } }],
  ])("rejects an old bearer before %s after the binding rotates", async (_method, body) => {
    const fixture = createFixture();
    const descriptor = fixture.issue();
    const app = createApp(depsFor(fixture.store, fixture.outDir, fixture.service));
    fixture.stale();

    const response = await app.request("/api/native-sessions/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${descriptor.credential}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(response.status).toBe(409);
    const error = await response.json() as { error: string };
    expect(error.error).toBe("GenBI MCP session is no longer active or is stale. Start a new native session.");
    expect(JSON.stringify(error)).not.toContain(descriptor.credential);
    expect(fixture.service.hasCredential(descriptor.credential)).toBe(false);
    const replay = await app.request("/api/native-sessions/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${descriptor.credential}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(replay.status).toBe(401);
    expect((await replay.text())).not.toContain(descriptor.credential);
    fixture.store.close();
  });

  it("rejects malformed or unsupported lifecycle messages without disclosing the bearer", async () => {
    const fixture = createFixture();
    const descriptor = fixture.issue();
    const app = createApp(depsFor(fixture.store, fixture.outDir, fixture.service));
    const headers = { authorization: `Bearer ${descriptor.credential}`, "content-type": "application/json" };

    for (const body of [
      [],
      { jsonrpc: "2.0", id: 1, method: "notifications/initialized" },
      { jsonrpc: "2.0", method: "ping" },
      { jsonrpc: "2.0", method: "notifications/not-supported" },
    ]) {
      const response = await app.request("/api/native-sessions/mcp", { method: "POST", headers, body: JSON.stringify(body) });
      expect(response.status).toBe(400);
      expect(JSON.stringify(await response.json())).not.toContain(descriptor.credential);
    }
    fixture.store.close();
  });

  it.each([
    ["tools/list", { jsonrpc: "2.0", id: 1, method: "tools/list" }],
    ["tools/call", { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: NATIVE_MCP_TOOL_NAME, arguments: payload() } }],
  ])("rejects %s for a stopped session and revokes its bearer", async (_method, body) => {
    const fixture = createFixture();
    const descriptor = fixture.issue();
    const app = createApp(depsFor(fixture.store, fixture.outDir, fixture.service));
    fixture.store.transitionNativeSession(fixture.row.id, "stopped", { ended: true });

    const response = await app.request("/api/native-sessions/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${descriptor.credential}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(response.status).toBe(409);
    const error = JSON.stringify(await response.json());
    expect(error).toContain("Start a new native session.");
    expect(error).not.toContain(descriptor.credential);
    expect(fixture.service.hasCredential(descriptor.credential)).toBe(false);
    fixture.store.close();
  });

  it("revokes a bearer when the live runtime no longer matches its issued session", () => {
    const fixture = createFixture();
    fixture.store.setRuntimeSettings({
      ...fixture.store.getRuntimeSettings(), subscriptionProvider: "codex", subscriptionDriverModel: "driver",
      tierModels: [{ tier: "cheap", model: "cheap" }, { tier: "strong", model: "strong" }],
    });
    const runtime = fixture.store.getNativeRuntimeBinding();
    if (!runtime.target) throw new Error("configured Codex runtime must have a target");
    const row = fixture.store.createNativeSession({
      id: "native-runtime-fence", purpose: "analysis", vendor: "codex", agent: "genbi-analysis", scopeKind: "bound_project", scopeId: "scope-runtime-fence",
      projectIdentity: fixture.binding.identity, bindingGeneration: fixture.binding.generation, projectRevision: fixture.binding.revision,
      dispatchTarget: runtime.target, runtimeGeneration: runtime.generation,
    });
    fixture.store.transitionNativeSession(row.id, "running", { started: true });
    const descriptor = fixture.service.issue(fixture.store.getNativeSession(row.id)!, fixture.binding);
    fixture.store.setRuntimeSettings({ ...fixture.store.getRuntimeSettings(), subscriptionProvider: "claude" });

    expect(() => fixture.service.authorize(descriptor.credential)).toThrow(new NativeArtifactError("GenBI MCP session is no longer active or is stale. Start a new native session.", 409));
    expect(fixture.service.hasCredential(descriptor.credential)).toBe(false);
    fixture.store.close();
  });

  it("fails closed for bad credentials, identity fields, executable content, malformed rows, stale bindings, and write failures", async () => {
    const fixture = createFixture();
    const descriptor = fixture.issue();
    const app = createApp(depsFor(fixture.store, fixture.outDir, fixture.service));
    const unauthorized = await app.request("/api/native-sessions/mcp", mcpCall("00000000-0000-0000-0000-000000000000", payload()));
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "GenBI MCP bearer credential is invalid. Restart this native session to refresh its GenBI MCP connection." });
    const unauthorizedPing = await app.request("/api/native-sessions/mcp", {
      method: "POST",
      headers: { authorization: "Bearer 00000000-0000-0000-0000-000000000000", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(unauthorizedPing.status).toBe(401);
    expect((await unauthorizedPing.text())).not.toContain(descriptor.credential);
    const missing = await app.request("/api/native-sessions/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ error: "GenBI MCP requires a bearer credential. Restart this native session to refresh its GenBI MCP connection." });

    for (const invalid of [
      payload({ session_id: "other" }),
      payload({ envelope: { ...ENVELOPE, blocks: [{ type: "narrative", text: "<script>alert(1)</script>" }] } }),
      payload({ envelope: { ...ENVELOPE, blocks: [{ type: "chart", chart_type: "bar", x: "month", series: ["orders"], rows: [{ month: "Jan" }] }] } }),
      payload({ envelope: { ...ENVELOPE, artifact_path: "../../escape" } }),
      payload({ envelope: { ...ENVELOPE, blocks: [{ type: "narrative", text: "x".repeat(256 * 1024) }] } }),
    ]) {
      const response = await app.request("/api/native-sessions/mcp", mcpCall(descriptor.credential, invalid));
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain(descriptor.credential);
    }

    fixture.stale();
    const stale = await app.request("/api/native-sessions/mcp", mcpCall(descriptor.credential, payload()));
    expect(stale.status).toBe(409);
    expect(fixture.service.hasCredential(descriptor.credential)).toBe(false);

    const failed = createFixture();
    const broken = new NativeArtifactService({
      store: failed.store, artifactsRoot: resolveArtifactsDir(failed.outDir), expectedMcpUrl: NATIVE_MCP_URL, mcpUrl: NATIVE_MCP_URL,
      getBinding: () => ({ identity: "project-identity", generation: 4, revision: "sha256:revision", path: failed.root }),
      writeAtomic: () => { throw new Error("do not disclose local write details"); },
    });
    const failedDescriptor = broken.issue(failed.row, { identity: "project-identity", generation: 4, revision: "sha256:revision", path: failed.root });
    expect(() => broken.save(failedDescriptor.credential, payload())).toThrow(new NativeArtifactError("artifact persistence failed", 500));
    expect(failed.store.listArtifacts()).toHaveLength(0);
  });

  it("migrates a legacy artifacts table before creating the native idempotency index and preserves its rows", () => {
    const root = mkdtempSync(path.join(tmpdir(), "genbi-native-artifacts-migration-"));
    dirs.push(root);
    const dbPath = path.join(root, "state.sqlite");
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`CREATE TABLE artifacts (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
      location TEXT NOT NULL, verified INTEGER, created_at TEXT NOT NULL, saved_at TEXT
    );
    INSERT INTO artifacts VALUES ('legacy-artifact', 'legacy-session', 'Legacy', 'dashboard', 'legacy.json', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');`);
    legacy.close();

    const store = new Store(dbPath);
    expect(store.getArtifact("legacy-artifact")).toMatchObject({ name: "Legacy", nativeSessionId: null, contentDigest: null });
    store.close();

    const migrated = new DatabaseSync(dbPath);
    const columns = migrated.prepare("PRAGMA table_info(artifacts)").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining(["native_session_id", "idempotency_key", "content_digest"]));
    expect(migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'artifacts_native_idempotency_unique'").all()).toHaveLength(1);
    migrated.close();
  });

  it("refuses symlinked native storage before any outside content or temporary file can be written", () => {
    const fixture = createFixture();
    const descriptor = fixture.issue();
    const artifactsRoot = resolveArtifactsDir(fixture.outDir);
    const outside = path.join(fixture.root, "outside");
    mkdirSync(artifactsRoot, { recursive: true });
    mkdirSync(outside);
    symlinkSync(outside, path.join(artifactsRoot, "native"));

    expect(() => fixture.service.save(descriptor.credential, payload())).toThrow(new NativeArtifactError("artifact storage is unavailable", 500));
    expect(readdirSync(outside)).toEqual([]);
    expect(fixture.store.listArtifacts()).toEqual([]);
  });

  it("serializes concurrent same-key saves to one stable artifact and fences credentials from other sessions, projects, and revisions", async () => {
    const fixture = createFixture();
    const descriptor = fixture.issue();
    const saves = await Promise.all(Array.from({ length: 12 }, () => Promise.resolve().then(() => fixture.service.save(descriptor.credential, payload()))));
    expect(new Set(saves.map((saved) => saved.artifact_id)).size).toBe(1);
    expect(fixture.store.listArtifacts()).toHaveLength(1);
    expect(existsSync(path.join(resolveArtifactsDir(fixture.outDir), "native", `${saves[0]!.artifact_id}.json`))).toBe(true);
    expect(() => fixture.service.save("00000000-0000-0000-0000-000000000000", payload({ idempotency_key: "native-save-0002" }))).toThrow(new NativeArtifactError("GenBI MCP bearer credential is invalid. Restart this native session to refresh its GenBI MCP connection.", 401));

    const wrongSession = fixture.store.createNativeSession({ id: "native-other", purpose: "analysis", vendor: "codex", agent: "genbi-analysis", scopeKind: "bound_project", scopeId: "scope-other", projectIdentity: "other-project", bindingGeneration: 4, projectRevision: fixture.binding.revision });
    fixture.store.transitionNativeSession(wrongSession.id, "running", { started: true });
    const wrongSessionCredential = fixture.service.issue(fixture.store.getNativeSession(wrongSession.id)!, fixture.binding);
    expect(() => fixture.service.save(wrongSessionCredential.credential, payload({ idempotency_key: "native-save-0003" }))).toThrow(new NativeArtifactError("GenBI MCP session binding is stale. Start a new native session.", 409));
    expect(fixture.service.hasCredential(wrongSessionCredential.credential)).toBe(false);

    const wrongProject = createFixture();
    const wrongProjectCredential = wrongProject.issue();
    wrongProject.setBinding({ ...wrongProject.binding, identity: "other-project" });
    expect(() => wrongProject.service.save(wrongProjectCredential.credential, payload())).toThrow(new NativeArtifactError("GenBI MCP session is no longer active or is stale. Start a new native session.", 409));
    expect(wrongProject.service.hasCredential(wrongProjectCredential.credential)).toBe(false);

    const staleRevision = createFixture();
    const staleRevisionCredential = staleRevision.issue();
    staleRevision.setBinding({ ...staleRevision.binding, revision: "sha256:next" });
    expect(() => staleRevision.service.save(staleRevisionCredential.credential, payload())).toThrow(new NativeArtifactError("GenBI MCP session is no longer active or is stale. Start a new native session.", 409));
    expect(staleRevision.service.hasCredential(staleRevisionCredential.credential)).toBe(false);
  });

  it("keeps credentials usable for the live session and revokes them on terminal expiry or service disposal", () => {
    const fixture = createFixture();
    const descriptor = fixture.issue();
    expect(fixture.service.hasCredential(descriptor.credential)).toBe(true);
    fixture.store.transitionNativeSession(fixture.row.id, "stopped", { ended: true });
    expect(() => fixture.service.authorize(descriptor.credential)).toThrow(new NativeArtifactError("GenBI MCP session is no longer active or is stale. Start a new native session.", 409));
    expect(fixture.service.hasCredential(descriptor.credential)).toBe(false);
    const second = fixture.issue();
    fixture.service.dispose();
    expect(fixture.service.hasCredential(second.credential)).toBe(false);
    fixture.store.close();
  });
});
