import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app.js";
import type { WrenContextShow } from "../server/context-source.js";
import { newId, Store } from "../server/db.js";
import { resolveEnrichmentBinding, resolveProjectIdentity } from "../server/enrichment.js";
import { streamTurn } from "../server/turn.js";
import type { TurnDeps } from "../server/turn.js";
import { BUILD_CONTEXT_AGENT_ID, CONNECT_SOURCE_AGENT_ID, contextLifecycleIdentityFingerprint, loadBundle, DispatchedSessionError, SUBSCRIPTION_TOS_WARNING, WarbleCommandFailedError } from "../harness/index.js";
import type { AgentEvent, AuthChoice, Bundle, LoginProbe, RouteOptions, RouteResult, SetupStepRunner } from "../harness/index.js";
import type { ContextFileNode, ContextOverview, EvalRun, RuntimeSettings, RuntimeSettingsPutResponse, SetupDecision, SetupStatusEvent, SetupStep, SseFrame } from "../server/wire-types.js";
import { parseSse } from "./bff-sse-helpers.js";
import type { ParsedSseFrame } from "./bff-sse-helpers.js";
import { buildSyntheticBundle } from "./synthetic-bundle.js";
import { readFixture } from "./fixtures.js";

// The "context + eval read endpoints" describe block below is the only place in this file that
// hits the context routes, which now shell out to `wren context show` via context-source.ts. Mock
// just `loadContextShow` (mirroring the vi.mock("node:child_process", ...) pattern used in
// test/context-source.test.ts) so this stays a hermetic unit test with no real `wren` binary
// involved, while context-files.ts's file-tree builder still reads real fixture files from a real
// temp directory below.
const loadContextShowMock = vi.fn<(projectDir: string, options?: { readonly useCache?: boolean }) => Promise<WrenContextShow>>();
vi.mock("../server/context-source.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/context-source.js")>();
  return { ...actual, loadContextShow: (...args: unknown[]) => (loadContextShowMock as (...a: unknown[]) => unknown)(...args) };
});

const BASE_ROUTE_OPTIONS: Omit<RouteOptions, "question" | "onEvent"> = {
  authChoice: { mode: "api-key", adapter: "mock" },
  profileSource: "/fixture/profile",
  userProject: "/fixture/project",
};

interface BuildAppSetupOptions {
  readonly store?: Store;
  readonly setupRunner?: SetupStepRunner;
  readonly setupRunnerFor?: (choice: AuthChoice) => SetupStepRunner;
  readonly getAuthChoice?: () => AuthChoice;
  readonly workspaceRoot?: string;
  readonly userProject?: string;
  readonly unbindProject?: () => void;
  readonly loginProbe?: LoginProbe;
  readonly setAuthChoice?: (choice: AuthChoice) => void;
  readonly getRuntimeTierNames?: () => Promise<readonly string[]>;
  readonly listSubscriptionModels?: TurnDeps["listSubscriptionModels"];
}

function buildApp(describeBundle?: TurnDeps["describeBundle"], setupOpts?: BuildAppSetupOptions) {
  const route = async (): Promise<RouteResult> => ({
    backend: "agent",
    warnings: [],
    kind: "answer",
    envelope: { blocks: [], summary: "ok" },
    trace: { steps: [] },
  });
  const store = setupOpts?.store ?? new Store(":memory:");
  const deps: TurnDeps = {
    store,
    route,
    baseRouteOptions: setupOpts?.userProject !== undefined ? { ...BASE_ROUTE_OPTIONS, userProject: setupOpts.userProject } : BASE_ROUTE_OPTIONS,
    ...(describeBundle ? { describeBundle } : {}),
    ...(setupOpts?.setupRunner ? { setupRunner: setupOpts.setupRunner } : {}),
    ...(setupOpts?.setupRunnerFor ? { setupRunnerFor: setupOpts.setupRunnerFor } : {}),
    ...(setupOpts?.getAuthChoice ? { getAuthChoice: setupOpts.getAuthChoice } : {}),
    ...(setupOpts?.setAuthChoice ? { setAuthChoice: setupOpts.setAuthChoice } : {}),
    getRuntimeTierNames: setupOpts?.getRuntimeTierNames ?? (async () => ["cheap", "strong"]),
    ...(setupOpts?.listSubscriptionModels ? { listSubscriptionModels: setupOpts.listSubscriptionModels } : {}),
    ...(setupOpts?.workspaceRoot !== undefined ? { workspaceRoot: setupOpts.workspaceRoot } : {}),
    ...(setupOpts?.unbindProject ? { unbindProject: setupOpts.unbindProject } : {}),
    ...(setupOpts?.loginProbe ? { loginProbe: setupOpts.loginProbe } : {}),
  };
  return { app: createApp(deps), store };
}

/** Establish an explicit valid choice before exercising post-runtime wizard steps. */
function configureSubscriptionRuntime(store: Store): void {
  store.setRuntimeSettings({
    ...store.getRuntimeSettings(),
    subscriptionDriverModel: "claude-opus",
    apiKeyModel: "claude-sonnet",
    tierModels: [
      { tier: "cheap", model: "haiku" },
      { tier: "strong", model: "sonnet" },
    ],
  });
}

/** A `SetupStepRunner` stub whose `run()` is fully scripted by the test — no real dispatched/CLI involved. */
function stubSetupRunner(run: SetupStepRunner["run"]): SetupStepRunner {
  return { run };
}

/** Records the canonical successful discovery -> validate -> build trace. */
function recordSuccessfulSchemaDiscovery(onEvent: ((event: AgentEvent) => void) | undefined): void {
  onEvent?.({
    runId: "test-run",
    seq: 1,
    kind: "tool.call",
    stepId: "build",
    callId: "discover-schema",
    tool: "setup_execution",
    input: { command: 'wren --sql "SELECT table_name FROM information_schema.tables" -o json' },
    depth: 0,
    status: "running",
  });
  onEvent?.({
    runId: "test-run",
    seq: 2,
    kind: "tool.result",
    stepId: "build",
    callId: "discover-schema",
    tool: "setup_execution",
    status: "success",
    summary: '{"exitCode":0,"stdout":"[\\"customers\\"]","stderr":""}',
  });
  for (const [seq, callId, command, stdout] of [
    [3, "validate-context", "wren context validate", "validated"],
    [5, "build-context", "wren context build", "built"],
  ] as const) {
    onEvent?.({ runId: "test-run", seq, kind: "tool.call", stepId: "build", callId, tool: "setup_execution", input: { command }, depth: 0, status: "running" });
    onEvent?.({ runId: "test-run", seq: seq + 1, kind: "tool.result", stepId: "build", callId, tool: "setup_execution", status: "success", summary: `{"exitCode":0,"stdout":"${stdout}","stderr":""}` });
  }
}

function bundleWithGatedCheck(locked: boolean): Bundle {
  return loadBundle(buildSyntheticBundle({ guardrails: { some_gate: { enforcement: "gated_check", locked } } }));
}

describe("config/runtime + setup wizard endpoints", () => {
  it("accepts only purpose on the native launch wire contract", async () => {
    const { app } = buildApp();
    for (const body of [
      { purpose: "setup", vendor: "claude" },
      { purpose: "analysis", target: "codex:interactive" },
      { purpose: "context_enrichment", profile: "genbi-enrich-context" },
    ]) {
      const response = await app.request("/api/native-sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      expect(response.status).toBe(400);
    }
  });
  it("GET /api/setup/recovery returns only the latest redacted failed step and never its SDK anchor", async () => {
    const { app, store } = buildApp();
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });
    const turnId = newId("turn");
    store.createTurn({
      id: turnId,
      sessionId: session.id,
      question: "setup",
      composedInput: "setup",
      agentId: CONNECT_SOURCE_AGENT_ID,
      setupStepKey: "connect_resume",
    });
    store.resolveTurn(turnId, {
      backend: null,
      resultKind: "error",
      answerSummary: null,
      traceJson: JSON.stringify([{ id: "failed", label: "setup_execution", state: "error", kind: "tool", detail: "PASSWORD=secret" }]),
      errorMessage: "Authorization: Bearer secret",
    });
    store.setTurnResumeAnchor(turnId, { sessionId: "provider-session-secret", provider: "claude", runner: "subscription:claude" });

    const response = await app.request("/api/setup/recovery");
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      failure: {
        attempt: "connect_resume",
        projectName: "acme",
        sourceType: "postgres",
        error: "Authorization: Bearer [REDACTED]",
      },
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("resumeSession");
    expect(serialized).not.toContain("provider-session");
  });

  it("GET /api/setup/recovery ignores a successful or non-setup latest turn", async () => {
    const { app, store } = buildApp();
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });
    const turnId = newId("turn");
    store.createTurn({ id: turnId, sessionId: session.id, question: "ask", composedInput: "ask", agentId: "ask" });
    store.resolveTurn(turnId, { backend: null, resultKind: "error", answerSummary: null, traceJson: null, errorMessage: "not setup" });

    expect(await (await app.request("/api/setup/recovery")).json()).toEqual({});
  });

  it("GET /api/setup/recovery allowlists worklog fields and strips nested SDK/provider identities", async () => {
    const { app, store } = buildApp();
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });
    const turnId = newId("turn");
    store.createTurn({ id: turnId, sessionId: session.id, question: "setup", composedInput: "setup", agentId: CONNECT_SOURCE_AGENT_ID, setupStepKey: "context" });
    store.resolveTurn(turnId, {
      backend: null,
      resultKind: "error",
      answerSummary: null,
      traceJson: JSON.stringify([{
        id: "safe-step", label: "setup_execution", state: "error", kind: "tool", unexpected: "discard me",
        input: { safe: "kept", resumeSessionId: "sdk-anchor-123", nested: { runnerPath: "subscription:claude", dispatcher: "claude-dispatcher", safeNested: "kept" } },
        detail: "resumeSessionId=sdk-anchor-123 runner=subscription:claude dispatcher=claude-dispatcher safe diagnostic",
      }]),
      errorMessage: "SDK sessionId=sdk-anchor-123 provider=claude runnerPath=subscription:claude dispatcher=claude-dispatcher safe error",
    });
    store.setTurnResumeAnchor(turnId, { sessionId: "sdk-anchor-123", provider: "claude", runner: "subscription:claude" });

    const body = await (await app.request("/api/setup/recovery")).json() as { failure: { error: string; workLog: Array<Record<string, unknown>> } };
    const serialized = JSON.stringify(body);
    for (const forbidden of ["resumeSessionId", "sessionId", "sdk-anchor-123", "runnerPath", "subscription:claude", "dispatcher", "claude-dispatcher", "provider", "claude", "unexpected"]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    expect(body.failure.workLog).toEqual([expect.objectContaining({
      id: "safe-step",
      label: "setup_execution",
      inspection: { error: expect.stringContaining("safe diagnostic") },
    })]);
    expect(body.failure.workLog[0]).not.toHaveProperty("unexpected");
    expect(body.failure.workLog[0]).not.toHaveProperty("input");
    expect(body.failure.workLog[0]).not.toHaveProperty("detail");
    expect(body.failure.error).toContain("safe error");
  });

  it("strictly redacts hostile setup diagnostics and worklogs from SSE, SQLite, and recovery", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-strict-setup-redaction-test-"));
    const setupRunner = stubSetupRunner(async (opts) => {
      opts.onEvent?.({
        runId: "hostile", seq: 1, kind: "tool.call", stepId: "hostile", callId: "hostile", tool: "setup_execution", depth: 0, status: "running",
        input: { safe: "kept", provider: "claude", runner: "subscription:claude", sessionId: "sdk-anchor-hostile" },
      });
      opts.onEvent?.({
        runId: "hostile", seq: 2, kind: "tool.result", stepId: "hostile", callId: "hostile", tool: "setup_execution", status: "error",
        summary: "provider=claude runner=subscription:claude sessionId=sdk-anchor-hostile safe detail",
      });
      throw new DispatchedSessionError("provider=claude runner=subscription:claude sessionId=sdk-anchor-hostile dispatch failed", "sdk-anchor-hostile");
    });
    const { app, store } = buildApp(undefined, {
      setupRunner,
      workspaceRoot,
      getAuthChoice: () => ({ mode: "subscription", provider: "claude" }),
    });
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });
    const priorTurnId = newId("turn");
    store.createTurn({ id: priorTurnId, sessionId: session.id, question: "prior", composedInput: "prior", agentId: CONNECT_SOURCE_AGENT_ID, setupStepKey: "connect_resume" });
    store.resolveTurn(priorTurnId, { backend: null, resultKind: "error", answerSummary: null, traceJson: "[]", errorMessage: "safe prior failure" });
    store.setTurnResumeAnchor(priorTurnId, { sessionId: "sdk-anchor-hostile", provider: "claude", runner: "subscription:claude" });
    const response = await app.request("/api/setup/connect/resume", { method: "POST" });
    const { turnId } = (await response.json()) as { turnId: string };
    const sse = await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text();
    const persisted = store.getTurn(turnId)!;
    const recovery = await (await app.request("/api/setup/recovery")).text();
    const combined = `${sse}${persisted.errorMessage}${persisted.traceJson}${recovery}`.toLowerCase();
    for (const forbidden of ["claude", "subscription:", "sdk-anchor-hostile", "sessionid", "runner="]) expect(combined).not.toContain(forbidden);
    expect(recovery).not.toContain("kept");
    const recoveredWorkLog = JSON.parse(recovery).failure.workLog as Array<Record<string, unknown>>;
    for (const step of recoveredWorkLog) {
      expect(step).not.toHaveProperty("input");
      expect(step).not.toHaveProperty("detail");
    }
  });

  it("formats hostile inspection fields identically for live SSE, final persistence, and recovery", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-inspection-formatter-test-"));
    const secrets = ["equals-secret", "colon-secret", "json-secret", "flag-secret", "shell-secret", "url-secret"];
    const paths = ["/etc/private-config", "/srv/private-data", "C:\\Users\\private\\config"];
    const longEmoji = "😀".repeat(600);
    const setupRunner = stubSetupRunner(async (opts) => {
      opts.onEvent?.({
        runId: "hostile", seq: 1, kind: "tool.call", stepId: "hostile", callId: `\u001b[31m${longEmoji}`,
        tool: `https://example.test/private?token=${secrets[5]} ${longEmoji}`,
        parent: `/etc/private-parent ${longEmoji}`,
        input: {
          command: `curl https://user:${secrets[5]}@example.test/private --password=${secrets[0]} password: ${secrets[1]} \"password\":\"${secrets[2]}\" --token ${secrets[3]} SECRET ${secrets[4]} ${paths.join(" ")}`,
        },
        depth: 999, status: "running",
      } as AgentEvent);
      opts.onEvent?.({
        runId: "hostile", seq: 2, kind: "tool.result", stepId: "hostile", callId: `\u001b[31m${longEmoji}`,
        tool: "setup_execution", status: "error", error: `\u001b[2Kfailure at ${paths.join(" ")} ${longEmoji}`,
      } as AgentEvent);
      throw new Error("safe terminal failure");
    });
    const { app, store } = buildApp(undefined, { setupRunner, workspaceRoot });
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });
    const response = await app.request("/api/setup/connect/resume", { method: "POST" });
    const { turnId } = await response.json() as { turnId: string };
    const sse = await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text();
    const persisted = store.getTurn(turnId)!;
    const recovery = await (await app.request("/api/setup/recovery")).text();
    const combined = `${sse}${persisted.traceJson}${recovery}`;

    for (const unsafe of [...secrets, ...paths, "https://example.test", "\u001b"]) {
      expect(combined).not.toContain(unsafe);
    }
    const frames = parseSse(sse).filter((frame) => frame.event === "worklog");
    const liveStep = (frames[0]!.data as Array<Record<string, unknown>>)[0]!;
    const finalStep = (frames.at(-1)!.data as Array<Record<string, unknown>>)[0]!;
    const recoveredStep = (JSON.parse(recovery) as { failure: { workLog: Array<Record<string, unknown>> } }).failure.workLog[0]!;
    for (const step of [liveStep, finalStep, recoveredStep]) {
      for (const field of [step.id, step.label, step.parent]) {
        if (typeof field !== "string") continue;
        expect(field).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
        expect(field).not.toMatch(/[\ud800-\udbff]$/);
        expect(Array.from(field).length).toBeLessThanOrEqual(160);
      }
    }
    const inspection = finalStep.inspection as { action: string; error: string };
    expect(inspection.action).toContain("[REDACTED_URL]");
    expect(inspection.error).toContain("[REDACTED_PATH]");
    expect(inspection.error).not.toMatch(/[\ud800-\udbff]$/);
    expect(Array.from(inspection.action).length).toBeLessThanOrEqual(512);
    expect(Array.from(inspection.error).length).toBeLessThanOrEqual(512);
    expect(recoveredStep.inspection).toEqual(inspection);
    expect(liveStep.inspection).toMatchObject({ action: expect.stringContaining("[REDACTED_URL]") });
    expect(liveStep).not.toHaveProperty("depth");
  });

  it("redacts escaped JSON credentials from SSE, SQLite, and recovery work logs", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-escaped-credential-test-"));
    const secrets = ["escaped-password", "double-token", "nested-api-key"] as const;
    const [passwordSecret, tokenSecret, apiKeySecret] = secrets;
    const escapedJson = (depth: number, key: string, secret: string) => {
      const slash = "\\".repeat(depth);
      return `{${slash}"${key}${slash}":${slash}"${secret}${slash}"}`;
    };
    const callId = `call ${escapedJson(1, "password", passwordSecret)}`;
    const label = `setup_execution ${escapedJson(2, "token", tokenSecret)}`;
    const parent = `parent ${escapedJson(4, "apiKey", apiKeySecret)}`;
    const setupRunner = stubSetupRunner(async (opts) => {
      opts.onEvent?.({
        runId: "escaped", seq: 1, kind: "tool.call", stepId: "escaped", callId, tool: label, parent,
        input: { command: `run ${escapedJson(1, "api_key", apiKeySecret)}` }, status: "running",
      } as AgentEvent);
      opts.onEvent?.({
        runId: "escaped", seq: 2, kind: "tool.result", stepId: "escaped", callId, tool: label, status: "error",
        error: `failed ${escapedJson(2, "PASSWORD", passwordSecret)} ${escapedJson(4, "TOKEN", tokenSecret)}`,
      } as AgentEvent);
      throw new Error("safe terminal failure");
    });
    const { app, store } = buildApp(undefined, { setupRunner, workspaceRoot });
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });
    const response = await app.request("/api/setup/connect/resume", { method: "POST" });
    const { turnId } = await response.json() as { turnId: string };
    const sse = await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text();
    const persisted = store.getTurn(turnId)!;
    const recovery = await (await app.request("/api/setup/recovery")).text();
    const frames = parseSse(sse).filter((frame) => frame.event === "worklog");
    const finalStep = (frames.at(-1)!.data as Array<Record<string, unknown>>)[0]!;
    const recoveredStep = (JSON.parse(recovery) as { failure: { workLog: Array<Record<string, unknown>> } }).failure.workLog[0]!;

    for (const serialized of [sse, persisted.traceJson, recovery, ...frames.map((frame) => JSON.stringify(frame.data))]) {
      for (const secret of secrets) expect(serialized).not.toContain(secret);
    }
    expect(finalStep).toMatchObject({
      id: expect.stringContaining("password=[REDACTED]"),
      label: expect.stringContaining("token=[REDACTED]"),
      parent: expect.stringContaining("apiKey=[REDACTED]"),
      inspection: {
        action: expect.stringContaining("api_key=[REDACTED]"),
        error: expect.stringContaining("PASSWORD=[REDACTED]"),
      },
    });
    expect(recoveredStep).toEqual(finalStep);
  });

  it("redacts a completed session anchor from normal needs_input SSE, event, and turn persistence", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-normal-anchor-redaction-test-"));
    const anchor = "sdk-completed-anchor";
    const setupRunner = stubSetupRunner(async () => {
      return { finalText: `SETUP_STATUS: needs_input - provider=claude sessionId=${anchor} needs user action`, sessionId: anchor };
    });
    const { app, store } = buildApp(undefined, {
      setupRunner,
      workspaceRoot,
      getAuthChoice: () => ({ mode: "subscription", provider: "claude" }),
    });
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });
    const response = await app.request("/api/setup/connect/resume", { method: "POST" });
    const { turnId } = (await response.json()) as { turnId: string };
    const sse = await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text();
    const turn = store.getTurn(turnId)!;
    const events = JSON.stringify(store.listEventsForTurn(turnId));
    const combined = `${sse}${turn.answerSummary}${turn.traceJson}${events}`.toLowerCase();
    for (const forbidden of [anchor, "claude", "provider=", "sessionid="]) expect(combined).not.toContain(forbidden);
  });

  it("rehydrates a bounded terminal-contract correction paused at needs_input without exposing its anchors", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-needs-input-recovery-test-"));
    const initialAnchor = "sdk-needs-input-initial";
    const correctedAnchor = "sdk-needs-input-corrected";
    let calls = 0;
    const { app, store } = buildApp(undefined, {
      workspaceRoot,
      getAuthChoice: () => ({ mode: "subscription", provider: "claude" }),
      setupRunner: stubSetupRunner(async () => {
        calls += 1;
        return calls === 1
          ? { finalText: "finished work but omitted terminal", sessionId: initialAnchor }
          : { finalText: "SETUP_STATUS: needs_input - credentials are required", sessionId: correctedAnchor };
      }),
    });
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });
    const response = await app.request("/api/setup/connect/resume", { method: "POST" });
    const { turnId } = (await response.json()) as { turnId: string };
    await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text();

    const recovery = await (await app.request("/api/setup/recovery")).json() as {
      sessionId?: string;
      needsInput?: { attempt: string; projectName: string; sourceType: string; message: string; workLog: unknown[] };
    };
    expect(calls).toBe(2);
    expect(recovery).toMatchObject({
      sessionId: session.id,
      needsInput: { attempt: "connect_resume", projectName: "acme", sourceType: "postgres", message: "credentials are required" },
    });
    expect(recovery.needsInput?.workLog.some((step) => (step as { label?: string }).label === "Terminal contract")).toBe(true);
    const serialized = JSON.stringify(recovery).toLowerCase();
    for (const forbidden of [initialAnchor, correctedAnchor, "claude", "provider", "runner", "sessionid="]) expect(serialized).not.toContain(forbidden);
  });

  it("lets a later success supersede needs_input while a later retry failure preserves the credential handoff", async () => {
    const { app, store } = buildApp();
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });
    const pausedTurnId = newId("turn");
    store.createTurn({ id: pausedTurnId, sessionId: session.id, question: "paused", composedInput: "paused", agentId: CONNECT_SOURCE_AGENT_ID, setupStepKey: "connect_resume" });
    store.resolveTurn(pausedTurnId, { backend: null, resultKind: "answer", answerSummary: "credentials are required", traceJson: "[]", errorMessage: null });
    store.insertEvent({ sessionId: session.id, turnId: pausedTurnId, kind: "setup_status", payload: { id: newId("evt"), kind: "setup_status", status: "needs_input", message: "credentials are required" } });
    const okTurnId = newId("turn");
    store.createTurn({ id: okTurnId, sessionId: session.id, question: "later ok", composedInput: "later ok", agentId: CONNECT_SOURCE_AGENT_ID, setupStepKey: "connect_resume" });
    store.resolveTurn(okTurnId, { backend: null, resultKind: "answer", answerSummary: "connected", traceJson: "[]", errorMessage: null });
    store.insertEvent({ sessionId: session.id, turnId: okTurnId, kind: "setup_status", payload: { id: newId("evt"), kind: "setup_status", status: "ok", message: "connected" } });
    expect(await (await app.request("/api/setup/recovery")).json()).toEqual({});

    const errorTurnId = newId("turn");
    store.createTurn({ id: errorTurnId, sessionId: session.id, question: "later error", composedInput: "later error", agentId: CONNECT_SOURCE_AGENT_ID, setupStepKey: "connect_resume" });
    store.resolveTurn(errorTurnId, { backend: null, resultKind: "error", answerSummary: null, traceJson: "[]", errorMessage: "later failure" });
    expect(await (await app.request("/api/setup/recovery")).json()).toMatchObject({
      sessionId: session.id,
      failure: { attempt: "connect_resume", error: "later failure" },
      needsInput: { attempt: "connect_resume", message: "credentials are required" },
    });
  });

  it("keeps the host credential checkpoint available after a failed connect_resume", async () => {
    const { app, store } = buildApp();
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "duckdb" });
    const pausedTurnId = newId("turn");
    store.createTurn({ id: pausedTurnId, sessionId: session.id, question: "paused", composedInput: "paused", agentId: CONNECT_SOURCE_AGENT_ID, setupStepKey: "connect" });
    store.resolveTurn(pausedTurnId, { backend: "codex-local", resultKind: "answer", answerSummary: "agent wording is irrelevant", traceJson: JSON.stringify([{ id: "safe", label: "setup.setup_execution", state: "done", kind: "tool" }]), errorMessage: null });
    store.insertEvent({ sessionId: session.id, turnId: pausedTurnId, kind: "setup_status", payload: { id: newId("evt"), kind: "setup_status", status: "needs_input", message: "user action required" } });
    const failedTurnId = newId("turn");
    store.createTurn({ id: failedTurnId, sessionId: session.id, question: "resume", composedInput: "resume", agentId: CONNECT_SOURCE_AGENT_ID, setupStepKey: "connect_resume" });
    store.resolveTurn(failedTurnId, { backend: null, resultKind: "error", answerSummary: null, traceJson: JSON.stringify([{ id: "blocked", label: "setup.setup_execution", state: "error", kind: "tool" }]), errorMessage: "required MCP tool failed" });

    expect(await (await app.request("/api/setup/recovery")).json()).toMatchObject({
      sessionId: session.id,
      failure: { attempt: "connect_resume", projectName: "acme", sourceType: "duckdb", error: "required MCP tool failed" },
      needsInput: { attempt: "connect", projectName: "acme", sourceType: "duckdb", message: "user action required" },
    });
  });

  it("streams a live worklog frame with the bare session anchor dropped (shape-redaction can't catch it), then finalizes with by-value redaction", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-fresh-live-anchor-redaction-test-"));
    const anchor = "sdk-fresh-bare-anchor";
    const setupRunner = stubSetupRunner(async (opts) => {
      opts.onEvent?.({
        runId: "fresh-anchor", seq: 1, kind: "tool.call", stepId: "fresh-anchor", callId: "fresh-anchor", tool: "setup_execution", depth: 0, status: "running",
      });
      opts.onEvent?.({
        runId: "fresh-anchor", seq: 2, kind: "tool.result", stepId: "fresh-anchor", callId: "fresh-anchor", tool: "setup_execution", status: "success",
        // Deliberately NOT shaped as `key: value` — this bare anchor embedded in
        // prose is exactly what shape-based redaction (SETUP_INTERNAL_DIAGNOSTIC)
        // cannot catch, since it never resolves until this attempt returns. The
        // live frame must still come out clean, because the live path drops
        // `detail` outright rather than relying on the pattern to find it.
        summary: `completed preparatory work in provider conversation ${anchor}`,
      });
      return { finalText: "SETUP_STATUS: needs_input - source needs attention", sessionId: anchor };
    });
    const { app, store } = buildApp(undefined, {
      setupRunner,
      workspaceRoot,
      getAuthChoice: () => ({ mode: "subscription", provider: "claude" }),
    });
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });

    const response = await app.request("/api/setup/connect/resume", { method: "POST" });
    const { turnId } = (await response.json()) as { turnId: string };
    const sse = await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text();
    const turn = store.getTurn(turnId)!;
    const combined = `${sse}${turn.answerSummary}${turn.traceJson}`.toLowerCase();

    expect(combined).not.toContain(anchor);
    const worklogFrames = parseSse(sse).filter((frame) => frame.event === "worklog");
    // Now streams incrementally: one live frame while the attempt is still
    // running, plus the terminal frame once it resolves — no more waiting in
    // silence for the whole turn (the bug this fixes).
    expect(worklogFrames.length).toBeGreaterThanOrEqual(2);

    const liveFrame = worklogFrames[0]!.data as Array<Record<string, unknown>>;
    const liveStep = liveFrame.find((step) => step.id === "fresh-anchor")!;
    expect(liveStep).toBeDefined();
    // The live frame carries progress shape only — no `detail`, so the bare
    // anchor embedded in this step's summary text never had anywhere to leak.
    expect(liveStep).not.toHaveProperty("detail");
    expect(liveStep).not.toHaveProperty("input");

    const finalFrame = worklogFrames[worklogFrames.length - 1]!.data as Array<Record<string, unknown>>;
    const finalStep = finalFrame.find((step) => step.id === "fresh-anchor")!;
    // The end-of-turn snapshot stays authoritative and richer: it knows the
    // real anchor by now, so it carries a safe inspection projection with
    // that value redacted, never the raw detail.
    expect(finalStep.inspection).toEqual({ output: "completed preparatory work in provider conversation [REDACTED]" });
    expect(finalStep).not.toHaveProperty("detail");
  });

  it("returns only a sanitized subscription model catalog and keeps expected unavailability as HTTP 200", async () => {
    const listSubscriptionModels = vi.fn<NonNullable<TurnDeps["listSubscriptionModels"]>>(async (provider) => ({
      version: 1,
      status: "ready",
      provider,
      models: [{ model: "claude-sonnet", displayName: "Claude Sonnet", description: "Balanced", isDefault: true }],
    }));
    const { app } = buildApp(undefined, { listSubscriptionModels });

    const ready = await app.request("/api/config/subscription-models?provider=claude&refresh=1");
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({
      version: 1,
      status: "ready",
      provider: "claude",
      models: [{ model: "claude-sonnet", displayName: "Claude Sonnet", description: "Balanced", isDefault: true }],
    });
    expect(listSubscriptionModels).toHaveBeenCalledWith("claude", true);

    const unavailableApp = buildApp(undefined, {
      listSubscriptionModels: async (provider) => ({ version: 1, status: "unavailable", provider, code: "not_authenticated", retryable: true }),
    }).app;
    const unavailable = await unavailableApp.request("/api/config/subscription-models?provider=codex");
    expect(unavailable.status).toBe(200);
    expect(await unavailable.json()).toEqual({ version: 1, status: "unavailable", provider: "codex", code: "not_authenticated", retryable: true });
  });

  it("rejects invalid model-catalog query values without invoking provider discovery", async () => {
    const listSubscriptionModels = vi.fn<NonNullable<TurnDeps["listSubscriptionModels"]>>();
    const { app } = buildApp(undefined, { listSubscriptionModels });
    expect((await app.request("/api/config/subscription-models?provider=other")).status).toBe(400);
    expect((await app.request("/api/config/subscription-models?provider=claude&refresh=yes")).status).toBe(400);
    expect(listSubscriptionModels).not.toHaveBeenCalled();
  });

  it("GETs the seeded runtime settings and PUTs a partial patch that merges rather than replaces", async () => {
    const { app } = buildApp();
    const initial = (await (await app.request("/api/config/runtime")).json()) as RuntimeSettings;
    expect(initial.authMode).toBe("subscription");

    const putRes = await app.request("/api/config/runtime", {
      method: "PUT",
      body: JSON.stringify({
        hybrid: true,
        subscriptionDriverModel: "claude-opus",
        apiKeyModel: "claude-sonnet",
        tierModels: [
          { tier: "cheap", model: "haiku" },
          { tier: "strong", model: "sonnet" },
        ],
      }),
    });
    expect(putRes.status).toBe(200);
    const updated = (await putRes.json()) as RuntimeSettingsPutResponse;
    expect(updated).toEqual({
      ...initial,
      hybrid: true,
      subscriptionDriverModel: "claude-opus",
      apiKeyModel: "claude-sonnet",
      tierModels: [
        { tier: "cheap", model: "haiku" },
        { tier: "strong", model: "sonnet" },
      ],
      warnings: [SUBSCRIPTION_TOS_WARNING],
      nativeSessionBinding: { configured: true, generation: 2, provider: "claude", target: "claude-code:interactive", targetLabel: "Claude CLI" },
    });

    const { warnings: _warnings, nativeSessionBinding: _nativeSessionBinding, ...persisted } = updated;
    const reread = (await (await app.request("/api/config/runtime")).json()) as RuntimeSettings;
    expect(reread).toEqual(persisted);
  });

  it("rejects an unrealizable Claude per-step alias before persistence or live dispatch", async () => {
    const route = vi.fn(async (): Promise<RouteResult> => ({
      backend: "agent", warnings: [], kind: "answer", envelope: { blocks: [], summary: "should not run" }, trace: { steps: [] },
    }));
    const store = new Store(":memory:");
    const app = createApp({
      store,
      route,
      baseRouteOptions: BASE_ROUTE_OPTIONS,
      getRuntimeTierNames: async () => ["cheap", "strong"],
    });
    const before = store.getRuntimeSettings();

    const save = await app.request("/api/config/runtime", {
      method: "PUT",
      body: JSON.stringify({
        subscriptionDriverModel: "default",
        tierModels: [{ tier: "cheap", model: "haiku" }, { tier: "strong", model: "default" }],
      }),
    });
    expect(save.status).toBe(400);
    expect(await save.json()).toMatchObject({ error: expect.stringContaining('Claude per-step tier "strong"') });
    expect(store.getRuntimeSettings()).toEqual(before);

    // A database created before the save-time gate can still carry this
    // shape. It must be diagnosed before either a structured Ask turn or a
    // native launch can call a dispatcher.
    store.setRuntimeSettings({
      ...before,
      subscriptionDriverModel: "default",
      tierModels: [{ tier: "cheap", model: "haiku" }, { tier: "strong", model: "default" }],
    });
    const readiness = await app.request("/api/config/runtime/readiness");
    expect(readiness.status).toBe(200);
    expect(await readiness.json()).toMatchObject({ valid: false, correction: expect.stringContaining("Runtime needs correction in Setup") });

    const session = store.createSession("legacy runtime");
    const ask = await app.request(`/api/sessions/${session.id}/turns`, { method: "POST", body: JSON.stringify({ question: "show revenue" }) });
    expect(ask.status).toBe(409);
    expect(await ask.json()).toMatchObject({ code: "runtime_correction_required" });
    expect(route).not.toHaveBeenCalled();
    store.close();
  });

  it("derives the UI tier list from the compiled bundle and rejects an invalid full map without changing store or live auth", async () => {
    const describeBundle = vi.fn(async () => loadBundle(readFixture("genbi-default.bundle.json")));
    const getRuntimeTierNames = vi.fn(async () => ["cheap", "strong"]);
    let liveAuth: AuthChoice = { mode: "subscription", provider: "claude" };
    const { app, store } = buildApp(describeBundle, {
      getAuthChoice: () => liveAuth,
      setAuthChoice: (choice) => {
        liveAuth = choice;
      },
      getRuntimeTierNames,
    });
    const before = store.getRuntimeSettings();

    const tiers = await (await app.request("/api/config/runtime/tiers")).json();
    expect(tiers).toEqual(["cheap", "strong"]);

    const response = await app.request("/api/config/runtime", {
      method: "PUT",
      body: JSON.stringify({
        tierModels: [...before.tierModels, { tier: "orchestrator", model: "not-a-profile-tier" }],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("unknown: orchestrator") });
    expect(store.getRuntimeSettings()).toEqual(before);
    expect(liveAuth).toEqual({ mode: "subscription", provider: "claude" });
    expect(getRuntimeTierNames).toHaveBeenCalledTimes(2);
    expect(describeBundle).not.toHaveBeenCalled();
  });

  it("loud-fails tier discovery and save validation when the unbound profile compile fails, without DB-row fallback or mutation", async () => {
    const failure = new Error("warble compile failed");
    let liveAuth: AuthChoice = { mode: "subscription", provider: "claude" };
    const { app, store } = buildApp(undefined, {
      getAuthChoice: () => liveAuth,
      setAuthChoice: (choice) => {
        liveAuth = choice;
      },
      getRuntimeTierNames: async () => {
        throw failure;
      },
    });
    const before = store.getRuntimeSettings();

    const tiersResponse = await app.request("/api/config/runtime/tiers");
    expect(tiersResponse.status).toBe(500);
    expect(await tiersResponse.json()).toEqual({ error: "Could not compile the runtime tier contract: warble compile failed" });

    const saveResponse = await app.request("/api/config/runtime", {
      method: "PUT",
      body: JSON.stringify({ subscriptionDriverModel: "changed" }),
    });
    expect(saveResponse.status).toBe(400);
    expect(await saveResponse.json()).toEqual({ error: "Could not compile the runtime tier contract: warble compile failed" });
    expect(store.getRuntimeSettings()).toEqual(before);
    expect(liveAuth).toEqual({ mode: "subscription", provider: "claude" });
  });

  it("saving runtime settings advances the wizard's first step (runtime -> done, connect -> current) exactly once — a later save is a no-op", async () => {
    const { app, store } = buildApp();
    // Seeded state: runtime current, everything else todo.
    expect(store.getSetupSteps().find((s) => s.key === "runtime")?.state).toBe("current");

    await app.request("/api/config/runtime", {
      method: "PUT",
      body: JSON.stringify({
        hybrid: true,
        subscriptionDriverModel: "claude-opus",
        apiKeyModel: "claude-sonnet",
        tierModels: [
          { tier: "cheap", model: "haiku" },
          { tier: "strong", model: "sonnet" },
        ],
      }),
    });
    let steps = store.getSetupSteps();
    expect(steps.find((s) => s.key === "runtime")?.state).toBe("done");
    expect(steps.find((s) => s.key === "connect")?.state).toBe("current");

    // Simulate the wizard having moved on: connect done, context current. A
    // further runtime-settings save (e.g. from the Harness settings page) must
    // NOT resurrect the wizard or clobber connect's state.
    store.setSetupSteps(
      steps.map((s) => {
        if (s.key === "connect") return { ...s, state: "done" as const };
        if (s.key === "context") return { ...s, state: "current" as const };
        return s;
      }),
    );
    await app.request("/api/config/runtime", { method: "PUT", body: JSON.stringify({ deployment: "hosted" }) });
    steps = store.getSetupSteps();
    expect(steps.find((s) => s.key === "runtime")?.state).toBe("done");
    expect(steps.find((s) => s.key === "connect")?.state).toBe("done");
    expect(steps.find((s) => s.key === "context")?.state).toBe("current");
  });

  describe("GET /api/config/env-detect + PUT /api/config/runtime rejection paths", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("GET /api/config/env-detect reports only booleans, reflecting whether each adapter's env var is a non-empty string", async () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-something");
      vi.stubEnv("OPENAI_API_KEY", "");
      const { app } = buildApp();

      const res = await app.request("/api/config/env-detect");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ anthropic: true, openaiCompatible: false });
    });

    it("reports boolean-only subscription login availability and allows a logged-in Codex selection", async () => {
      const loginProbe: LoginProbe = { claudeLoggedIn: () => false, codexLoggedIn: () => true };
      const { app, store } = buildApp(undefined, { loginProbe });

      const status = await app.request("/api/config/subscription-detect");
      expect(await status.json()).toEqual({ claude: false, codex: true });

      const save = await app.request("/api/config/runtime", {
        method: "PUT",
        body: JSON.stringify({
          authMode: "subscription",
          subscriptionProvider: "codex",
          tierModels: [
            { tier: "strong", model: "gpt-5.6-sol" },
            { tier: "cheap", model: "gpt-5.6-terra" },
          ],
          subscriptionDriverModel: "gpt-5.6-luna",
        }),
      });
      expect(save.status).toBe(200);
      expect(store.getRuntimeSettings().subscriptionProvider).toBe("codex");
    });

    it("rejects a logged-out Codex selection without persisting it or exposing credential details", async () => {
      const loginProbe: LoginProbe = { claudeLoggedIn: () => true, codexLoggedIn: () => false };
      const { app, store } = buildApp(undefined, { loginProbe });
      const before = store.getRuntimeSettings();
      const save = await app.request("/api/config/runtime", {
        method: "PUT",
        body: JSON.stringify({ authMode: "subscription", subscriptionProvider: "codex" }),
      });
      expect(save.status).toBe(400);
      const body = await save.json();
      expect(body).toEqual({
        error: "codex subscription is not logged in on this server. Run `codex login` in the same environment, then retry.",
      });
      expect(JSON.stringify(body)).not.toMatch(/token|auth\.json|credential/i);
      expect(store.getRuntimeSettings()).toEqual(before);
    });

    it("rejects switching to an api-key adapter whose env var is missing, without persisting or advancing the wizard", async () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      const { app, store } = buildApp();
      const before = store.getRuntimeSettings();

      const res = await app.request("/api/config/runtime", {
        method: "PUT",
        body: JSON.stringify({ authMode: "byo", apiKeyAdapter: "anthropic", apiKeyModel: "claude-sonnet" }),
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining("ANTHROPIC_API_KEY") });
      expect(store.getRuntimeSettings()).toEqual(before);
      expect(store.getSetupSteps().find((s) => s.key === "runtime")?.state).toBe("current");
    });

    it("rejects switching to the openai-compatible adapter whose env var is missing, without persisting or advancing the wizard", async () => {
      vi.stubEnv("OPENAI_API_KEY", "");
      const { app, store } = buildApp();
      const before = store.getRuntimeSettings();

      const res = await app.request("/api/config/runtime", {
        method: "PUT",
        body: JSON.stringify({
          authMode: "byo",
          apiKeyAdapter: "openai-compatible",
          apiKeyModel: "gpt-4.1",
          apiKeyBaseURL: "https://api.openai.com/v1",
        }),
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining("OPENAI_API_KEY") });
      expect(store.getRuntimeSettings()).toEqual(before);
      expect(store.getSetupSteps().find((s) => s.key === "runtime")?.state).toBe("current");
    });

    it("does not require the unused global adapter credential when every materialized tier overrides it", async () => {
      vi.stubEnv("OPENAI_API_KEY", "");
      vi.stubEnv("ANTHROPIC_API_KEY", "present");
      const { app, store } = buildApp();

      const res = await app.request("/api/config/runtime", {
        method: "PUT",
        body: JSON.stringify({
          authMode: "byo",
          apiKeyAdapter: "openai-compatible",
          tierModels: [
            { tier: "cheap", adapter: "local", model: "local-small", baseURL: "http://localhost:11434/v1" },
            { tier: "strong", adapter: "anthropic", model: "claude-sonnet" },
          ],
        }),
      });

      expect(res.status).toBe(200);
      expect(store.getRuntimeSettings().tierModels).toMatchObject([
        { tier: "cheap", adapter: "local" },
        { tier: "strong", adapter: "anthropic" },
      ]);
    });

    it("rejects switching to an api-key adapter with a blank model, without persisting or advancing the wizard — neither adapter has a default, so a blank value must not slip through as a silent 200", async () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-something");
      const { app, store } = buildApp();
      const before = store.getRuntimeSettings();

      const res = await app.request("/api/config/runtime", {
        method: "PUT",
        body: JSON.stringify({
          authMode: "byo",
          apiKeyAdapter: "anthropic",
          apiKeyModel: "",
          tierModels: before.tierModels.map((binding) => ({ ...binding, model: "" })),
        }),
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining("model") });
      expect(store.getRuntimeSettings()).toEqual(before);
      expect(store.getSetupSteps().find((s) => s.key === "runtime")?.state).toBe("current");
    });

    it("rejects a non-URL apiKeyBaseURL for the openai-compatible adapter, without persisting or advancing the wizard", async () => {
      vi.stubEnv("OPENAI_API_KEY", "sk-test-something");
      const { app, store } = buildApp();
      const before = store.getRuntimeSettings();

      const res = await app.request("/api/config/runtime", {
        method: "PUT",
        body: JSON.stringify({
          authMode: "byo",
          apiKeyAdapter: "openai-compatible",
          apiKeyModel: "gpt-4.1",
          apiKeyBaseURL: "not-a-url",
        }),
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: expect.stringContaining('Base URL must be an absolute http(s) URL — got "not-a-url"'),
      });
      expect(store.getRuntimeSettings()).toEqual(before);
      expect(store.getSetupSteps().find((s) => s.key === "runtime")?.state).toBe("current");
    });

    it("rejects a missing/empty apiKeyBaseURL for the openai-compatible adapter — required, no default, so an API caller bypassing the UI still can't save a broken client", async () => {
      vi.stubEnv("OPENAI_API_KEY", "sk-test-something");
      const { app, store } = buildApp();
      const before = store.getRuntimeSettings();

      const res = await app.request("/api/config/runtime", {
        method: "PUT",
        body: JSON.stringify({
          authMode: "byo",
          apiKeyAdapter: "openai-compatible",
          apiKeyModel: "gpt-4.1",
          // apiKeyBaseURL intentionally absent
        }),
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: expect.stringContaining("A Base URL is required for the openai-compatible adapter"),
      });
      expect(store.getRuntimeSettings()).toEqual(before);
      expect(store.getSetupSteps().find((s) => s.key === "runtime")?.state).toBe("current");
    });

    it("rejects the model/base-URL transposition (Model holds the URL, Base URL holds the model name), naming the swap rather than only the downstream symptom", async () => {
      vi.stubEnv("OPENAI_API_KEY", "sk-test-something");
      const { app, store } = buildApp();
      const before = store.getRuntimeSettings();

      const res = await app.request("/api/config/runtime", {
        method: "PUT",
        body: JSON.stringify({
          authMode: "byo",
          apiKeyAdapter: "openai-compatible",
          apiKeyModel: "https://api.openai.com/v1",
          apiKeyBaseURL: "gpt-4.1",
          tierModels: before.tierModels.map((binding) => ({ ...binding, model: "" })),
        }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("Model must be a model name, not a URL");
      expect(body.error).toContain("https://api.openai.com/v1");
      expect(body.error).toContain("swapped");
      expect(store.getRuntimeSettings()).toEqual(before);
      expect(store.getSetupSteps().find((s) => s.key === "runtime")?.state).toBe("current");
    });

    it("rejects a Model value that parses as a URL even for the anthropic adapter (no Base URL field involved) — catches the model-side half of the transposition on its own", async () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-something");
      const { app, store } = buildApp();
      const before = store.getRuntimeSettings();

      const res = await app.request("/api/config/runtime", {
        method: "PUT",
        body: JSON.stringify({
          authMode: "byo",
          apiKeyAdapter: "anthropic",
          apiKeyModel: "https://example.com/model",
          tierModels: before.tierModels.map((binding) => ({ ...binding, model: "" })),
        }),
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining("Model must be a model name, not a URL") });
      expect(store.getRuntimeSettings()).toEqual(before);
    });

    it("a valid openai-compatible save (real model name + absolute https Base URL) still succeeds and persists both fields", async () => {
      vi.stubEnv("OPENAI_API_KEY", "sk-test-something");
      const { app, store } = buildApp();

      const res = await app.request("/api/config/runtime", {
        method: "PUT",
        body: JSON.stringify({
          authMode: "byo",
          apiKeyAdapter: "openai-compatible",
          apiKeyModel: "gpt-4.1",
          apiKeyBaseURL: "https://api.openai.com/v1",
        }),
      });

      expect(res.status).toBe(200);
      const updated = (await res.json()) as RuntimeSettingsPutResponse;
      expect(updated.apiKeyModel).toBe("gpt-4.1");
      expect(updated.apiKeyBaseURL).toBe("https://api.openai.com/v1");
      expect(store.getRuntimeSettings().apiKeyBaseURL).toBe("https://api.openai.com/v1");
    });

    it("a successful byo save actually threads the model into the live AuthChoice.config — the field a blank-default bug would otherwise omit silently", async () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-something");
      const store = new Store(":memory:");
      let boundAuthChoice: AuthChoice | undefined;
      const deps: TurnDeps = {
        store,
        route: async (): Promise<RouteResult> => ({
          backend: "agent",
          warnings: [],
          kind: "answer",
          envelope: { blocks: [], summary: "ok" },
          trace: { steps: [] },
        }),
        baseRouteOptions: BASE_ROUTE_OPTIONS,
        getRuntimeTierNames: async () => ["cheap", "strong"],
        setAuthChoice: (choice) => {
          boundAuthChoice = choice;
        },
      };
      const app = createApp(deps);

      const res = await app.request("/api/config/runtime", {
        method: "PUT",
        body: JSON.stringify({ authMode: "byo", apiKeyAdapter: "anthropic", apiKeyModel: "claude-sonnet-4-5-20250929" }),
      });

      expect(res.status).toBe(200);
      expect(boundAuthChoice).toMatchObject({
        mode: "api-key",
        adapter: "anthropic",
        config: { model: "claude-sonnet-4-5-20250929" },
      });
    });

    it("rejects a subscription+hosted combination (ComplianceError), without persisting or advancing the wizard", async () => {
      const { app, store } = buildApp();
      const before = store.getRuntimeSettings();

      const res = await app.request("/api/config/runtime", {
        method: "PUT",
        body: JSON.stringify({ deployment: "hosted" }), // authMode stays "subscription" (default)
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(typeof body.error).toBe("string");
      expect(store.getRuntimeSettings()).toEqual(before);
      expect(store.getSetupSteps().find((s) => s.key === "runtime")?.state).toBe("current");
    });
  });

  it("POST /api/setup/reset restores first-run wizard state, clears the connect form/session, and unbinds the project — without deleting anything on disk", async () => {
    const unbindProject = vi.fn();
    const setAuthChoice = vi.fn();
    const { app, store } = buildApp(undefined, {
      setupRunner: stubSetupRunner(async () => ({ finalText: "SETUP_STATUS: ok" })),
      workspaceRoot: mkdtempSync(path.join(tmpdir(), "wren-harness-setup-test-")),
      unbindProject,
      setAuthChoice,
    });
    // Drive the wizard well past step 1 into a dirtied state.
    store.setSetupSteps([
      { key: "runtime", title: "Runtime & auth", state: "done" },
      { key: "connect", title: "Connect a warehouse", state: "done" },
      { key: "context", title: "Build context", state: "current" },
      { key: "bind", title: "Compile & bind", state: "todo" },
      { key: "ask", title: "Ask questions", state: "todo" },
    ]);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });
    store.setSetupSessionId("session-xyz");
    store.setVerifyGatePassed(true);
    store.setRuntimeSettings({ authMode: "subscription", tierModels: [], hybrid: true, deployment: "personal" });

    const res = await app.request("/api/setup/reset", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; steps: SetupStep[] };
    expect(body.ok).toBe(true);
    expect(body.steps.find((s) => s.key === "runtime")?.state).toBe("current");
    expect(body.steps.every((s) => s.key === "runtime" || s.state === "todo")).toBe(true);

    // State fully reset + project unbound.
    expect(store.getSetupConnectForm()).toBeUndefined();
    expect(store.getSetupSessionId()).toBeUndefined();
    expect(store.getVerifyGatePassed()).toBe(false);
    expect(store.getRuntimeSettings().hybrid).toBe(false);
    expect(store.getRuntimeSettings()).toMatchObject({
      subscriptionProvider: "claude",
      tierModels: [
        { tier: "cheap", model: "" },
        { tier: "strong", model: "" },
      ],
    });
    expect(store.getRuntimeSettings().subscriptionDriverModel).toBeUndefined();
    expect(store.getRuntimeSettings().apiKeyModel).toBeUndefined();
    expect(store.hasExplicitRuntimeSettings()).toBe(false);
    expect(unbindProject).toHaveBeenCalledTimes(1);
    expect(setAuthChoice).toHaveBeenCalledWith(BASE_ROUTE_OPTIONS.authChoice);
  });

  it("POST /api/setup/reset 500s when agentic setup isn't configured (no setupRunner/workspaceRoot)", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/setup/reset", { method: "POST" });
    expect(res.status).toBe(500);
  });

  it("walks the setup wizard: connect dispatches a setup turn that scaffolds the project and marks connect done + context current, compile-bind marks bind done + ask current + gate passed", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-test-"));
    const setupRunner = stubSetupRunner(async (opts) => {
      // Simulate a real connect_source dispatch: stream one tool call/result through the
      // same onEvent channel an Ask turn uses, scaffold the project on disk (parseSetupTerminal
      // verifies wren_project.yml independently of the agent's self-report), then report ok.
      let seq = 0;
      const emit = (event: Record<string, unknown>): void => opts.onEvent?.({ ...event, runId: "run-1", seq: (seq += 1) } as AgentEvent);
      emit({ kind: "tool.call", stepId: "scaffold", callId: "call-1", tool: "wren_init", depth: 0, status: "running" });
      mkdirSync(path.join(opts.workspaceRoot, "acme"), { recursive: true });
      writeFileSync(path.join(opts.workspaceRoot, "acme", "wren_project.yml"), "name: acme\n");
      emit({ kind: "tool.result", stepId: "scaffold", callId: "call-1", tool: "wren_init", status: "success", summary: "scaffolded acme/" });
      return { finalText: "Scaffolded project acme and wrote an empty .env template.\nSETUP_STATUS: ok - connected to postgres" };
    });
    const { app, store } = buildApp(async () => bundleWithGatedCheck(true), { setupRunner, workspaceRoot });
    configureSubscriptionRuntime(store);

    const initialSteps = (await (await app.request("/api/setup/steps")).json()) as SetupStep[];
    expect(initialSteps).toHaveLength(5);

    const connectRes = await app.request("/api/setup/connect", {
      method: "POST",
      body: JSON.stringify({ projectName: "acme", sourceType: "postgres" }),
    });
    expect(connectRes.status).toBe(200);
    const { sessionId, turnId } = (await connectRes.json()) as { sessionId: string; turnId: string };
    expect(sessionId).toBeTruthy();
    expect(turnId).toBeTruthy();

    const streamRes = await app.request(`/api/sessions/${sessionId}/stream?turn=${turnId}`);
    expect(streamRes.status).toBe(200);
    const frames = parseSse(await streamRes.text());
    // Two live worklog snapshots (one per tool.call/tool.result the stub streams through
    // onEvent) plus the turn's final worklog snapshot emitted unconditionally before the
    // terminal event/done pair (see server/turn.ts's executeSetupTurn).
    expect(frames.map((f) => f.event)).toEqual(["worklog", "worklog", "worklog", "event", "done"]);
    expect(frames[3]?.data).toMatchObject({ kind: "setup_status", status: "ok", message: expect.stringContaining("postgres") } satisfies Partial<SetupStatusEvent>);
    expect(frames[4]?.data).toEqual({});

    const afterConnect = (await (await app.request("/api/setup/steps")).json()) as SetupStep[];
    expect(afterConnect.find((s) => s.key === "connect")?.state).toBe("done");
    expect(afterConnect.find((s) => s.key === "context")?.state).toBe("current");

    const bindRes = await app.request("/api/setup/compile-bind", { method: "POST" });
    const bindBody = (await bindRes.json()) as { steps: SetupStep[]; verifyGatePassed: boolean };
    expect(bindBody.verifyGatePassed).toBe(true);
    expect(bindBody.steps.find((s) => s.key === "bind")?.state).toBe("done");
    expect(bindBody.steps.find((s) => s.key === "ask")?.state).toBe("current");

    const finalSteps = (await (await app.request("/api/setup/steps")).json()) as SetupStep[];
    expect(finalSteps).toEqual(bindBody.steps);
  });

  it("POST /api/setup/connect 500s with a clear message when agentic setup isn't configured (no setupRunner/workspaceRoot wired)", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/setup/connect", { method: "POST", body: JSON.stringify({ projectName: "acme", sourceType: "postgres" }) });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("not configured") });
  });

  it("POST /api/setup/connect 400s when projectName or sourceType is missing", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-test-"));
    const setupRunner = stubSetupRunner(async () => ({ finalText: "SETUP_STATUS: ok" }));
    const { app } = buildApp(undefined, { setupRunner, workspaceRoot });

    const res = await app.request("/api/setup/connect", { method: "POST", body: JSON.stringify({ projectName: "acme" }) });
    expect(res.status).toBe(400);
  });

  it("POST /api/setup/connect 400s on a path-traversal projectName instead of persisting it (security: never let it reach path.join/the prompt)", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-test-"));
    const setupRunner = stubSetupRunner(async () => ({ finalText: "SETUP_STATUS: ok" }));
    const { app } = buildApp(undefined, { setupRunner, workspaceRoot });

    for (const badName of ["../escape", "..", "foo/../../bar", "/etc/passwd", "a/b"]) {
      const res = await app.request("/api/setup/connect", { method: "POST", body: JSON.stringify({ projectName: badName, sourceType: "postgres" }) });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining("projectName") });
    }

    // Confirm the form was never persisted by any of the rejected attempts.
    const stepsAfter = (await (await app.request("/api/setup/steps")).json()) as SetupStep[];
    expect(stepsAfter.find((s) => s.key === "connect")?.state).not.toBe("done");
  });

  it("POST /api/setup/connect 400s on an unsupported sourceType instead of interpolating it into the prompt", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-test-"));
    const setupRunner = stubSetupRunner(async () => ({ finalText: "SETUP_STATUS: ok" }));
    const { app } = buildApp(undefined, { setupRunner, workspaceRoot });

    const res = await app.request("/api/setup/connect", { method: "POST", body: JSON.stringify({ projectName: "acme", sourceType: "'; rm -rf /" }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("sourceType") });
  });

  it("POST /api/setup/connect/resume 409s when no connect form is on record yet", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-test-"));
    const setupRunner = stubSetupRunner(async () => ({ finalText: "SETUP_STATUS: ok" }));
    const { app } = buildApp(undefined, { setupRunner, workspaceRoot });

    const res = await app.request("/api/setup/connect/resume", { method: "POST" });
    expect(res.status).toBe(409);
  });

  it("a setup turn that reports needs_input keeps connect NOT done and does not bind a project", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-test-"));
    // connect's needs_input is independently verified against the artifacts its own prompt
    // promises (project dir + wren_project.yml + .env). The stub simulates the agent actually
    // scaffolding them as a side effect (not pre-existing before the call — that would trip the
    // route's own same-name-conflict preflight) so this represents a genuine needs_input, not the
    // bogus case (nothing on disk) that the check now catches.
    const setupRunner = stubSetupRunner(async () => {
      mkdirSync(path.join(workspaceRoot, "acme"), { recursive: true });
      writeFileSync(path.join(workspaceRoot, "acme", "wren_project.yml"), "name: acme\n");
      writeFileSync(path.join(workspaceRoot, "acme", ".env"), "POSTGRES_HOST=\n");
      return {
        finalText: "Wrote an empty .env template to acme/.env — fill in your postgres credentials and resume.\nSETUP_STATUS: needs_input - waiting on .env",
      };
    });
    const { app } = buildApp(undefined, { setupRunner, workspaceRoot });

    const connectRes = await app.request("/api/setup/connect", {
      method: "POST",
      body: JSON.stringify({ projectName: "acme", sourceType: "postgres" }),
    });
    const { sessionId, turnId } = (await connectRes.json()) as { sessionId: string; turnId: string };
    const frames = parseSse(await (await app.request(`/api/sessions/${sessionId}/stream?turn=${turnId}`)).text());
    // No onEvent calls from this stub, but executeSetupTurn still emits one final (empty)
    // worklog snapshot before the terminal event/done pair.
    expect(frames.map((f) => f.event)).toEqual(["worklog", "event", "done"]);
    expect(frames[1]?.data).toMatchObject({ status: "needs_input" });

    const steps = (await (await app.request("/api/setup/steps")).json()) as SetupStep[];
    expect(steps.find((s) => s.key === "connect")?.state).not.toBe("done");
  });
});

describe("GET /api/setup/connect/env-fields + POST /api/setup/connect/env — the in-UI credential form", () => {
  it("GET 500s when agentic setup isn't configured", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/setup/connect/env-fields");
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("not configured") });
  });

  it("GET 409s when no connect form is on record yet", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-test-"));
    const { app } = buildApp(undefined, { setupRunner: stubSetupRunner(async () => ({ finalText: "SETUP_STATUS: ok" })), workspaceRoot });

    const res = await app.request("/api/setup/connect/env-fields");
    expect(res.status).toBe(409);
  });

  it("GET parses the scaffolded .env template's KEY= lines, tagging credential-shaped keys as secret", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-test-"));
    const { app, store } = buildApp(undefined, { setupRunner: stubSetupRunner(async () => ({ finalText: "SETUP_STATUS: ok" })), workspaceRoot });
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });

    mkdirSync(path.join(workspaceRoot, "acme"), { recursive: true });
    writeFileSync(
      path.join(workspaceRoot, "acme", ".env"),
      ["# postgres connection", "PGHOST=", "PGPORT=5432", "PGPASSWORD=", "API_KEY=", "PLAIN_TOKEN=", "SOME_URL="].join("\n"),
    );

    const res = await app.request("/api/setup/connect/env-fields");
    expect(res.status).toBe(200);
    const { fields } = (await res.json()) as { fields: Array<{ key: string; secret: boolean }> };
    expect(fields).toEqual([
      { key: "PGHOST", secret: false },
      { key: "PGPORT", secret: false },
      { key: "PGPASSWORD", secret: true },
      { key: "API_KEY", secret: true },
      { key: "PLAIN_TOKEN", secret: true },
      { key: "SOME_URL", secret: false },
    ]);
  });

  it("GET returns an empty field list (not an error) when the .env template doesn't exist yet", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-test-"));
    const { app, store } = buildApp(undefined, { setupRunner: stubSetupRunner(async () => ({ finalText: "SETUP_STATUS: ok" })), workspaceRoot });
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });
    mkdirSync(path.join(workspaceRoot, "acme"), { recursive: true });

    const res = await app.request("/api/setup/connect/env-fields");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ fields: [] });
  });

  it("GET 400s when the recorded projectName resolves outside the workspace root (defense in depth on top of the persist-time guard)", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-test-"));
    const { app, store } = buildApp(undefined, { setupRunner: stubSetupRunner(async () => ({ finalText: "SETUP_STATUS: ok" })), workspaceRoot });
    store.setSetupConnectForm({ projectName: "../escape", sourceType: "postgres" });

    const res = await app.request("/api/setup/connect/env-fields");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("projectName") });
  });

  it("POST 409s when no connect form is on record yet", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-test-"));
    const { app } = buildApp(undefined, { setupRunner: stubSetupRunner(async () => ({ finalText: "SETUP_STATUS: ok" })), workspaceRoot });

    const res = await app.request("/api/setup/connect/env", { method: "POST", body: JSON.stringify({ values: { PGHOST: "localhost" } }) });
    expect(res.status).toBe(409);
  });

  it("POST 409s when the connect form is on record but the .env template hasn't been scaffolded yet", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-test-"));
    const { app, store } = buildApp(undefined, { setupRunner: stubSetupRunner(async () => ({ finalText: "SETUP_STATUS: ok" })), workspaceRoot });
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });

    const res = await app.request("/api/setup/connect/env", { method: "POST", body: JSON.stringify({ values: { PGHOST: "localhost" } }) });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining(".env") });
  });

  it("POST 400s when the recorded projectName resolves outside the workspace root", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-test-"));
    const { app, store } = buildApp(undefined, { setupRunner: stubSetupRunner(async () => ({ finalText: "SETUP_STATUS: ok" })), workspaceRoot });
    store.setSetupConnectForm({ projectName: "../escape", sourceType: "postgres" });

    const res = await app.request("/api/setup/connect/env", { method: "POST", body: JSON.stringify({ values: { PGHOST: "localhost" } }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("projectName") });
  });

  it("POST merges submitted values into the .env template in place — preserving comments/blank lines/order and ignoring keys not in the template — without ever routing values through the store", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-test-"));
    const { app, store } = buildApp(undefined, { setupRunner: stubSetupRunner(async () => ({ finalText: "SETUP_STATUS: ok" })), workspaceRoot });
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });

    const projectDir = path.join(workspaceRoot, "acme");
    mkdirSync(projectDir, { recursive: true });
    const template = ["# postgres connection", "", "PGHOST=", "PGPORT=5432", "PGPASSWORD=", "UNRELATED_LEFTOVER="].join("\n");
    writeFileSync(path.join(projectDir, ".env"), template);

    const res = await app.request("/api/setup/connect/env", {
      method: "POST",
      body: JSON.stringify({
        values: { PGHOST: "127.0.0.1", PGPASSWORD: "s3cret!", NOT_IN_TEMPLATE: "should be ignored" },
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const written = readFileSync(path.join(projectDir, ".env"), "utf-8");
    expect(written).toEqual(
      ["# postgres connection", "", "PGHOST=127.0.0.1", "PGPORT=5432", "PGPASSWORD=s3cret!", "UNRELATED_LEFTOVER="].join("\n"),
    );
    // The submitted secret value must never be persisted anywhere except the .env file on
    // disk — never in the store's sqlite-backed session/turn/config state.
    expect(JSON.stringify(store.getSetupConnectForm())).not.toContain("s3cret!");
    expect(JSON.stringify(store.getSetupConnectForm())).not.toContain("127.0.0.1");
  });

  it("POST rejects a value containing line breaks (400) rather than splicing an extra KEY= line into the .env template", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-test-"));
    const { app, store } = buildApp(undefined, { setupRunner: stubSetupRunner(async () => ({ finalText: "SETUP_STATUS: ok" })), workspaceRoot });
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });

    const projectDir = path.join(workspaceRoot, "acme");
    mkdirSync(projectDir, { recursive: true });
    const template = ["PGHOST=", "PGPASSWORD="].join("\n");
    writeFileSync(path.join(projectDir, ".env"), template);

    const res = await app.request("/api/setup/connect/env", {
      method: "POST",
      body: JSON.stringify({ values: { PGPASSWORD: "hunter2\nINJECTED_KEY=evil" } }),
    });
    expect(res.status).toBe(400);
    // The template must be untouched — no injected line, no partial write.
    expect(readFileSync(path.join(projectDir, ".env"), "utf-8")).toEqual(template);
  });
});

describe("POST /api/setup/context — the CONTEXT step's setup turn (build_context)", () => {
  function writeMdl(projectDir: string, modelNames: readonly string[]): void {
    const targetDir = path.join(projectDir, "target");
    mkdirSync(targetDir, { recursive: true });
    const mdl = {
      catalog: "wren",
      schema: "public",
      models: modelNames.map((name) => ({ name })),
      relationships: [],
      views: [],
      cubes: [{ name: "metrics", baseObject: modelNames[0] ?? "missing_model", measures: [{ name: "row_count", expression: "COUNT(*)" }] }],
    };
    writeFileSync(path.join(targetDir, "mdl.json"), JSON.stringify(mdl));
  }

  const okRoute = async (): Promise<RouteResult> => ({
    backend: "agent",
    warnings: [],
    kind: "answer",
    envelope: { blocks: [], summary: "ok" },
    trace: { steps: [] },
  });

  it("500s with a clear message when agentic setup isn't configured (no setupRunner/workspaceRoot wired)", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/setup/context", { method: "POST" });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("not configured") });
  });

  it("409s while no project is bound yet (context can only run after connect binds one)", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-context-test-"));
    const setupRunner = stubSetupRunner(async () => ({ finalText: "SETUP_STATUS: ok" }));
    const store = new Store(":memory:");
    let boundProject: string | undefined;
    const deps: TurnDeps = {
      store,
      route: okRoute,
      baseRouteOptions: BASE_ROUTE_OPTIONS,
      setupRunner,
      workspaceRoot,
      describeBundle: async () => bundleWithGatedCheck(true),
      getUserProject: () => boundProject,
      bindProject: (dir: string) => {
        boundProject = dir;
      },
    };
    const app = createApp(deps);

    const res = await app.request("/api/setup/context", { method: "POST" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("no wren project is bound") });
  });

  it("409s when bound but no connect form/session is on record (context dispatched without ever going through connect)", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-context-test-"));
    const setupRunner = stubSetupRunner(async () => ({ finalText: "SETUP_STATUS: ok" }));
    const store = new Store(":memory:");
    const deps: TurnDeps = {
      store,
      route: okRoute,
      baseRouteOptions: BASE_ROUTE_OPTIONS,
      setupRunner,
      workspaceRoot,
      // Bound via some other path, bypassing POST /api/setup/connect entirely — no connect form/session ever persisted.
      getUserProject: () => "/some/already/bound/project",
    };
    const app = createApp(deps);

    const res = await app.request("/api/setup/context", { method: "POST" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("call POST /api/setup/connect first") });
  });

  it("full flow: compile-bind refreshes the canonical enrichment binding after context rebuilds the MDL", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-context-test-"));
    let boundProject: string | undefined;
    let bindCallCount = 0;
    const setupRunner = stubSetupRunner(async (opts) => {
      if (opts.agentId === "build_context") {
        expect(opts).toMatchObject({ workspaceRoot, projectName: "acme", stepKey: "context" });
        recordSuccessfulSchemaDiscovery(opts.onEvent);
        writeMdl(path.join(workspaceRoot, "acme"), ["customers", "orders", "products"]);
        return { finalText: "Generated MDL from the discovered schema.\nSETUP_STATUS: ok - built MDL with 3 models" };
      }
      expect(opts).toMatchObject({ workspaceRoot, projectName: "acme", stepKey: "connect" });
      mkdirSync(path.join(workspaceRoot, "acme"), { recursive: true });
      writeFileSync(path.join(workspaceRoot, "acme", "wren_project.yml"), "name: acme\n");
      writeMdl(path.join(workspaceRoot, "acme"), ["bootstrap"]);
      return { finalText: "Scaffolded project acme and wrote an empty .env template.\nSETUP_STATUS: ok - connected to postgres" };
    });
    const store = new Store(":memory:");
    configureSubscriptionRuntime(store);
    const deps: TurnDeps = {
      store,
      route: okRoute,
      baseRouteOptions: BASE_ROUTE_OPTIONS,
      setupRunner,
      workspaceRoot,
      describeBundle: async () => bundleWithGatedCheck(true),
      getUserProject: () => boundProject,
      bindProject: (dir: string) => {
        const binding = resolveEnrichmentBinding(dir);
        boundProject = binding.path;
        store.activateEnrichmentBinding(binding);
        bindCallCount += 1;
      },
    };
    const app = createApp(deps);

    const connectRes = await app.request("/api/setup/connect", {
      method: "POST",
      body: JSON.stringify({ projectName: "acme", sourceType: "postgres" }),
    });
    const { sessionId, turnId: connectTurnId } = (await connectRes.json()) as { sessionId: string; turnId: string };
    await (await app.request(`/api/sessions/${sessionId}/stream?turn=${connectTurnId}`)).text(); // drives the connect turn to completion (binds the project)

    expect(bindCallCount).toBe(1);
    expect(boundProject).toBe(resolveEnrichmentBinding(path.join(workspaceRoot, "acme")).path);

    const stepsAfterConnect = (await (await app.request("/api/setup/steps")).json()) as SetupStep[];
    expect(stepsAfterConnect.find((s) => s.key === "context")?.state).toBe("current");

    const contextRes = await app.request("/api/setup/context", { method: "POST" });
    expect(contextRes.status).toBe(200);
    const { sessionId: contextSessionId, turnId: contextTurnId } = (await contextRes.json()) as { sessionId: string; turnId: string };
    expect(contextSessionId).toBe(sessionId); // reuses the SAME setup session, not a new one

    const contextTurn = store.getTurn(contextTurnId);
    expect(contextTurn?.agentId).toBe("build_context");
    expect(contextTurn?.setupStepKey).toBe("context");

    await (await app.request(`/api/sessions/${contextSessionId}/stream?turn=${contextTurnId}`)).text();

    expect(bindCallCount).toBe(1); // bindProject was NOT called again by the context step
    expect(boundProject).toBe(resolveEnrichmentBinding(path.join(workspaceRoot, "acme")).path); // same canonical project, unchanged

    const finalSteps = (await (await app.request("/api/setup/steps")).json()) as SetupStep[];
    expect(finalSteps.find((s) => s.key === "context")?.state).toBe("done");
    expect(finalSteps.find((s) => s.key === "bind")?.state).toBe("current");
    // The context step just wrote a real, built MDL without calling
    // bindProject again -- and it doesn't need to: enrichment resolves its
    // revision fresh from disk at each check rather than trusting whatever
    // revision was cached at connect-time bind, so foundation readiness
    // already reflects the real schema here, ahead of the explicit
    // compile-bind step below.
    expect((await (await app.request("/api/context/enrichment")).json() as { foundationReady: boolean }).foundationReady).toBe(true);

    const beforeRefresh = store.getEnrichmentBinding()!;
    const bindRes = await app.request("/api/setup/compile-bind", { method: "POST" });
    expect(bindRes.status).toBe(200);
    const refreshed = store.getEnrichmentBinding()!;
    expect(bindCallCount).toBe(2);
    expect(refreshed.generation).toBe(beforeRefresh.generation + 1);
    expect(refreshed.revision).not.toBe(beforeRefresh.revision);
    expect((await (await app.request("/api/context/enrichment")).json() as { foundationReady: boolean }).foundationReady).toBe(true);
  });

  it("connect binds a project that has wren_project.yml but no target/mdl.json, and completes the turn normally", async () => {
    // Regression for the bug where a successful connect step's bindProject
    // call required the enrichment revision (target/mdl.json) as a
    // precondition of binding, throwing inside the SSE stream for every
    // real onboarding run (connect always precedes context, so mdl.json
    // never exists yet). This stub mirrors server/bin.ts's real
    // `bindProject` -- resolveProjectIdentity only, never
    // resolveEnrichmentBinding -- rather than the trivial no-op stub other
    // connect tests in this file use, so it actually exercises the bug.
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-connect-unbuilt-test-"));
    let boundProject: string | undefined;
    let bindCallCount = 0;
    const setupRunner = stubSetupRunner(async (opts) => {
      expect(opts).toMatchObject({ workspaceRoot, projectName: "acme", stepKey: "connect" });
      mkdirSync(path.join(workspaceRoot, "acme"), { recursive: true });
      writeFileSync(path.join(workspaceRoot, "acme", "wren_project.yml"), "name: acme\n");
      // Deliberately no target/mdl.json: connect never builds context.
      return { finalText: "Scaffolded project acme and wrote an empty .env template.\nSETUP_STATUS: ok - connected to postgres" };
    });
    const store = new Store(":memory:");
    configureSubscriptionRuntime(store);
    const deps: TurnDeps = {
      store,
      route: okRoute,
      baseRouteOptions: BASE_ROUTE_OPTIONS,
      setupRunner,
      workspaceRoot,
      getUserProject: () => boundProject,
      bindProject: (dir: string) => {
        const identity = resolveProjectIdentity(dir);
        boundProject = identity.path;
        store.activateEnrichmentBinding(identity);
        bindCallCount += 1;
      },
    };
    const app = createApp(deps);

    const connectRes = await app.request("/api/setup/connect", {
      method: "POST",
      body: JSON.stringify({ projectName: "acme", sourceType: "postgres" }),
    });
    const { sessionId, turnId } = (await connectRes.json()) as { sessionId: string; turnId: string };
    const events = parseSse(await (await app.request(`/api/sessions/${sessionId}/stream?turn=${turnId}`)).text());

    // The bug crashed the SSE stream with an uncaught EnrichmentContractError
    // instead of ever completing the turn.
    expect(events.some((frame) => frame.event === "error")).toBe(false);
    expect(events.filter((frame) => frame.event === "done")).toHaveLength(1);
    const statusFrame = events.find((frame) => frame.event === "event")?.data as SetupStatusEvent | undefined;
    expect(statusFrame?.kind).toBe("setup_status");
    expect(statusFrame?.status).toBe("ok");
    expect(bindCallCount).toBe(1);
    expect(boundProject).toBe(resolveProjectIdentity(path.join(workspaceRoot, "acme")).path);
    expect(existsSync(path.join(workspaceRoot, "acme", "target", "mdl.json"))).toBe(false);

    const stepsAfterConnect = (await (await app.request("/api/setup/steps")).json()) as SetupStep[];
    expect(stepsAfterConnect.find((s) => s.key === "context")?.state).toBe("current");

    // Foundation-bound but unbuilt: enrichment correctly refuses without a 500.
    const enrichmentStatus = await app.request("/api/context/enrichment");
    expect(enrichmentStatus.status).toBe(200);
    expect((await enrichmentStatus.json() as { foundationReady: boolean }).foundationReady).toBe(false);
  });

  it("carries host-verified discovery through a fresh corrective attempt, then retains validated build/artifact proof", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-context-lifecycle-recovery-test-"));
    let contextRuns = 0;
    const setupRunner = stubSetupRunner(async (opts) => {
      if (opts.agentId !== "build_context") return { finalText: "SETUP_STATUS: ok - connected" };
      contextRuns += 1;
      if (contextRuns === 1) {
        opts.onEvent?.({ runId: "lifecycle", seq: 1, kind: "tool.call", stepId: "context", callId: "discover", tool: "setup_execution", input: { command: 'wren --sql "SELECT table_name FROM information_schema.tables" -o json' }, depth: 0, status: "running" });
        opts.onEvent?.({ runId: "lifecycle", seq: 2, kind: "tool.result", stepId: "context", callId: "discover", tool: "setup_execution", status: "success", summary: '{"exitCode":0}' });
        return { finalText: "SETUP_STATUS: error - validation was interrupted" };
      }
      expect(opts.prompt).toMatch(/Host verification already established schema discovery/i);
      expect(opts.prompt).toMatch(/do NOT repeat discovery/i);
      opts.onEvent?.({ runId: "lifecycle", seq: 1, kind: "tool.call", stepId: "context", callId: "validate", tool: "setup_execution", input: { command: "wren context validate" }, depth: 0, status: "running" });
      opts.onEvent?.({ runId: "lifecycle", seq: 2, kind: "tool.result", stepId: "context", callId: "validate", tool: "setup_execution", status: "success", summary: '{"exitCode":0}' });
      opts.onEvent?.({ runId: "lifecycle", seq: 3, kind: "tool.call", stepId: "context", callId: "build", tool: "setup_execution", input: { command: "wren context build" }, depth: 0, status: "running" });
      opts.onEvent?.({ runId: "lifecycle", seq: 4, kind: "tool.result", stepId: "context", callId: "build", tool: "setup_execution", status: "success", summary: '{"exitCode":0}' });
      writeMdl(path.join(workspaceRoot, "acme"), ["customers"]);
      return { finalText: "SETUP_STATUS: ok - built MDL with 1 model" };
    });
    const { app, store } = buildApp(async () => bundleWithGatedCheck(true), { setupRunner, workspaceRoot });
    const projectDir = path.join(workspaceRoot, "acme");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "wren_project.yml"), "name: acme\nprofile: acme_profile\ndata_source: postgres\n");
    writeFileSync(path.join(projectDir, ".env"), "POSTGRES_URL=postgresql://readonly:secret@db.example.test:5432/analytics\n");
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });

    const initial = await app.request("/api/setup/context", { method: "POST" });
    const { turnId: initialTurnId } = await initial.json() as { turnId: string };
    await (await app.request(`/api/sessions/${session.id}/stream?turn=${initialTurnId}`)).text();
    const identity = contextLifecycleIdentityFingerprint(workspaceRoot, "acme", "postgres")!;
    expect(store.getSetupContextLifecycleEvidence(session.id, identity)).toMatchObject({ completed: "discovery" });

    const retry = await app.request("/api/setup/context", { method: "POST" });
    const { turnId: retryTurnId } = await retry.json() as { turnId: string };
    const frames = parseSse(await (await app.request(`/api/sessions/${session.id}/stream?turn=${retryTurnId}`)).text());
    expect(frames).toEqual(expect.arrayContaining([expect.objectContaining({ event: "event", data: expect.objectContaining({ status: "ok" }) })]));
    expect(contextRuns).toBe(2);
    expect(store.getSetupContextLifecycleEvidence(session.id, identity)).toMatchObject({ completed: "build" });
  });

  it("fails closed and discards retained lifecycle evidence when the project profile identity changes", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-context-lifecycle-identity-test-"));
    const { app, store } = buildApp(undefined, { setupRunner: stubSetupRunner(async () => ({ finalText: "SETUP_STATUS: error - stop" })), workspaceRoot });
    const projectDir = path.join(workspaceRoot, "acme");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "wren_project.yml"), "name: acme\nprofile: original\ndata_source: postgres\n");
    writeFileSync(path.join(projectDir, ".env"), "POSTGRES_URL=postgresql://readonly:secret@db.example.test:5432/analytics\n");
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });
    const originalIdentity = contextLifecycleIdentityFingerprint(workspaceRoot, "acme", "postgres")!;
    store.mergeSetupContextLifecycleEvidence({ sessionId: session.id, identityFingerprint: originalIdentity, completed: "validate" });
    writeFileSync(path.join(projectDir, "wren_project.yml"), "name: acme\nprofile: replacement\ndata_source: postgres\n");

    const response = await app.request("/api/setup/context", { method: "POST" });
    const { turnId } = await response.json() as { turnId: string };
    expect(store.getTurn(turnId)?.composedInput).toMatch(/Follow the wren generate-mdl skill/i);
    expect(store.getTurn(turnId)?.composedInput).not.toMatch(/Host verification already established/i);
    expect(store.getSetupContextLifecycleEvidence(session.id, originalIdentity)).toBeUndefined();
  });

  it("fails closed and discards retained lifecycle evidence when only the effective database URL changes", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-context-lifecycle-connection-identity-test-"));
    const { app, store } = buildApp(undefined, { setupRunner: stubSetupRunner(async () => ({ finalText: "SETUP_STATUS: error - stop" })), workspaceRoot });
    const projectDir = path.join(workspaceRoot, "acme");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "wren_project.yml"), "name: acme\nprofile: acme_profile\ndata_source: postgres\n");
    writeFileSync(path.join(projectDir, ".env"), "POSTGRES_URL=postgresql://readonly:initial-secret@db.example.test:5432/analytics\n");
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });
    const originalIdentity = contextLifecycleIdentityFingerprint(workspaceRoot, "acme", "postgres")!;
    store.mergeSetupContextLifecycleEvidence({ sessionId: session.id, identityFingerprint: originalIdentity, completed: "validate" });

    writeFileSync(path.join(projectDir, ".env"), "POSTGRES_URL=postgresql://readonly:replacement-secret@db.example.test:5432/warehouse\n");
    const changedIdentity = contextLifecycleIdentityFingerprint(workspaceRoot, "acme", "postgres")!;
    expect(changedIdentity).not.toBe(originalIdentity);
    expect(changedIdentity).not.toContain("replacement-secret");

    const response = await app.request("/api/setup/context", { method: "POST" });
    const { turnId } = await response.json() as { turnId: string };
    expect(store.getTurn(turnId)?.composedInput).toMatch(/Follow the wren generate-mdl skill/i);
    expect(store.getTurn(turnId)?.composedInput).not.toMatch(/Host verification already established/i);
    expect(store.getSetupContextLifecycleEvidence(session.id, originalIdentity)).toBeUndefined();
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("fails closed when the effective connection target is absent or ambiguous", () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-context-lifecycle-connection-target-test-"));
    const projectDir = path.join(workspaceRoot, "acme");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "wren_project.yml"), "name: acme\nprofile: acme_profile\ndata_source: postgres\n");
    expect(contextLifecycleIdentityFingerprint(workspaceRoot, "acme", "postgres")).toBeUndefined();

    writeFileSync(
      path.join(projectDir, ".env"),
      [
        "POSTGRES_URL=postgresql://readonly:one-secret@db.example.test:5432/analytics",
        "PG_URL=postgresql://readonly:two-secret@db.example.test:5432/warehouse",
      ].join("\n"),
    );
    expect(contextLifecycleIdentityFingerprint(workspaceRoot, "acme", "postgres")).toBeUndefined();
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("fails closed when an effective URL scheme is mismatched for the selected source", () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-context-lifecycle-connection-scheme-test-"));
    const projectDir = path.join(workspaceRoot, "acme");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "wren_project.yml"), "name: acme\nprofile: acme_profile\ndata_source: postgres\n");
    writeFileSync(path.join(projectDir, ".env"), "POSTGRES_URL=mysql://readonly:secret@db.example.test:3306/analytics\n");
    expect(contextLifecycleIdentityFingerprint(workspaceRoot, "acme", "postgres")).toBeUndefined();

    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("fails closed for a DuckDB URL because Setup has no host/database URL target for it", () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-context-lifecycle-duckdb-url-test-"));
    const projectDir = path.join(workspaceRoot, "acme");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "wren_project.yml"), "name: acme\nprofile: acme_profile\ndata_source: duckdb\n");
    writeFileSync(path.join(projectDir, ".env"), "DUCKDB_URL=duckdb://warehouse.local/analytics\n");
    expect(contextLifecycleIdentityFingerprint(workspaceRoot, "acme", "duckdb")).toBeUndefined();

    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("fails closed for DuckDB generic DB_HOST/DB_DATABASE fields", () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-context-lifecycle-duckdb-fields-test-"));
    const projectDir = path.join(workspaceRoot, "acme");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "wren_project.yml"), "name: acme\nprofile: acme_profile\ndata_source: duckdb\n");
    writeFileSync(path.join(projectDir, ".env"), "DB_HOST=warehouse.local\nDB_PORT=5432\nDB_DATABASE=analytics\n");
    expect(contextLifecycleIdentityFingerprint(workspaceRoot, "acme", "duckdb")).toBeUndefined();

    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("fails closed for a source whose identity is not host/database, even when generic fields exist", () => {
    // Oracle used to be this case's example. It is a supported Setup source now
    // and its wren connection model really is host/port/database, so it derives
    // a truthful identity. Databricks does not — it is serverHostname/httpPath —
    // so accepting DB_HOST/DB_DATABASE for it would forge one.
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-context-lifecycle-unsupported-source-test-"));
    const projectDir = path.join(workspaceRoot, "acme");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "wren_project.yml"), "name: acme\nprofile: acme_profile\ndata_source: databricks\n");
    writeFileSync(path.join(projectDir, ".env"), "DB_HOST=db.example.test\nDB_PORT=443\nDB_DATABASE=analytics\n");
    expect(contextLifecycleIdentityFingerprint(workspaceRoot, "acme", "databricks")).toBeUndefined();

    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("now derives a lifecycle identity for a source whose model really is host/database", () => {
    // The converse of the case above, and the reason retries used to lose their
    // work: a source absent from the host/database table produced no identity,
    // so verified progress could not be retained and discovery/validate/build
    // were silently redone.
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-context-lifecycle-oracle-test-"));
    const projectDir = path.join(workspaceRoot, "acme");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "wren_project.yml"), "name: acme\nprofile: acme_profile\ndata_source: oracle\n");
    writeFileSync(path.join(projectDir, ".env"), "DB_HOST=db.example.test\nDB_PORT=1521\nDB_DATABASE=analytics\n");
    expect(contextLifecycleIdentityFingerprint(workspaceRoot, "acme", "oracle")).toBeTruthy();

    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it.each([false, true])("does not reuse prior build proof for a normal rebuild with %s lifecycle worklog", async (buildOnly) => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-context-normal-rebuild-test-"));
    const setupRunner = stubSetupRunner(async (opts) => {
      if (buildOnly) {
        opts.onEvent?.({ runId: "normal-rebuild", seq: 1, kind: "tool.call", stepId: "context", callId: "build", tool: "setup_execution", input: { command: "wren context build" }, depth: 0, status: "running" });
        opts.onEvent?.({ runId: "normal-rebuild", seq: 2, kind: "tool.result", stepId: "context", callId: "build", tool: "setup_execution", status: "success", summary: '{"exitCode":0}' });
      }
      return { finalText: "SETUP_STATUS: ok - reused old build" };
    });
    const { app, store } = buildApp(undefined, { setupRunner, workspaceRoot });
    const projectDir = path.join(workspaceRoot, "acme");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "wren_project.yml"), "name: acme\nprofile: acme_profile\ndata_source: postgres\n");
    writeFileSync(path.join(projectDir, ".env"), "POSTGRES_URL=postgresql://readonly:secret@db.example.test:5432/analytics\n");
    writeMdl(projectDir, ["previous_model"]);
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });
    const identity = contextLifecycleIdentityFingerprint(workspaceRoot, "acme", "postgres")!;
    store.mergeSetupContextLifecycleEvidence({ sessionId: session.id, identityFingerprint: identity, completed: "build" });

    const response = await app.request("/api/setup/context", { method: "POST" });
    const { turnId } = await response.json() as { turnId: string };
    expect(store.getTurn(turnId)?.contextRecovery).toBeNull();
    const frames = parseSse(await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text());

    expect(JSON.stringify(frames)).not.toContain('"status":"ok"');
    expect(store.getSetupContextLifecycleEvidence(session.id, identity)).toBeUndefined();
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("persists valid evidence across a DB reload and fails closed for another session or malformed state", () => {
    const dbDir = mkdtempSync(path.join(tmpdir(), "wren-harness-context-lifecycle-store-test-"));
    const dbPath = path.join(dbDir, "state.sqlite");
    const identity = "identity";
    const first = new Store(dbPath);
    first.mergeSetupContextLifecycleEvidence({ sessionId: "session-a", identityFingerprint: identity, completed: "validate" });
    first.close();

    const reopened = new Store(dbPath);
    expect(reopened.getSetupContextLifecycleEvidence("session-a", identity)).toMatchObject({ completed: "validate" });
    expect(reopened.getSetupContextLifecycleEvidence("session-b", identity)).toBeUndefined();
    expect(reopened.getSetupContextLifecycleEvidence("session-a", identity)).toBeUndefined();
    reopened.setConfigJson("setup.contextLifecycleEvidence", { sessionId: "session-a", identityFingerprint: identity, completed: "forged" });
    expect(reopened.getSetupContextLifecycleEvidence("session-a", identity)).toBeUndefined();
    expect(reopened.getConfigJson("setup.contextLifecycleEvidence")).toBeUndefined();
    reopened.close();
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("threads the persisted project name and connect_resume step into the runner without changing its workspace root", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-resume-cwd-test-"));
    const setupRunner = stubSetupRunner(async (opts) => {
      expect(opts).toMatchObject({
        workspaceRoot,
        projectName: "acme",
        stepKey: "connect_resume",
        resumeSessionId: undefined,
      });
      return { finalText: "SETUP_STATUS: needs_input - verify the remaining datasource field" };
    });
    const { app, store } = buildApp(undefined, { setupRunner, workspaceRoot });
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });

    const resume = await app.request("/api/setup/connect/resume", { method: "POST" });
    expect(resume.status).toBe(200);
    const { turnId } = (await resume.json()) as { turnId: string };
    await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text();
  });

  it("keeps one connect_resume SSE turn open for a single same-session host-contract correction", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-host-contract-recovery-test-"));
    const projectDir = path.join(workspaceRoot, "acme");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "wren_project.yml"), "name: acme\nprofile: acme-postgres\ndata_source: postgres\n");
    let calls = 0;
    const setupRunner = stubSetupRunner(async (opts) => {
      calls += 1;
      if (calls === 1) return { finalText: "SETUP_STATUS: ok - connection validated", sessionId: "sdk-connect-session" };
      expect(opts.resumeSessionId).toBe("sdk-connect-session");
      expect(opts.prompt).toMatch(/host-side validation rejected/i);
      expect(opts.prompt).toMatch(/\.wren-validated/i);
      expect(opts.prompt).toMatch(/do not read, print, or ask for credential values/i);
      writeFileSync(path.join(projectDir, ".wren-validated"), "");
      return { finalText: "SETUP_STATUS: ok - connection validated", sessionId: "sdk-connect-session" };
    });
    const { app, store } = buildApp(undefined, {
      setupRunner,
      workspaceRoot,
      getAuthChoice: () => ({ mode: "subscription", provider: "claude" }),
    });
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });

    const resume = await app.request("/api/setup/connect/resume", { method: "POST" });
    const { turnId } = (await resume.json()) as { turnId: string };
    const frames = parseSse(await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text());

    expect(calls).toBe(2);
    expect(frames.filter((frame) => frame.event === "done")).toHaveLength(1);
    expect(frames.some((frame) => frame.event === "error")).toBe(false);
    expect(frames.filter((frame) => frame.event === "event")).toHaveLength(1);
    expect(frames.some((frame) => frame.event === "worklog" && Array.isArray(frame.data) && frame.data.some((step) => step.label === "Host contract"))).toBe(true);
    expect(store.getTurn(turnId)?.resultKind).toBe("answer");
  });

  it("redacts bare anchors from completed host-contract re-emission and correction worklogs", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-host-contract-live-anchor-redaction-test-"));
    const projectDir = path.join(workspaceRoot, "acme");
    const originalAnchor = "sdk-host-contract-original-anchor";
    const replacementAnchor = "sdk-host-contract-replacement-anchor";
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "wren_project.yml"), "name: acme\nprofile: acme-postgres\ndata_source: postgres\n");
    let calls = 0;
    const setupRunner = stubSetupRunner(async (opts) => {
      calls += 1;
      opts.onEvent?.({
        runId: `host-anchor-${calls}`, seq: 1, kind: "tool.result", stepId: `host-anchor-${calls}`, callId: `host-anchor-${calls}`, tool: "setup_execution", status: "success",
        summary: `provider conversation ${calls === 1 ? originalAnchor : replacementAnchor} completed work`,
      });
      if (calls === 1) return { finalText: "SETUP_STATUS: ok - connection validated", sessionId: originalAnchor };
      expect(opts.resumeSessionId).toBe(originalAnchor);
      return { finalText: "SETUP_STATUS: error - correction needs user action", sessionId: replacementAnchor };
    });
    const { app, store } = buildApp(undefined, {
      setupRunner,
      workspaceRoot,
      getAuthChoice: () => ({ mode: "subscription", provider: "claude" }),
    });
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });

    const response = await app.request("/api/setup/connect/resume", { method: "POST" });
    const { turnId } = (await response.json()) as { turnId: string };
    const sse = await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text();
    const turn = store.getTurn(turnId)!;

    expect(calls).toBe(2);
    const combined = `${sse}${turn.errorMessage}${turn.traceJson}`.toLowerCase();
    for (const anchor of [originalAnchor, replacementAnchor]) expect(combined).not.toContain(anchor);
  });

  it("does not auto-retry a declared setup error, runner throw, or non-resumable in-process/Codex completion", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-host-contract-no-retry-test-"));
    const projectDir = path.join(workspaceRoot, "acme");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "wren_project.yml"), "name: acme\nprofile: acme-postgres\ndata_source: postgres\n");

    for (const [name, run] of [
      ["declared error", async () => ({ finalText: "SETUP_STATUS: error - authentication needs user action", sessionId: "sdk-session" })],
      ["runner throw", async () => { throw new Error("dispatcher timed out"); }],
      ["cancelled runner", async () => { throw new Error("dispatcher cancelled"); }],
      ["in-process", async () => ({ finalText: "SETUP_STATUS: ok - connection validated", sessionId: null })],
      ["Codex", async () => ({ finalText: "SETUP_STATUS: ok - connection validated" })],
    ] as const) {
      let calls = 0;
      const { app, store } = buildApp(undefined, {
        setupRunner: stubSetupRunner(async () => {
          calls += 1;
          return run();
        }),
        workspaceRoot,
      });
      const session = store.createSession(`Setup: ${name}`);
      store.setSetupSessionId(session.id);
      store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });
      const response = await app.request("/api/setup/connect/resume", { method: "POST" });
      const { turnId } = (await response.json()) as { turnId: string };
      const frames = parseSse(await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text());
      expect(calls, name).toBe(1);
      expect(frames.some((frame) => frame.event === "error"), name).toBe(true);
    }
  });

  it("retains the completed session anchor when its one host-contract correction still fails", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-host-contract-retain-session-test-"));
    const projectDir = path.join(workspaceRoot, "acme");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "wren_project.yml"), "name: acme\nprofile: acme-postgres\ndata_source: postgres\n");
    let calls = 0;
    const { app, store } = buildApp(undefined, {
      setupRunner: stubSetupRunner(async (opts) => {
        calls += 1;
        if (calls === 3) {
          expect(opts.resumeSessionId).toBe("sdk-retained-session");
          expect(opts.prompt).toMatch(/continue and repair the existing connect_resume setup attempt/i);
          writeFileSync(path.join(projectDir, ".wren-validated"), "");
        }
        return { finalText: "SETUP_STATUS: ok - connection validated", sessionId: "sdk-retained-session" };
      }),
      workspaceRoot,
      getAuthChoice: () => ({ mode: "subscription", provider: "claude" }),
    });
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });
    const response = await app.request("/api/setup/connect/resume", { method: "POST" });
    const { turnId } = (await response.json()) as { turnId: string };
    const frames = parseSse(await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text());

    expect(calls).toBe(2);
    expect(frames.filter((frame) => frame.event === "error")).toHaveLength(1);
    expect(frames.some((frame) => frame.event === "done")).toBe(false);
    expect(store.getTurn(turnId)).toMatchObject({
      resultKind: "error",
      resumeSessionId: "sdk-retained-session",
      resumeSessionProvider: "claude",
      resumeRunner: "subscription:claude",
    });

    const retry = await app.request("/api/setup/connect/resume", { method: "POST" });
    const { turnId: retryTurnId } = (await retry.json()) as { turnId: string };
    expect(store.getTurn(retryTurnId)?.resumeSessionId).toBe("sdk-retained-session");
    const retryFrames = parseSse(await (await app.request(`/api/sessions/${session.id}/stream?turn=${retryTurnId}`)).text());
    expect(calls).toBe(3);
    expect(retryFrames.filter((frame) => frame.event === "done")).toHaveLength(1);
  });

  it.each([
    ["claude", "codex"],
    ["codex", "claude"],
  ] as const)("never resumes a %s host-contract session through the %s runner", async (originProvider, currentProvider) => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-host-contract-cross-provider-test-"));
    let authChoice: AuthChoice = { mode: "subscription", provider: currentProvider };
    const setupRunner = stubSetupRunner(async (opts) => {
      expect(opts.resumeSessionId).toBeUndefined();
      expect(opts.prompt).toMatch(/continue and repair the existing connect_resume setup attempt/i);
      expect(opts.prompt).toContain("safe prior failure");
      expect(opts.prompt).toMatch(/preserve existing project files/i);
      return { finalText: "SETUP_STATUS: needs_input - user action required" };
    });
    const { app, store } = buildApp(undefined, {
      workspaceRoot,
      getAuthChoice: () => authChoice,
      setupRunnerFor: () => setupRunner,
    });
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });
    const priorTurnId = newId("turn");
    store.createTurn({
      id: priorTurnId,
      sessionId: session.id,
      question: "prior correction",
      composedInput: "prior correction",
      agentId: CONNECT_SOURCE_AGENT_ID,
      setupStepKey: "connect_resume",
    });
    store.resolveTurn(priorTurnId, { backend: null, resultKind: "error", answerSummary: null, traceJson: JSON.stringify([{ id: "decision-host-contract-recovery" }]), errorMessage: "safe prior failure" });
    store.setTurnResumeAnchor(priorTurnId, {
      sessionId: `sdk-${originProvider}`,
      provider: originProvider,
      runner: `subscription:${originProvider}`,
    });

    const response = await app.request("/api/setup/connect/resume", { method: "POST" });
    const { turnId } = (await response.json()) as { turnId: string };
    expect(store.getTurn(turnId)?.resumeSessionId).toBeNull();
    await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text();
    authChoice = { mode: "subscription", provider: currentProvider };
  });

  it.each([
    ["explicit SETUP_STATUS:error", async () => ({ finalText: "SETUP_STATUS: error - connection validation did not finish", sessionId: "sdk-terminal" }), "connection validation did not finish"],
    ["DispatchedSessionError", async () => { throw new DispatchedSessionError("dispatcher exited: error_max_turns", "sdk-terminal"); }, "error_max_turns"],
  ] as const)("persists a compatible anchor and uses a corrective connect_resume retry after %s", async (_name, firstRun, expectedFailure) => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-corrective-retry-test-"));
    let calls = 0;
    const { app, store } = buildApp(undefined, {
      workspaceRoot,
      getAuthChoice: () => ({ mode: "subscription", provider: "claude" }),
      setupRunner: stubSetupRunner(async (opts) => {
        calls += 1;
        if (calls === 1) return firstRun();
        expect(opts.resumeSessionId).toBe("sdk-terminal");
        expect(opts.prompt).toMatch(/continue and repair the existing connect_resume setup attempt/i);
        expect(opts.prompt).toContain(expectedFailure);
        expect(opts.prompt).toMatch(/do not replay the initial setup task/i);
        expect(opts.prompt).toMatch(/preserve existing project files/i);
        return { finalText: "SETUP_STATUS: needs_input - one user action remains", sessionId: "sdk-terminal" };
      }),
    });
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });

    const initial = await app.request("/api/setup/connect/resume", { method: "POST" });
    const { turnId: initialTurnId } = (await initial.json()) as { turnId: string };
    await (await app.request(`/api/sessions/${session.id}/stream?turn=${initialTurnId}`)).text();
    expect(store.getTurn(initialTurnId)).toMatchObject({ resultKind: "error", resumeSessionId: "sdk-terminal", resumeSessionProvider: "claude" });

    const retry = await app.request("/api/setup/connect/resume", { method: "POST" });
    const { turnId: retryTurnId } = (await retry.json()) as { turnId: string };
    expect(store.getTurn(retryTurnId)?.composedInput).not.toContain('Follow the wren onboarding skill');
    await (await app.request(`/api/sessions/${session.id}/stream?turn=${retryTurnId}`)).text();
    expect(calls).toBe(2);
  });

  it("repairs a missing terminal status in the same subscription session, revalidates host proof, and keeps rotated anchors private", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-terminal-contract-repair-test-"));
    const projectDir = path.join(workspaceRoot, "acme");
    const originalAnchor = "sdk-terminal-contract-original";
    const replacementAnchor = "sdk-terminal-contract-replacement";
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "wren_project.yml"), "name: acme\nprofile: acme-postgres\ndata_source: postgres\n");
    let calls = 0;
    const { app, store } = buildApp(undefined, {
      workspaceRoot,
      getAuthChoice: () => ({ mode: "subscription", provider: "claude" }),
      setupRunner: stubSetupRunner(async (opts) => {
        calls += 1;
        const anchor = calls === 1 ? originalAnchor : replacementAnchor;
        opts.onEvent?.({ runId: `terminal-${calls}`, seq: 1, kind: "tool.result", stepId: `terminal-${calls}`, callId: `terminal-${calls}`, tool: "setup_execution", status: "success", summary: `provider conversation ${anchor} completed work` });
        if (calls === 1) return { finalText: "connection validated but terminal line was omitted", sessionId: originalAnchor };
        expect(opts.resumeSessionId).toBe(originalAnchor);
        expect(opts.prompt).toMatch(/omitted the required SETUP_STATUS terminal line/i);
        expect(opts.prompt).toMatch(/do not replay, rebuild, clean, or overwrite/i);
        writeFileSync(path.join(projectDir, ".wren-validated"), "");
        return { finalText: "SETUP_STATUS: ok - connection validated", sessionId: replacementAnchor };
      }),
    });
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });

    const response = await app.request("/api/setup/connect/resume", { method: "POST" });
    const { turnId } = (await response.json()) as { turnId: string };
    const sse = await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text();
    const turn = store.getTurn(turnId)!;
    expect(calls).toBe(2);
    expect(turn.resultKind).toBe("answer");
    expect(turn.answerSummary).toContain("connection validated");
    expect(store.getSetupSteps().find((step) => step.key === "connect")?.state).toBe("done");
    const combined = `${sse}${turn.answerSummary}${turn.traceJson}`.toLowerCase();
    for (const anchor of [originalAnchor, replacementAnchor]) expect(combined).not.toContain(anchor);
  });

  it("rejects a corrected false ok at the host contract without a second automatic correction", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-terminal-contract-false-ok-test-"));
    const projectDir = path.join(workspaceRoot, "acme");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "wren_project.yml"), "name: acme\nprofile: acme-postgres\ndata_source: postgres\n");
    let calls = 0;
    const { app, store } = buildApp(undefined, {
      workspaceRoot,
      getAuthChoice: () => ({ mode: "subscription", provider: "claude" }),
      setupRunner: stubSetupRunner(async () => {
        calls += 1;
        return calls === 1
          ? { finalText: "terminal omitted", sessionId: "sdk-false-ok" }
          : { finalText: "SETUP_STATUS: ok - connection validated", sessionId: "sdk-false-ok" };
      }),
    });
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });
    const response = await app.request("/api/setup/connect/resume", { method: "POST" });
    const { turnId } = (await response.json()) as { turnId: string };
    await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text();

    expect(calls).toBe(2);
    expect(store.getTurn(turnId)?.resultKind).toBe("error");
    expect(store.getTurn(turnId)?.errorMessage).toMatch(/host contract/i);
  });

  it.each([
    ["missing terminal again", "terminal still omitted"],
    ["declared error", "SETUP_STATUS: error - correction needs user action"],
  ])("stops after one terminal-contract correction when the correction has %s", async (_name, correctionFinalText) => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-terminal-contract-stop-test-"));
    let calls = 0;
    const { app, store } = buildApp(undefined, {
      workspaceRoot,
      getAuthChoice: () => ({ mode: "subscription", provider: "claude" }),
      setupRunner: stubSetupRunner(async () => {
        calls += 1;
        return calls === 1
          ? { finalText: "terminal omitted", sessionId: "sdk-stop-terminal" }
          : { finalText: correctionFinalText, sessionId: "sdk-stop-terminal" };
      }),
    });
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });
    const response = await app.request("/api/setup/connect/resume", { method: "POST" });
    const { turnId } = (await response.json()) as { turnId: string };
    await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text();

    expect(calls).toBe(2);
    expect(store.getTurn(turnId)?.resultKind).toBe("error");
  });

  it("persists a safe actionable failure when the one terminal-contract correction throws", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-terminal-contract-throw-test-"));
    const originalAnchor = "sdk-terminal-throw-original";
    const thrownAnchor = "sdk-terminal-throw-replacement";
    let calls = 0;
    const { app, store } = buildApp(undefined, {
      workspaceRoot,
      getAuthChoice: () => ({ mode: "subscription", provider: "claude" }),
      setupRunner: stubSetupRunner(async () => {
        calls += 1;
        if (calls === 1) return { finalText: "terminal omitted", sessionId: originalAnchor };
        throw new DispatchedSessionError(`provider=claude sessionId=${thrownAnchor} correction dispatcher failed`, thrownAnchor);
      }),
    });
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });
    const response = await app.request("/api/setup/connect/resume", { method: "POST" });
    const { turnId } = (await response.json()) as { turnId: string };
    const sse = await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text();
    const turn = store.getTurn(turnId)!;

    expect(calls).toBe(2);
    expect(turn).toMatchObject({ resultKind: "error", errorMessage: expect.stringMatching(/terminal-contract correction did not complete/i) });
    const combined = `${sse}${turn.errorMessage}${turn.traceJson}`.toLowerCase();
    for (const anchor of [originalAnchor, thrownAnchor, "claude"]) expect(combined).not.toContain(anchor);
  });

  it("leaves a missing terminal without a compatible anchor for an explicit corrective retry", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-terminal-contract-no-anchor-test-"));
    let calls = 0;
    const { app, store } = buildApp(undefined, {
      workspaceRoot,
      setupRunner: stubSetupRunner(async () => {
        calls += 1;
        return { finalText: "terminal omitted with no resumable session" };
      }),
    });
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });
    const initial = await app.request("/api/setup/connect/resume", { method: "POST" });
    const { turnId: initialTurnId } = (await initial.json()) as { turnId: string };
    await (await app.request(`/api/sessions/${session.id}/stream?turn=${initialTurnId}`)).text();
    expect(calls).toBe(1);
    expect(store.getTurn(initialTurnId)).toMatchObject({ resultKind: "error", resumeSessionId: null });

    const retry = await app.request("/api/setup/connect/resume", { method: "POST" });
    const { turnId: retryTurnId } = (await retry.json()) as { turnId: string };
    expect(retryTurnId).not.toBe(initialTurnId);
    expect(store.getTurn(retryTurnId)?.composedInput).toMatch(/continue and repair/i);
  });

  it("falls back to a fresh corrective connect_resume attempt without an anchor and coalesces duplicate retry POSTs", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-corrective-fallback-test-"));
    const { app, store } = buildApp(undefined, {
      workspaceRoot,
      setupRunner: stubSetupRunner(async () => ({ finalText: "SETUP_STATUS: needs_input - user action required" })),
    });
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "duckdb-acme", sourceType: "duckdb" });
    const failedTurn = newId("turn");
    store.createTurn({ id: failedTurn, sessionId: session.id, question: "old", composedInput: "old", agentId: CONNECT_SOURCE_AGENT_ID, setupStepKey: "connect_resume" });
    store.resolveTurn(failedTurn, { backend: null, resultKind: "error", answerSummary: null, traceJson: JSON.stringify([{ id: "finished", label: "Scaffold", state: "done", kind: "step", detail: "project exists" }]), errorMessage: "the setup agent's final message did not contain a SETUP_STATUS line" });

    const [first, second] = await Promise.all([
      app.request("/api/setup/connect/resume", { method: "POST" }),
      app.request("/api/setup/connect/resume", { method: "POST" }),
    ]);
    const firstBody = await first.json() as { turnId: string };
    const secondBody = await second.json() as { turnId: string };
    expect(firstBody.turnId).toBe(secondBody.turnId);
    const retry = store.getTurn(firstBody.turnId)!;
    expect(retry.resumeSessionId).toBeNull();
    expect(retry.composedInput).toMatch(/continue and repair/i);
    expect(retry.composedInput).toContain("did not contain a SETUP_STATUS");
    expect(retry.composedInput).toContain("Scaffold (project exists)");
    expect(retry.composedInput).toMatch(/credential form for the "duckdb" data source; treat that handoff as verified host fact/i);
    expect(retry.composedInput).toContain('"duckdb" data source');
    expect(retry.composedInput).toContain('wren project "duckdb-acme"');
    expect(retry.composedInput).toContain(`"${path.join(workspaceRoot, "duckdb-acme")}"`);
    expect(retry.composedInput).toContain('wren docs connection-info duckdb');
    expect(retry.composedInput).not.toContain("<sourceType>");
    expect(retry.composedInput).toMatch(/do not inspect \.env in any form/i);
    for (const command of ["cat", "sed", "cut", "grep", "head", "tail", "awk"]) {
      expect(retry.composedInput).toContain(command);
    }
    expect(retry.composedInput).toMatch(/do not .*list its keys/i);
    expect(retry.composedInput).toMatch(/do not .*test its contents/i);
    expect(retry.composedInput).toMatch(/do not .*ask setup_execution to read it/i);
    expect(retry.composedInput).toMatch(/run "wren profile add" using that actual pinned profile name/i);
    expect(retry.composedInput).toContain('inspect wren_project.yml, never .env, for the currently pinned profile name');
    expect(retry.composedInput).toContain('"conn.profile.yml" declares "datasource: duckdb"');
    expect(retry.composedInput).toContain('"--from-file conn.profile.yml"');
    expect(retry.composedInput).not.toContain("<pinned-profile-name>");
    expect(retry.composedInput).toMatch(/without "--activate"/i);
    expect(retry.composedInput).toMatch(/only after that command genuinely reports successful validation, create the empty project-relative sentinel "\.wren-validated"/i);
    expect(retry.composedInput).toMatch(/never create it after failed or uncertain validation/i);
    expect(retry.composedInput).toContain('"SETUP_STATUS: ok - connection validated"');
    expect(retry.composedInput).toContain('"SETUP_STATUS: needs_input - <reason>"');
    expect(retry.composedInput).toContain('"SETUP_STATUS: error - <reason>"');
  });

  it("does not coalesce a restart-orphaned setup turn behind a later failure, while duplicate corrective clicks still coalesce", async () => {
    const dbDir = mkdtempSync(path.join(tmpdir(), "wren-harness-restart-retry-store-"));
    const dbPath = path.join(dbDir, "bff.sqlite");
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-restart-retry-root-"));
    try {
      const beforeRestart = new Store(dbPath);
      const session = beforeRestart.createSession("Setup: acme");
      beforeRestart.setSetupSessionId(session.id);
      beforeRestart.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });
      beforeRestart.createTurn({
        id: "orphaned-connect-resume",
        sessionId: session.id,
        question: "old pending setup",
        composedInput: "old pending setup",
        agentId: CONNECT_SOURCE_AGENT_ID,
        setupStepKey: "connect_resume",
        traceJson: '[{"detail":"sdk-orphaned-anchor"}]',
      });
      beforeRestart.createTurn({
        id: "later-failed-connect-resume",
        sessionId: session.id,
        question: "later failed setup",
        composedInput: "later failed setup",
        agentId: CONNECT_SOURCE_AGENT_ID,
        setupStepKey: "connect_resume",
      });
      beforeRestart.resolveTurn("later-failed-connect-resume", {
        backend: null,
        resultKind: "error",
        answerSummary: null,
        traceJson: "[]",
        errorMessage: "later persisted failure",
      });
      beforeRestart.close();

      const reopened = new Store(dbPath);
      const { app, store } = buildApp(undefined, {
        store: reopened,
        workspaceRoot,
        setupRunner: stubSetupRunner(async () => ({ finalText: "SETUP_STATUS: needs_input - user action required" })),
      });
      expect(store.getTurn("orphaned-connect-resume")).toMatchObject({ resultKind: "error", traceJson: "[]" });

      const [first, second] = await Promise.all([
        app.request("/api/setup/connect/resume", { method: "POST" }),
        app.request("/api/setup/connect/resume", { method: "POST" }),
      ]);
      const firstBody = await first.json() as { turnId: string };
      const secondBody = await second.json() as { turnId: string };
      expect(firstBody.turnId).toBe(secondBody.turnId);
      expect(firstBody.turnId).not.toBe("orphaned-connect-resume");
      expect(firstBody.turnId).not.toBe("later-failed-connect-resume");
      const retry = store.getTurn(firstBody.turnId)!;
      expect(retry).toMatchObject({ resultKind: null, setupStepKey: "connect_resume" });
      expect(retry.composedInput).toContain("Continue and repair");
      expect(retry.composedInput).toContain("later persisted failure");
      reopened.close();
    } finally {
      rmSync(dbDir, { recursive: true, force: true });
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("allows only the exact failed initial connect to repair its non-empty scaffold without cleaning it", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-initial-connect-repair-test-"));
    const projectDir = path.join(workspaceRoot, "acme");
    let calls = 0;
    const { app, store } = buildApp(undefined, {
      workspaceRoot,
      setupRunner: stubSetupRunner(async (opts) => {
        calls += 1;
        if (calls === 1) {
          mkdirSync(projectDir, { recursive: true });
          writeFileSync(path.join(projectDir, "keep.txt"), "preserve me");
          return { finalText: "scaffold complete but terminal omitted" };
        }
        expect(opts.prompt).toMatch(/continue and repair the existing connect setup attempt/i);
        expect(readFileSync(path.join(projectDir, "keep.txt"), "utf-8")).toBe("preserve me");
        return { finalText: "SETUP_STATUS: needs_input - credentials are needed" };
      }),
    });

    const initial = await app.request("/api/setup/connect", { method: "POST", body: JSON.stringify({ projectName: "acme", sourceType: "postgres" }) });
    const { sessionId, turnId } = (await initial.json()) as { sessionId: string; turnId: string };
    await (await app.request(`/api/sessions/${sessionId}/stream?turn=${turnId}`)).text();
    expect(store.getTurn(turnId)?.resultKind).toBe("error");

    const retry = await app.request("/api/setup/connect", { method: "POST", body: JSON.stringify({ projectName: "acme", sourceType: "postgres" }) });
    expect(retry.status).toBe(200);
    const { turnId: retryTurnId } = (await retry.json()) as { turnId: string };
    await (await app.request(`/api/sessions/${sessionId}/stream?turn=${retryTurnId}`)).text();
    expect(calls).toBe(2);
    expect(readFileSync(path.join(projectDir, "keep.txt"), "utf-8")).toBe("preserve me");
  });

  it("uses the same compatible corrective continuation for a persisted context failure", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-context-corrective-retry-test-"));
    let calls = 0;
    const { app, store } = buildApp(undefined, {
      workspaceRoot,
      getAuthChoice: () => ({ mode: "subscription", provider: "claude" }),
      setupRunner: stubSetupRunner(async (opts) => {
        calls += 1;
        if (calls === 1) return { finalText: "SETUP_STATUS: error - context validation stopped before the required terminal line", sessionId: "sdk-context" };
        expect(opts.resumeSessionId).toBe("sdk-context");
        expect(opts.prompt).toMatch(/continue and repair the existing context setup attempt/i);
        expect(opts.prompt).toContain("context validation stopped before the required terminal line");
        return { finalText: "SETUP_STATUS: needs_input - source needs attention", sessionId: "sdk-context" };
      }),
    });
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });

    const initial = await app.request("/api/setup/context", { method: "POST" });
    const { turnId: initialTurnId } = (await initial.json()) as { turnId: string };
    await (await app.request(`/api/sessions/${session.id}/stream?turn=${initialTurnId}`)).text();
    const retry = await app.request("/api/setup/context", { method: "POST" });
    const { turnId: retryTurnId } = (await retry.json()) as { turnId: string };
    await (await app.request(`/api/sessions/${session.id}/stream?turn=${retryTurnId}`)).text();
    expect(calls).toBe(2);
  });

  it("adds the fresh-discovery addendum to a context corrective retry against an already-built project", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-context-rediscovery-addendum-test-"));
    let calls = 0;
    const { app, store } = buildApp(undefined, {
      workspaceRoot,
      getAuthChoice: () => ({ mode: "subscription", provider: "claude" }),
      setupRunner: stubSetupRunner(async (opts) => {
        calls += 1;
        if (calls === 1) {
          return {
            finalText:
              "SETUP_STATUS: error - project setup complete and functional, but host SDK reports warble_ir_version mismatch (0.4 vs 0.3 expected) which is an infrastructure issue outside project scope",
            sessionId: "sdk-context-rediscovery",
          };
        }
        expect(opts.prompt).toContain("may already be stale or resolved");
        expect(opts.prompt).toContain("schema discovery is the one step you must re-run regardless");
        expect(opts.prompt).toContain("warble_ir_version mismatch (0.4 vs 0.3 expected)");
        expect(opts.prompt).toMatch(/do NOT run "wren --sql" for schema discovery/i);
        expect(opts.prompt).toContain("resolve_profile_for_project(Path.cwd(), strict=True)");
        expect(opts.prompt).toMatch(/DUCKDB_URL is a DIRECTORY containing one or more \.duckdb files/i);
        return { finalText: "SETUP_STATUS: needs_input - source needs attention", sessionId: "sdk-context-rediscovery" };
      }),
    });
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });

    const initial = await app.request("/api/setup/context", { method: "POST" });
    const { turnId: initialTurnId } = (await initial.json()) as { turnId: string };
    await (await app.request(`/api/sessions/${session.id}/stream?turn=${initialTurnId}`)).text();
    const retry = await app.request("/api/setup/context", { method: "POST" });
    const { turnId: retryTurnId } = (await retry.json()) as { turnId: string };
    await (await app.request(`/api/sessions/${session.id}/stream?turn=${retryTurnId}`)).text();
    expect(calls).toBe(2);
  });

  it("does not add the context-only re-discovery addendum to a connect corrective retry", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-connect-no-rediscovery-addendum-test-"));
    const projectDir = path.join(workspaceRoot, "acme");
    let calls = 0;
    const { app } = buildApp(undefined, {
      workspaceRoot,
      setupRunner: stubSetupRunner(async (opts) => {
        calls += 1;
        if (calls === 1) {
          mkdirSync(projectDir, { recursive: true });
          return { finalText: "scaffold complete but terminal omitted" };
        }
        expect(opts.prompt).toMatch(/continue and repair the existing connect setup attempt/i);
        expect(opts.prompt).not.toContain("may already be stale or resolved");
        expect(opts.prompt).not.toContain("schema discovery is the one step you must re-run regardless");
        return { finalText: "SETUP_STATUS: needs_input - credentials are needed" };
      }),
    });

    const initial = await app.request("/api/setup/connect", { method: "POST", body: JSON.stringify({ projectName: "acme", sourceType: "postgres" }) });
    const { sessionId, turnId } = (await initial.json()) as { sessionId: string; turnId: string };
    await (await app.request(`/api/sessions/${sessionId}/stream?turn=${turnId}`)).text();

    const retry = await app.request("/api/setup/connect", { method: "POST", body: JSON.stringify({ projectName: "acme", sourceType: "postgres" }) });
    expect(retry.status).toBe(200);
    const { turnId: retryTurnId } = (await retry.json()) as { turnId: string };
    await (await app.request(`/api/sessions/${sessionId}/stream?turn=${retryTurnId}`)).text();
    expect(calls).toBe(2);
  });

  it("keeps an adopted context corrective retry in its failed turn's parent workspace", async () => {
    const bootstrapRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-bootstrap-context-retry-root-"));
    const adoptedRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-adopted-context-retry-root-"));
    const bootstrapProject = path.join(bootstrapRoot, "acme");
    const adoptedProject = path.join(adoptedRoot, "acme");
    mkdirSync(bootstrapProject, { recursive: true });
    mkdirSync(adoptedProject, { recursive: true });
    writeFileSync(path.join(bootstrapProject, "bootstrap-only.txt"), "must not be selected");
    writeFileSync(path.join(adoptedProject, "adopted-only.txt"), "must be selected");

    const { app, store } = buildApp(undefined, {
      workspaceRoot: bootstrapRoot,
      userProject: adoptedProject,
      setupRunner: stubSetupRunner(async (opts) => {
        const runWorkspaceRoot = opts.workspaceRoot;
        const runProjectName = opts.projectName;
        expect(runWorkspaceRoot).toBe(adoptedRoot);
        if (runWorkspaceRoot === undefined) throw new Error("adopted retry must pass a workspace root");
        expect(runProjectName).toBe("acme");
        if (runProjectName === undefined) throw new Error("adopted retry must pass a project name");
        expect(existsSync(path.join(runWorkspaceRoot, runProjectName, "adopted-only.txt"))).toBe(true);
        expect(existsSync(path.join(runWorkspaceRoot, runProjectName, "bootstrap-only.txt"))).toBe(false);
        return { finalText: "SETUP_STATUS: needs_input - source needs attention" };
      }),
    });
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });
    const failedTurnId = newId("turn");
    store.createTurn({
      id: failedTurnId,
      sessionId: session.id,
      question: "context",
      composedInput: "context",
      agentId: BUILD_CONTEXT_AGENT_ID,
      setupStepKey: "context",
      workspaceRoot: adoptedRoot,
    });
    store.resolveTurn(failedTurnId, {
      backend: null,
      resultKind: "error",
      answerSummary: null,
      traceJson: "[]",
      errorMessage: "context terminal was missing",
    });

    const response = await app.request("/api/setup/context", { method: "POST" });
    expect(response.status).toBe(200);
    const { turnId } = (await response.json()) as { turnId: string };
    const retryTurn = store.getTurn(turnId)!;
    expect(retryTurn.workspaceRoot).toBe(adoptedRoot);
    expect(retryTurn.composedInput).toContain(adoptedRoot);
    expect(retryTurn.composedInput).not.toContain(bootstrapRoot);
    await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text();
    expect(readFileSync(path.join(bootstrapProject, "bootstrap-only.txt"), "utf8")).toBe("must not be selected");
  });

  it("redacts a secret-bearing discovery failure from recovery SSE, persistence, and retry prompts while preserving host-step ordering", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-host-contract-redaction-test-"));
    const secrets = ["schema-discovery-secret", "bearer-header-secret", "basic-header-secret", "api-header-secret"];
    const projectDir = path.join(workspaceRoot, "acme");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "wren_project.yml"), "name: acme\n");
    let calls = 0;
    const setupRunner = stubSetupRunner(async (opts) => {
      calls += 1;
      if (calls === 1) {
        writeMdl(projectDir, ["customers"]);
        opts.onEvent?.({
          runId: "redaction",
          seq: 1,
          kind: "tool.call",
          stepId: "build",
          callId: "secret-discovery",
          tool: "setup_execution",
          input: {
            command: `wren --sql \"SELECT table_name FROM information_schema.tables\" PASSWORD=${secrets[0]} -H 'Authorization: Bearer ${secrets[1]}' -H 'authorization: Basic ${secrets[2]}' -H 'X-API-Key: ${secrets[3]}'`,
          },
          depth: 0,
          status: "running",
        });
        opts.onEvent?.({ runId: "redaction", seq: 2, kind: "tool.result", stepId: "build", callId: "secret-discovery", tool: "setup_execution", status: "success", summary: `{"exitCode":2,"stderr":"PASSWORD=${secrets[0]}"}` });
        return { finalText: `SETUP_STATUS: ok - ${secrets[0]}`, sessionId: "sdk-redacted" };
      }
      for (const secret of secrets) expect(opts.prompt).not.toContain(secret);
      opts.onEvent?.({ runId: "redaction-recovery", seq: 1, kind: "tool.call", stepId: "build", callId: "correction", tool: "setup_execution", input: { command: "wren context build" }, depth: 0, status: "running" });
      return { finalText: `SETUP_STATUS: error - ${secrets[0]}`, sessionId: "sdk-redacted" };
    });
    const { app, store } = buildApp(undefined, {
      setupRunner,
      workspaceRoot,
      getAuthChoice: () => ({ mode: "subscription", provider: "claude" }),
    });
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });
    const response = await app.request("/api/setup/context", { method: "POST" });
    const { turnId } = (await response.json()) as { turnId: string };
    const rawSse = await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text();
    const turn = store.getTurn(turnId)!;

    expect(calls).toBe(2);
    for (const secret of secrets) {
      expect(rawSse).not.toContain(secret);
      expect(turn.errorMessage).not.toContain(secret);
      expect(turn.traceJson).not.toContain(secret);
    }
    const trace = JSON.parse(turn.traceJson ?? "[]") as Array<{ id?: string }>;
    expect(trace.map((step) => step.id)).toEqual(["secret-discovery", "decision-host-contract-recovery", "correction"]);

    const retry = await app.request("/api/setup/context", { method: "POST" });
    const { turnId: retryTurnId } = (await retry.json()) as { turnId: string };
    const retryTurn = store.getTurn(retryTurnId)!;
    for (const secret of secrets) expect(retryTurn.composedInput).not.toContain(secret);
    expect(retryTurn.resumeSessionId).toBe("sdk-redacted");
  });

  it("a successful-looking context build without discovery automatically corrects once in the same SDK session and original SSE turn", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-context-retry-test-"));
    let contextRuns = 0;
    const setupRunner = stubSetupRunner(async (opts) => {
      if (opts.agentId !== "build_context") return { finalText: "SETUP_STATUS: ok - connected" };
      contextRuns += 1;
      writeMdl(path.join(workspaceRoot, "acme"), ["customers"]);
      if (contextRuns === 1) {
        opts.onEvent?.({
          runId: "test-run",
          seq: 1,
          kind: "tool.call",
          stepId: "build",
          callId: "build-without-discovery",
          tool: "setup_execution",
          input: { command: "wren context build" },
          depth: 0,
          status: "running",
        });
        opts.onEvent?.({
          runId: "test-run",
          seq: 2,
          kind: "tool.result",
          stepId: "build",
          callId: "build-without-discovery",
          tool: "setup_execution",
          status: "success",
          summary: '{"exitCode":0,"stdout":"built","stderr":""}',
        });
        return { finalText: "SETUP_STATUS: ok - built MDL", sessionId: "sdk-context-session" };
      }
      expect(opts.resumeSessionId).toBe("sdk-context-session");
      expect(opts.prompt).toMatch(/host-side validation rejected/i);
      expect(opts.prompt).toMatch(/recognized schema-discovery command/i);
      recordSuccessfulSchemaDiscovery(opts.onEvent);
      return { finalText: "SETUP_STATUS: ok - built MDL with 1 model and 1 measure", sessionId: "sdk-context-session" };
    });
    const { app, store } = buildApp(async () => bundleWithGatedCheck(true), { setupRunner, workspaceRoot, getAuthChoice: () => ({ mode: "subscription", provider: "claude" }) });
    configureSubscriptionRuntime(store);
    mkdirSync(path.join(workspaceRoot, "acme"), { recursive: true });
    writeFileSync(path.join(workspaceRoot, "acme", "wren_project.yml"), "name: acme\n");
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "duckdb" });

    const initial = await app.request("/api/setup/context", { method: "POST" });
    const { turnId: initialTurnId } = (await initial.json()) as { turnId: string };
    const initialFrames = parseSse(await (await app.request(`/api/sessions/${session.id}/stream?turn=${initialTurnId}`)).text());
    const finalStatus = initialFrames.find((frame) => frame.event === "event")?.data as SetupStatusEvent;
    expect(finalStatus).toMatchObject({ status: "ok" });
    expect(initialFrames.filter((frame) => frame.event === "done")).toHaveLength(1);
    expect(initialFrames.some((frame) => frame.event === "error")).toBe(false);
    expect(initialFrames.some((frame) => frame.event === "worklog" && Array.isArray(frame.data) && frame.data.some((step) => step.label === "Host contract"))).toBe(true);
    expect(store.getSession(session.id)?.status).toBe("active");
    expect(store.getTurn(initialTurnId)?.contextRecovery).toBeNull();
    expect(JSON.parse(store.getTurn(initialTurnId)?.traceJson ?? "[]")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inspection: expect.objectContaining({ action: "wren context build" }) }),
        expect.objectContaining({ label: "Host contract", state: "error", kind: "decision" }),
      ]),
    );
    expect(contextRuns).toBe(2);
  });

  it("keeps the explicit schema-discovery checkpoint when a claimed success has no resumable SDK session", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-context-pending-decision-test-"));
    let contextRuns = 0;
    const setupRunner = stubSetupRunner(async (opts) => {
      contextRuns += 1;
      writeMdl(path.join(workspaceRoot, "acme"), ["customers"]);
      return { finalText: "SETUP_STATUS: ok - built MDL", sessionId: null };
    });
    const { app, store } = buildApp(undefined, { setupRunner, workspaceRoot });
    mkdirSync(path.join(workspaceRoot, "acme"), { recursive: true });
    writeFileSync(path.join(workspaceRoot, "acme", "wren_project.yml"), "name: acme\n");
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "duckdb" });

    const initial = await app.request("/api/setup/context", { method: "POST" });
    const { turnId: initialTurnId } = (await initial.json()) as { turnId: string };
    await (await app.request(`/api/sessions/${session.id}/stream?turn=${initialTurnId}`)).text();
    const checkpoint = store.getSession(session.id);
    expect(checkpoint?.status).toBe("awaiting_decision");
    expect(checkpoint?.pendingDecision).toContain("schema_discovery_retry");

    const bypass = await app.request("/api/setup/context", { method: "POST" });
    expect(bypass.status).toBe(409);
    expect(await bypass.json()).toMatchObject({ error: expect.stringContaining("pending decision") });
    expect(store.getLatestTurn(session.id)?.id).toBe(initialTurnId);
    expect(store.getSession(session.id)).toMatchObject({ status: "awaiting_decision", pendingDecision: checkpoint?.pendingDecision });
    expect(contextRuns).toBe(1);
  });

  it("drops a captured Mode-B session and uses the selected Mode-A runner when runtime changed before schema-discovery retry", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-context-runtime-switch-test-"));
    let currentAuth: AuthChoice = { mode: "subscription", provider: "claude" };
    const dispatchedRunner = stubSetupRunner(async () => {
      throw new Error("dispatched must not run after the runtime switch");
    });
    const inProcessRunner = stubSetupRunner(async (opts) => {
      expect(opts.resumeSessionId).toBeUndefined();
      expect(opts.authChoice).toEqual({ mode: "api-key", adapter: "mock" });
      expect(opts.prompt).toMatch(/prior attempt.*did not complete recognized schema discovery/i);
      expect(opts.prompt).not.toMatch(/continue this same conversation/i);
      recordSuccessfulSchemaDiscovery(opts.onEvent);
      writeMdl(path.join(workspaceRoot, "acme"), ["customers"]);
      return { finalText: "SETUP_STATUS: ok - built MDL" };
    });
    const { app, store } = buildApp(undefined, {
      workspaceRoot,
      getAuthChoice: () => currentAuth,
      setupRunnerFor: (choice) => (choice.mode === "subscription" ? dispatchedRunner : inProcessRunner),
    });
    mkdirSync(path.join(workspaceRoot, "acme"), { recursive: true });
    writeFileSync(path.join(workspaceRoot, "acme", "wren_project.yml"), "name: acme\n");
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "duckdb" });
    store.updateSessionDecision(
      session.id,
      "awaiting_decision",
      JSON.stringify({ kind: "schema_discovery_retry", stepKey: "context", sessionId: "dispatched-session" }),
    );
    currentAuth = { mode: "api-key", adapter: "mock" };

    const retry = await app.request("/api/setup/decision", { method: "POST", body: JSON.stringify({ sessionId: session.id, choiceId: "retry" }) });
    expect(retry.status).toBe(200);
    const { turnId } = (await retry.json()) as { turnId: string };
    expect(store.getTurn(turnId)).toMatchObject({ contextRecovery: "schema_discovery", resumeSessionId: null });

    await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text();
  });

  it("bounds malformed, incompatible, and stale persisted decisions without replacing them, while a valid stop remains resolvable exactly once", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-malformed-decision-test-"));
    const setupRunner = stubSetupRunner(async () => ({ finalText: "SETUP_STATUS: ok" }));
    const { app, store } = buildApp(undefined, { setupRunner, workspaceRoot });
    const session = store.createSession("Setup: acme");

    store.updateSessionDecision(session.id, "awaiting_decision", "{not-json");
    let response = await app.request("/api/setup/decision", { method: "POST", body: JSON.stringify({ sessionId: session.id, choiceId: "retry" }) });
    expect(response.status).toBe(409);
    expect(store.getSession(session.id)).toMatchObject({ status: "awaiting_decision", pendingDecision: "{not-json" });

    const wrongShape = JSON.stringify({ kind: "schema_discovery_retry", stepKey: "context", sessionId: 42 });
    store.updateSessionDecision(session.id, "awaiting_decision", wrongShape);
    response = await app.request("/api/setup/decision", { method: "POST", body: JSON.stringify({ sessionId: session.id, choiceId: "retry" }) });
    expect(response.status).toBe(409);
    expect(store.getSession(session.id)).toMatchObject({ status: "awaiting_decision", pendingDecision: wrongShape });

    const wrongVariant = JSON.stringify({ kind: "future_decision" });
    store.updateSessionDecision(session.id, "awaiting_decision", wrongVariant);
    response = await app.request("/api/setup/decision", { method: "POST", body: JSON.stringify({ sessionId: session.id, choiceId: "retry" }) });
    expect(response.status).toBe(409);
    expect(store.getSession(session.id)).toMatchObject({ status: "awaiting_decision", pendingDecision: wrongVariant });

    const validPending = JSON.stringify({ kind: "schema_discovery_retry", stepKey: "context" });
    store.updateSessionDecision(session.id, "awaiting_decision", validPending);
    response = await app.request("/api/setup/decision", { method: "POST", body: JSON.stringify({ sessionId: session.id, choiceId: "unexpected" }) });
    expect(response.status).toBe(400);
    expect(store.getSession(session.id)).toMatchObject({ status: "awaiting_decision", pendingDecision: validPending });

    response = await app.request("/api/setup/decision", { method: "POST", body: JSON.stringify({ sessionId: session.id, choiceId: "stop" }) });
    expect(response.status).toBe(200);
    expect(store.getSession(session.id)).toMatchObject({ status: "active", pendingDecision: null });

    response = await app.request("/api/setup/decision", { method: "POST", body: JSON.stringify({ sessionId: session.id, choiceId: "stop" }) });
    expect(response.status).toBe(409);
    expect(store.getLatestTurn(session.id)).toBeUndefined();
  });

  it("a recovery turn that skips discovery again terminates instead of offering a second retry", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-context-no-loop-test-"));
    let contextRuns = 0;
    const setupRunner = stubSetupRunner(async (opts) => {
      if (opts.agentId !== "build_context") return { finalText: "SETUP_STATUS: ok - connected" };
      contextRuns += 1;
      writeMdl(path.join(workspaceRoot, "acme"), ["customers"]);
      return { finalText: "SETUP_STATUS: ok - built MDL" };
    });
    const { app, store } = buildApp(undefined, { setupRunner, workspaceRoot });
    mkdirSync(path.join(workspaceRoot, "acme"), { recursive: true });
    writeFileSync(path.join(workspaceRoot, "acme", "wren_project.yml"), "name: acme\n");
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "duckdb" });

    const initial = await app.request("/api/setup/context", { method: "POST" });
    const { turnId: initialTurnId } = (await initial.json()) as { turnId: string };
    await (await app.request(`/api/sessions/${session.id}/stream?turn=${initialTurnId}`)).text();
    const retry = await app.request("/api/setup/decision", { method: "POST", body: JSON.stringify({ sessionId: session.id, choiceId: "retry" }) });
    const { turnId: retryTurnId } = (await retry.json()) as { turnId: string };
    const frames = parseSse(await (await app.request(`/api/sessions/${session.id}/stream?turn=${retryTurnId}`)).text());

    expect(frames).toEqual(expect.arrayContaining([expect.objectContaining({ event: "error" })]));
    expect(frames.some((frame) => frame.event === "event" && (frame.data as { status?: string }).status === "needs_decision")).toBe(false);
    expect(store.getSession(session.id)?.status).toBe("active");
    expect(contextRuns).toBe(2);
  });

  it("a marked schema-discovery recovery that hits max turns terminates instead of chaining to the normal Continue checkpoint", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-context-max-turn-test-"));
    const setupRunner = stubSetupRunner(async () => {
      throw new Error("error_max_turns");
    });
    const { app, store } = buildApp(undefined, { setupRunner, workspaceRoot });
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "duckdb" });
    const turnId = newId("turn");
    store.createTurn({
      id: turnId,
      sessionId: session.id,
      question: "corrective schema discovery",
      composedInput: "corrective schema discovery",
      agentId: BUILD_CONTEXT_AGENT_ID,
      setupStepKey: "context",
      contextRecovery: "schema_discovery",
    });

    const frames = parseSse(await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text());

    const error = frames.find((frame) => frame.event === "error")?.data as { message?: string } | undefined;
    expect(error?.message).toMatch(/one permitted schema-discovery retry ran out of turns/i);
    expect(frames.some((frame) => frame.event === "event" && (frame.data as { status?: string }).status === "needs_decision")).toBe(false);
    expect(store.getSession(session.id)?.status).toBe("active");
  });

  it("a context turn that reports needs_input does not advance context->done or bind->current", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-context-test-"));
    let boundProject: string | undefined;
    const setupRunner = stubSetupRunner(async (opts) => {
      if (opts.agentId === "build_context") {
        return { finalText: "Ambiguous relationship detected.\nSETUP_STATUS: needs_input - please confirm the customers/orders join key" };
      }
      mkdirSync(path.join(workspaceRoot, "acme"), { recursive: true });
      writeFileSync(path.join(workspaceRoot, "acme", "wren_project.yml"), "name: acme\n");
      return { finalText: "SETUP_STATUS: ok - connected to postgres" };
    });
    const store = new Store(":memory:");
    const deps: TurnDeps = {
      store,
      route: okRoute,
      baseRouteOptions: BASE_ROUTE_OPTIONS,
      setupRunner,
      workspaceRoot,
      getUserProject: () => boundProject,
      bindProject: (dir: string) => {
        boundProject = dir;
      },
    };
    const app = createApp(deps);

    const connectRes = await app.request("/api/setup/connect", {
      method: "POST",
      body: JSON.stringify({ projectName: "acme", sourceType: "postgres" }),
    });
    const { sessionId, turnId: connectTurnId } = (await connectRes.json()) as { sessionId: string; turnId: string };
    await (await app.request(`/api/sessions/${sessionId}/stream?turn=${connectTurnId}`)).text();

    const contextRes = await app.request("/api/setup/context", { method: "POST" });
    const { sessionId: contextSessionId, turnId: contextTurnId } = (await contextRes.json()) as { sessionId: string; turnId: string };
    await (await app.request(`/api/sessions/${contextSessionId}/stream?turn=${contextTurnId}`)).text();

    const steps = (await (await app.request("/api/setup/steps")).json()) as SetupStep[];
    expect(steps.find((s) => s.key === "context")?.state).not.toBe("done");
    expect(steps.find((s) => s.key === "bind")?.state).not.toBe("current");
  });

  // A general setup-time compile healthcheck — the context step's own "ok" check
  // (target/mdl.json exists with >=1 model) is necessary but not sufficient: an incomplete/
  // malformed MDL can still fail `warble compile`. These two tests drive the FULL connect ->
  // context flow (through the real SSE stream, exactly like the tests above) with a describeBundle
  // stub standing in for the compile seam, and assert on what the context turn's own setup_status
  // event reports — not just the step-state side effects already covered above.
  it("a context turn whose profile fails to compile keeps context retryable and resolves as an error", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-context-test-"));
    let boundProject: string | undefined;
    const setupRunner = stubSetupRunner(async (opts) => {
      if (opts.agentId === "build_context") {
        recordSuccessfulSchemaDiscovery(opts.onEvent);
        writeMdl(path.join(workspaceRoot, "acme"), ["customers"]);
        return { finalText: "Generated MDL from the discovered schema.\nSETUP_STATUS: ok - built MDL with 1 model" };
      }
      mkdirSync(path.join(workspaceRoot, "acme"), { recursive: true });
      writeFileSync(path.join(workspaceRoot, "acme", "wren_project.yml"), "name: acme\n");
      return { finalText: "SETUP_STATUS: ok - connected to postgres" };
    });
    const store = new Store(":memory:");
    configureSubscriptionRuntime(store);
    // The compile healthcheck's stand-in: rejects with the same shape `compileProfile` raises for
    // a genuine `warble compile` failure — a multi-line stderr dump the summarizer must NOT pass
    // through verbatim.
    const rawStderr = "error: relationship \"orders_customers\" references unknown model \"orders\"\n  --> profile/relationships.yml:4:3\nhelp: define \"orders\" or remove the relationship";
    const describeBundle: TurnDeps["describeBundle"] = async () => {
      throw new WarbleCommandFailedError("warble", ["compile", "/tmp/x"], 1, rawStderr);
    };
    const deps: TurnDeps = {
      store,
      route: okRoute,
      baseRouteOptions: BASE_ROUTE_OPTIONS,
      setupRunner,
      workspaceRoot,
      describeBundle,
      getUserProject: () => boundProject,
      bindProject: (dir: string) => {
        boundProject = dir;
      },
    };
    const app = createApp(deps);

    const connectRes = await app.request("/api/setup/connect", {
      method: "POST",
      body: JSON.stringify({ projectName: "acme", sourceType: "postgres" }),
    });
    const { sessionId, turnId: connectTurnId } = (await connectRes.json()) as { sessionId: string; turnId: string };
    await (await app.request(`/api/sessions/${sessionId}/stream?turn=${connectTurnId}`)).text();

    const contextRes = await app.request("/api/setup/context", { method: "POST" });
    const { sessionId: contextSessionId, turnId: contextTurnId } = (await contextRes.json()) as { sessionId: string; turnId: string };
    const streamText = await (await app.request(`/api/sessions/${contextSessionId}/stream?turn=${contextTurnId}`)).text();
    const frames = parseSse(streamText);

    const errorFrame = frames.find((f) => f.event === "error");
    const errorMessage = (errorFrame?.data as { message?: string } | undefined)?.message;
    expect(errorMessage).toContain('relationship "orders_customers" references unknown model "orders"');
    expect(errorMessage).not.toContain("help: define");
    expect(errorMessage).not.toContain("relationships.yml:4:3");
    expect(frames.some((f) => f.event === "event" && (f.data as { kind?: string }).kind === "setup_status")).toBe(false);
    expect(frames.some((f) => f.event === "done")).toBe(false);

    // The artifact may exist, but the success transaction never commits.
    const steps = (await (await app.request("/api/setup/steps")).json()) as SetupStep[];
    expect(steps.find((s) => s.key === "context")?.state).toBe("current");
    expect(steps.find((s) => s.key === "bind")?.state).toBe("todo");
  });

  it("rolls back every context-success write when the setup-status DB write fails", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-context-atomic-persistence-test-"));
    let boundProject: string | undefined;
    const setupRunner = stubSetupRunner(async (opts) => {
      if (opts.agentId === "build_context") {
        recordSuccessfulSchemaDiscovery(opts.onEvent);
        writeMdl(path.join(workspaceRoot, "acme"), ["customers"]);
        return { finalText: "SETUP_STATUS: ok - built MDL with 1 model" };
      }
      mkdirSync(path.join(workspaceRoot, "acme"), { recursive: true });
      writeFileSync(path.join(workspaceRoot, "acme", "wren_project.yml"), "name: acme\n");
      return { finalText: "SETUP_STATUS: ok - connected to postgres" };
    });
    const store = new Store(":memory:", {
      onContextSuccessWrite: (phase) => {
        if (phase === "after_event") throw new Error("injected setup-status write failure");
      },
    });
    configureSubscriptionRuntime(store);
    const deps: TurnDeps = {
      store,
      route: okRoute,
      baseRouteOptions: BASE_ROUTE_OPTIONS,
      setupRunner,
      workspaceRoot,
      describeBundle: async () => bundleWithGatedCheck(true),
      getUserProject: () => boundProject,
      bindProject: (dir: string) => {
        boundProject = dir;
      },
    };
    const app = createApp(deps);

    const connectRes = await app.request("/api/setup/connect", {
      method: "POST",
      body: JSON.stringify({ projectName: "acme", sourceType: "postgres" }),
    });
    const { sessionId, turnId: connectTurnId } = (await connectRes.json()) as { sessionId: string; turnId: string };
    await (await app.request(`/api/sessions/${sessionId}/stream?turn=${connectTurnId}`)).text();

    const contextRes = await app.request("/api/setup/context", { method: "POST" });
    const { turnId: contextTurnId } = (await contextRes.json()) as { turnId: string };
    const frames = parseSse(await (await app.request(`/api/sessions/${sessionId}/stream?turn=${contextTurnId}`)).text());

    expect(frames).toEqual(expect.arrayContaining([expect.objectContaining({ event: "error" })]));
    expect(frames.some((frame) => frame.event === "event" && (frame.data as { kind?: string }).kind === "setup_status")).toBe(false);
    const steps = store.getSetupSteps();
    expect(steps.find((step) => step.key === "context")?.state).toBe("current");
    expect(steps.find((step) => step.key === "bind")?.state).toBe("todo");
    expect(store.listEventsForTurn(contextTurnId)).toEqual([]);
    expect(store.getTurn(contextTurnId)).toMatchObject({ backend: null, resultKind: "error", answerSummary: null });
    expect(store.getSession(sessionId)).toMatchObject({ status: "active", pendingQuestion: null });
  });

  it("a context turn whose profile compiles cleanly reports the normal ok setup_status (no false alarm)", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-context-test-"));
    let boundProject: string | undefined;
    let describeBundleCallCount = 0;
    const setupRunner = stubSetupRunner(async (opts) => {
      if (opts.agentId === "build_context") {
        recordSuccessfulSchemaDiscovery(opts.onEvent);
        writeMdl(path.join(workspaceRoot, "acme"), ["customers", "orders"]);
        return { finalText: "Generated MDL from the discovered schema.\nSETUP_STATUS: ok - built MDL with 2 models" };
      }
      mkdirSync(path.join(workspaceRoot, "acme"), { recursive: true });
      writeFileSync(path.join(workspaceRoot, "acme", "wren_project.yml"), "name: acme\n");
      return { finalText: "SETUP_STATUS: ok - connected to postgres" };
    });
    const store = new Store(":memory:");
    configureSubscriptionRuntime(store);
    const describeBundle: TurnDeps["describeBundle"] = async () => {
      describeBundleCallCount += 1;
      return bundleWithGatedCheck(true);
    };
    const deps: TurnDeps = {
      store,
      route: okRoute,
      baseRouteOptions: BASE_ROUTE_OPTIONS,
      setupRunner,
      workspaceRoot,
      describeBundle,
      getUserProject: () => boundProject,
      bindProject: (dir: string) => {
        boundProject = dir;
      },
    };
    const app = createApp(deps);

    const connectRes = await app.request("/api/setup/connect", {
      method: "POST",
      body: JSON.stringify({ projectName: "acme", sourceType: "postgres" }),
    });
    const { sessionId, turnId: connectTurnId } = (await connectRes.json()) as { sessionId: string; turnId: string };
    await (await app.request(`/api/sessions/${sessionId}/stream?turn=${connectTurnId}`)).text();

    const contextRes = await app.request("/api/setup/context", { method: "POST" });
    const { sessionId: contextSessionId, turnId: contextTurnId } = (await contextRes.json()) as { sessionId: string; turnId: string };
    const streamText = await (await app.request(`/api/sessions/${contextSessionId}/stream?turn=${contextTurnId}`)).text();
    const frames = parseSse(streamText);

    expect(describeBundleCallCount).toBe(1); // the healthcheck really ran (not skipped)

    const setupStatusFrame = frames.find((f) => f.event === "event" && (f.data as { kind?: string }).kind === "setup_status");
    const statusEvent = setupStatusFrame?.data as SetupStatusEvent | undefined;
    expect(statusEvent).toBeDefined();
    expect(statusEvent?.status).toBe("ok");
    expect(statusEvent?.message).toBe("built MDL with 2 models"); // unmodified — no compile-failure suffix appended

    const steps = (await (await app.request("/api/setup/steps")).json()) as SetupStep[];
    expect(steps.find((s) => s.key === "context")?.state).toBe("done");
    expect(steps.find((s) => s.key === "bind")?.state).toBe("current");
  });
});

describe("POST /api/setup/compile-bind — real compile/bind, not theater", () => {
  it("compiles+loads the bundle via describeBundle and sets the gate TRUE when a compiled agent has a locked gated_check", async () => {
    const { app, store } = buildApp(async () => bundleWithGatedCheck(true));
    configureSubscriptionRuntime(store);

    const res = await app.request("/api/setup/compile-bind", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { steps: SetupStep[]; verifyGatePassed: boolean };
    expect(body.verifyGatePassed).toBe(true);
    expect(body.steps.find((s) => s.key === "bind")?.state).toBe("done");
    expect(store.getVerifyGatePassed()).toBe(true);
  });

  it("compiles+loads the bundle and sets the gate FALSE when no compiled agent has a locked gated_check", async () => {
    const { app, store } = buildApp(async () => bundleWithGatedCheck(false));
    configureSubscriptionRuntime(store);

    const res = await app.request("/api/setup/compile-bind", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { steps: SetupStep[]; verifyGatePassed: boolean };
    expect(body.verifyGatePassed).toBe(false);
    expect(body.steps.find((s) => s.key === "bind")?.state).toBe("done"); // bind step still completes; only the gate reflects real state
    expect(store.getVerifyGatePassed()).toBe(false);
  });

  it("does not flip the bind step or the gate when describeBundle throws (precondition/compile failure) — loud-fails instead", async () => {
    const { app, store } = buildApp(async () => {
      throw new Error("precondition failed: mdl is not parseable");
    });

    const before = (await (await app.request("/api/setup/steps")).json()) as SetupStep[];
    const bindBefore = before.find((s) => s.key === "bind")?.state;

    const res = await app.request("/api/setup/compile-bind", { method: "POST" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await res.json()).toEqual({ error: "precondition failed: mdl is not parseable" });

    const after = (await (await app.request("/api/setup/steps")).json()) as SetupStep[];
    expect(after.find((s) => s.key === "bind")?.state).toBe(bindBefore); // untouched, not silently marked done
    expect(after.find((s) => s.key === "ask")?.state).not.toBe("current");
    expect(store.getVerifyGatePassed()).toBe(false); // never flipped true on a failed compile/bind
  });

  it("does not call bindProject or mutate the stored binding when compile-bind fails, and resolves enrichment revision fresh rather than from a cached bind-time snapshot", async () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "wren-harness-enrichment-bind-test-"));
    mkdirSync(path.join(projectDir, "target"));
    writeFileSync(path.join(projectDir, "wren_project.yml"), "name: acme\n");
    writeFileSync(path.join(projectDir, "target", "mdl.json"), '{"models":[{"name":"before"}]}');
    const store = new Store(":memory:");
    const before = store.activateEnrichmentBinding(resolveEnrichmentBinding(projectDir));
    writeFileSync(path.join(projectDir, "target", "mdl.json"), '{"models":[{"name":"after"}]}');
    let boundProject = projectDir;
    const bindProject = vi.fn((dir: string) => {
      const binding = resolveEnrichmentBinding(dir);
      boundProject = binding.path;
      store.activateEnrichmentBinding(binding);
    });
    const app = createApp({
      store,
      route: async () => ({ backend: "agent", warnings: [], kind: "answer", envelope: { blocks: [], summary: "ok" }, trace: { steps: [] } }),
      baseRouteOptions: { ...BASE_ROUTE_OPTIONS, userProject: projectDir },
      getUserProject: () => boundProject,
      bindProject,
      describeBundle: async () => { throw new Error("precondition failed: mdl is not parseable"); },
    });

    // Binding never caches a revision (bindProject only ever resolves
    // identity), so foundation-readiness is decided by path+identity plus a
    // revision resolved fresh from disk on every check -- not by comparing
    // against whatever revision happened to be on record from the last
    // bind. The project on disk is still built (just with different
    // content than at bind time), so enrichment is ready throughout.
    expect((await (await app.request("/api/context/enrichment")).json() as { foundationReady: boolean }).foundationReady).toBe(true);
    expect((await app.request("/api/setup/compile-bind", { method: "POST" })).status).toBe(500);
    expect(bindProject).not.toHaveBeenCalled();
    expect(store.getEnrichmentBinding()).toEqual(before);
    expect((await (await app.request("/api/context/enrichment")).json() as { foundationReady: boolean }).foundationReady).toBe(true);
  });

  it("returns a clear error (not a crash) when describeBundle is not configured", async () => {
    const { app, store } = buildApp(); // no describeBundle stub

    const res = await app.request("/api/setup/compile-bind", { method: "POST" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("not configured") });
    expect(store.getVerifyGatePassed()).toBe(false);
  });

  it("evicts the memoized bundle-agent-ids cache on success, so a subsequent Ask turn's intent classification recompiles instead of replaying a stale (pre-MDL) bundle", async () => {
    let describeBundleCalls = 0;
    const { app, store } = buildApp(async () => {
      describeBundleCalls += 1;
      return bundleWithGatedCheck(true);
    });
    const session = store.createSession("s1");

    // Prime the bundleAgentIdsCache: an Ask turn's postTurn() classifies intent against
    // getBundleAgentIds(deps), which calls describeBundle once and memoizes the result for
    // this same `deps` (see server/turn.ts's bundleAgentIdsCache WeakMap).
    await app.request(`/api/sessions/${session.id}/turns`, { method: "POST", body: JSON.stringify({ question: "how many customers?" }) });
    expect(describeBundleCalls).toBe(1);

    // A second Ask turn reuses the memoized entry — describeBundle must NOT be called again.
    await app.request(`/api/sessions/${session.id}/turns`, { method: "POST", body: JSON.stringify({ question: "how many orders?" }) });
    expect(describeBundleCalls).toBe(1);

    // compile-bind recompiles the bundle directly (its own describeBundle call, #2 — this is
    // what actually re-runs against the now-MDL'd project) and then invalidates the cache so
    // the NEXT Ask turn recompiles too, instead of replaying the memoized agent-ids list from
    // before the context step added models.
    const bindRes = await app.request("/api/setup/compile-bind", { method: "POST" });
    expect(bindRes.status).toBe(200);
    expect(describeBundleCalls).toBe(2);

    // If the cache had NOT been evicted, this third turn would still see describeBundleCalls
    // stuck at 2 (compile-bind's own call, never re-consulted by postTurn). It rising to 3
    // proves the eviction actually took effect, not just that compile-bind called describeBundle once itself.
    await app.request(`/api/sessions/${session.id}/turns`, { method: "POST", body: JSON.stringify({ question: "how many products?" }) });
    expect(describeBundleCalls).toBe(3);
  });
});

describe("context + eval read endpoints", () => {
  // The context routes now build from a real bound project directory (via
  // context-source.ts's `loadContextShow`, mocked at the top of this file) plus real files on disk
  // (via context-files.ts, unmocked — it reads actual bytes). This fixture writes real model/
  // relationship/cube/knowledge files under a real temp dir named ".../project" (so
  // `path.basename(userProject)` is still "project"), and configures the loadContextShow mock to
  // return the matching entity names/shapes context-map.ts and impact.ts need.
  let projectRoot: string;
  let projectDir: string;

  const fixtureContextShow: WrenContextShow = {
    models: [
      { name: "customers", primaryKey: "id", columns: [{ name: "id", type: "INTEGER" }] },
      { name: "orders", primaryKey: "id", columns: [{ name: "id", type: "INTEGER" }, { name: "customer_id", type: "INTEGER" }] },
      { name: "products", primaryKey: "id", columns: [{ name: "id", type: "INTEGER" }] },
    ],
    relationships: [
      { name: "orders_customers", models: ["orders", "customers"], joinType: "MANY_TO_ONE", condition: "orders.customer_id = customers.id" },
      { name: "orders_products", models: ["orders", "products"], joinType: "MANY_TO_ONE", condition: "orders.product_id = products.id" },
    ],
    cubes: [
      { name: "order_metrics", baseObject: "orders", measures: [{ name: "total_revenue", expression: "SUM(orders.amount)" }] },
      { name: "product_metrics", baseObject: "products", measures: [{ name: "unit_count", expression: "COUNT(*)" }] },
    ],
  };

  function writeFixtureFile(relPath: string, content: string): void {
    const full = path.join(projectDir, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), "context-endpoints-test-"));
    projectDir = path.join(projectRoot, "project");
    mkdirSync(projectDir);
    for (const model of fixtureContextShow.models) writeFixtureFile(path.join("models", model.name, "metadata.yml"), `name: ${model.name}\n`);
    writeFixtureFile("relationships.yml", "relationships:\n  - name: orders_customers\n  - name: orders_products\n");
    for (const cube of fixtureContextShow.cubes) writeFixtureFile(path.join("cubes", cube.name, "metadata.yml"), `name: ${cube.name}\nbaseObject: ${cube.baseObject}\n`);
    writeFixtureFile(path.join("knowledge", "rules", "general.md"), "# rules\nDo not double-count returns.\n");
    loadContextShowMock.mockReset();
    loadContextShowMock.mockResolvedValue(fixtureContextShow);
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("serves the real context overview and the real files tree, and 404s the removed per-file route", async () => {
    const { app } = buildApp(undefined, { userProject: projectDir });

    const overview = (await (await app.request("/api/context/overview")).json()) as ContextOverview;
    expect(overview.models.map((m) => m.key).sort()).toEqual(["customers", "orders", "products"]);
    expect(overview.knowledge).toEqual({ instructionsPresent: true, verifiedPairCount: 0 });
    expect(overview.projectName).toBe("project"); // basename of the fixture project dir
    expect(overview.projectPath).toBe(projectDir);

    const files = (await (await app.request("/api/context/files")).json()) as ContextFileNode[];
    expect(files.map((g) => g.key)).toEqual(["models", "relationships", "cubes", "knowledge"]);

    // Every relationship and cube file node must carry non-empty real file content — a node
    // with no content renders as "empty" in the FileViewer.
    const leaves = files.flatMap((node) => node.children ?? [node]);
    const relationshipAndCubeLeaves = leaves.filter((node) => node.kind === "relationship" || node.kind === "cube");
    expect(relationshipAndCubeLeaves).toHaveLength(4);
    for (const node of relationshipAndCubeLeaves) {
      expect(node.content).toBeTruthy();
    }

    // GET /api/context/files/:key was removed — any path under it 404s like any other unknown route.
    expect((await app.request("/api/context/files/models")).status).toBe(404);
    expect((await app.request("/api/context/files/does-not-exist")).status).toBe(404);
  });

  it("serves the seeded eval runs list and a single run with its component scores split out", async () => {
    const { app } = buildApp();

    const runs = (await (await app.request("/api/eval/runs")).json()) as EvalRun[];
    expect(runs).toHaveLength(3);

    const single = (await (await app.request("/api/eval/runs/eval-2")).json()) as { run: EvalRun; componentScores: unknown[] };
    expect(single.run.gatePass).toBe(false);
    expect(single.componentScores).toHaveLength(2);

    expect((await app.request("/api/eval/runs/does-not-exist")).status).toBe(404);
  });

  it("computes live impact from the real relationship graph for a known entity and 404s an unknown one", async () => {
    const { app } = buildApp(undefined, { userProject: projectDir });
    const impact = await (await app.request("/api/context/impact/customers")).json();
    expect(impact).toMatchObject({ blastRadius: { severity: "structural" }, brokenPairs: [] });
    expect((await app.request("/api/context/impact/does-not-exist")).status).toBe(404);
  });
});

describe("setup decision checkpoints (max_turns continue/stop, same-name project conflict)", () => {
  const okConnectRoute = async (): Promise<RouteResult> => ({
    backend: "agent",
    warnings: [],
    kind: "answer",
    envelope: { blocks: [], summary: "ok" },
    trace: { steps: [] },
  });

  /**
   * Drives the wizard through connect (scaffolds + binds "acme") and then dispatches+streams the
   * context turn, whose own dispatch is fully scripted by `runContext` — shared by the max_turns
   * checkpoint tests (a) and (c) below so they don't duplicate the connect boilerplate.
   */
  async function setupToContextCheckpoint(
    workspaceRoot: string,
    runContext: SetupStepRunner["run"],
    // Lets tests stand in for a `WREN_HARNESS_SETUP_MAX_TURNS` override —
    // `DispatchedSetupRunner.effectiveMaxTurns` is what `server/turn.ts` reads to build the
    // "Continue (+N turns)" label. Omitted (as in tests (a)/(c) below) means the stub has no
    // `effectiveMaxTurns`, matching a plain `SetupStepRunner` that predates this override.
    effectiveMaxTurns?: SetupStepRunner["effectiveMaxTurns"],
    getAuthChoice?: () => AuthChoice,
  ): Promise<{
    app: ReturnType<typeof createApp>;
    store: Store;
    sessionId: string;
    contextTurnId: string;
    frames: readonly ParsedSseFrame[];
  }> {
    let boundProject: string | undefined;
    const setupRunner: SetupStepRunner = {
      run: async (opts) => {
        if (opts.agentId === BUILD_CONTEXT_AGENT_ID) return runContext(opts);
        mkdirSync(path.join(workspaceRoot, "acme"), { recursive: true });
        writeFileSync(path.join(workspaceRoot, "acme", "wren_project.yml"), "name: acme\n");
        return { finalText: "SETUP_STATUS: ok - connected to postgres" };
      },
      ...(effectiveMaxTurns ? { effectiveMaxTurns } : {}),
    };
    const store = new Store(":memory:");
    const deps: TurnDeps = {
      store,
      route: okConnectRoute,
      baseRouteOptions: BASE_ROUTE_OPTIONS,
      setupRunner,
      workspaceRoot,
      ...(getAuthChoice ? { getAuthChoice } : {}),
      getUserProject: () => boundProject,
      bindProject: (dir: string) => {
        boundProject = dir;
      },
    };
    const app = createApp(deps);

    const connectRes = await app.request("/api/setup/connect", {
      method: "POST",
      body: JSON.stringify({ projectName: "acme", sourceType: "postgres" }),
    });
    const { sessionId, turnId: connectTurnId } = (await connectRes.json()) as { sessionId: string; turnId: string };
    await (await app.request(`/api/sessions/${sessionId}/stream?turn=${connectTurnId}`)).text();

    const contextRes = await app.request("/api/setup/context", { method: "POST" });
    const { turnId: contextTurnId } = (await contextRes.json()) as { sessionId: string; turnId: string };

    const frames = parseSse(await (await app.request(`/api/sessions/${sessionId}/stream?turn=${contextTurnId}`)).text());
    return { app, store, sessionId, contextTurnId, frames };
  }

  it("(a) error_max_turns while building context emits a needs_decision setup_status (not an error frame), with continue/stop options and a real on-disk progress count", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-max-turns-test-"));
    const { app, store, sessionId, contextTurnId, frames } = await setupToContextCheckpoint(workspaceRoot, async () => {
      mkdirSync(path.join(workspaceRoot, "acme", "models", "customers"), { recursive: true });
      mkdirSync(path.join(workspaceRoot, "acme", "models", "orders"), { recursive: true });
      throw new Error("dispatcher exited: error_max_turns after 120 turns");
    });

    expect(frames.map((f) => f.event)).toEqual(["worklog", "event", "done"]);
    expect(frames.some((f) => f.event === "error")).toBe(false); // never the plain error path
    expect(frames[1]?.data).toMatchObject({
      kind: "setup_status",
      status: "needs_decision",
      decision: {
        kind: "max_turns_continue",
        // No `effectiveMaxTurns` wired on this stub runner (mirrors a plain, override-less
        // SetupStepRunner) — the label falls back to DEFAULT_SETUP_MAX_TURNS (120).
        options: [{ id: "continue", label: "Continue (+120 turns)" }, { id: "stop", label: "Stop" }],
        detail: expect.stringContaining("2 models"),
      },
    });

    // A decision checkpoint resolves the turn as an "answer", not an "error" — it isn't a failure.
    const turn = store.getTurn(contextTurnId);
    expect(turn?.resultKind).toBe("answer");

    // Session parked awaiting the decision, with the pending payload recorded for /api/setup/decision.
    const session = store.getSession(sessionId);
    expect(session?.status).toBe("awaiting_decision");
    expect(session?.pendingDecision && JSON.parse(session.pendingDecision)).toEqual({ kind: "max_turns_continue", stepKey: "context" });

    const recovery = await (await app.request("/api/setup/recovery")).json() as { sessionId?: string; decision?: SetupDecision };
    expect(recovery).toMatchObject({ sessionId, decision: { kind: "max_turns_continue", options: [{ id: "continue" }, { id: "stop" }] } });
    expect(JSON.stringify(recovery)).not.toContain("resumeSession");
  });

  it("rehydrates a standalone schema-discovery retry checkpoint and resolves its retry route", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-schema-retry-recovery-test-"));
    const { app, store } = buildApp(undefined, { workspaceRoot, setupRunner: stubSetupRunner(async () => ({ finalText: "SETUP_STATUS: ok" })) });
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });
    store.insertEvent({
      sessionId: session.id,
      turnId: null,
      kind: "setup_status",
      payload: {
        id: newId("evt"),
        kind: "setup_status",
        status: "needs_decision",
        message: "Schema discovery needs a corrective retry.",
        decision: { kind: "schema_discovery_retry", options: [{ id: "retry", label: "Retry schema discovery" }, { id: "stop", label: "Stop" }] },
      },
    });
    store.updateSessionDecision(session.id, "awaiting_decision", JSON.stringify({ kind: "schema_discovery_retry", stepKey: "context" }));

    const recovery = await (await app.request("/api/setup/recovery")).json() as { sessionId?: string; decision?: SetupDecision };
    expect(recovery).toMatchObject({ sessionId: session.id, decision: { kind: "schema_discovery_retry", options: [{ id: "retry" }, { id: "stop" }] } });

    const retry = await app.request("/api/setup/decision", { method: "POST", body: JSON.stringify({ sessionId: session.id, choiceId: "retry" }) });
    expect(retry.status).toBe(200);
    const { turnId } = await retry.json() as { turnId: string };
    expect(store.getTurn(turnId)).toMatchObject({ setupStepKey: "context", contextRecovery: "schema_discovery" });
  });

  it("does not resurrect an older max-turn decision when the current checkpoint is schema-discovery retry", async () => {
    const { app, store } = buildApp();
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.insertEvent({
      sessionId: session.id,
      turnId: null,
      kind: "setup_status",
      payload: {
        id: newId("evt"),
        kind: "setup_status",
        status: "needs_decision",
        message: "Older turn limit.",
        decision: { kind: "max_turns_continue", options: [{ id: "continue", label: "Continue" }, { id: "stop", label: "Stop" }] },
      },
    });
    store.insertEvent({
      sessionId: session.id,
      turnId: null,
      kind: "setup_status",
      payload: {
        id: newId("evt"),
        kind: "setup_status",
        status: "needs_decision",
        message: "Current schema retry.",
        decision: { kind: "schema_discovery_retry", options: [{ id: "retry", label: "Retry schema discovery" }, { id: "stop", label: "Stop" }] },
      },
    });
    store.updateSessionDecision(session.id, "awaiting_decision", JSON.stringify({ kind: "schema_discovery_retry", stepKey: "context" }));

    const recovery = await (await app.request("/api/setup/recovery")).json() as { decision?: SetupDecision };
    expect(recovery.decision).toMatchObject({ kind: "schema_discovery_retry", options: [{ id: "retry" }, { id: "stop" }] });
  });

  it("(a2) with a custom setup max-turns budget, the continue label reflects it (not the hardcoded 120 default) and the resumed turn is dispatched against that same runner", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-max-turns-custom-test-"));
    const CUSTOM_MAX_TURNS = 25;
    const { app, sessionId, frames } = await setupToContextCheckpoint(
      workspaceRoot,
      async () => {
        mkdirSync(path.join(workspaceRoot, "acme", "models", "customers"), { recursive: true });
        throw new Error("dispatcher exited: error_max_turns after 25 turns");
      },
      // Stands in for a DispatchedSetupRunner constructed with WREN_HARNESS_SETUP_MAX_TURNS=25 —
      // see DispatchedSetupRunner.effectiveMaxTurns in harness/setup/runner.ts.
      (agentId) => (agentId === BUILD_CONTEXT_AGENT_ID ? CUSTOM_MAX_TURNS : undefined),
    );

    // The label shows the real budget, not DEFAULT_SETUP_MAX_TURNS (120).
    expect(frames[1]?.data).toMatchObject({
      decision: { options: [{ id: "continue", label: `Continue (+${CUSTOM_MAX_TURNS} turns)` }, { id: "stop", label: "Stop" }] },
    });

    // Picking "continue" re-dispatches the context step against the SAME setupRunner instance
    // (deps.setupRunner is wired once at boot — see server/bin.ts), so whatever budget
    // effectiveMaxTurns() reported is exactly what run() will apply on resume: the two can't
    // drift because both read `DispatchedSetupRunnerOptions.maxTurns` through the same resolver.
    const decisionRes = await app.request("/api/setup/decision", { method: "POST", body: JSON.stringify({ sessionId, choiceId: "continue" }) });
    expect(decisionRes.status).toBe(200);
    const { turnId: resumeTurnId } = (await decisionRes.json()) as { sessionId: string; turnId: string };
    expect(resumeTurnId).toBeTruthy();
  });

  it("(b) a rejected queued worklog emit during a setup turn still yields a terminal frame instead of hanging forever (hang-bug fix)", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-hang-guard-test-"));
    const setupRunner = stubSetupRunner(async (opts) => {
      // Queues a worklog emit (via onEvent -> LiveWorkLog) that the test's `emit` below will
      // reject, then fails with a plain (non-max_turns) error — reproducing the exact hang: a
      // queued intermediate emit rejects strictly before the terminal frame is attempted.
      opts.onEvent?.({
        kind: "tool.call",
        runId: "run-1",
        seq: 1,
        stepId: "step-1",
        callId: "call-1",
        tool: "wren_init",
        depth: 0,
        status: "running",
      } as AgentEvent);
      throw new Error("some transient dispatch failure");
    });
    const store = new Store(":memory:");
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    const turnId = newId("turn");
    store.createTurn({
      id: turnId,
      sessionId: session.id,
      question: "connect acme",
      composedInput: "connect acme",
      agentId: CONNECT_SOURCE_AGENT_ID,
      setupStepKey: "connect",
    });

    const deps: TurnDeps = {
      store,
      route: async () => {
        throw new Error("route() must never be called for a setup turn");
      },
      baseRouteOptions: BASE_ROUTE_OPTIONS,
      setupRunner,
      workspaceRoot,
    };

    const frames: SseFrame[] = [];
    const emit = async (frame: SseFrame): Promise<void> => {
      if (frame.event === "worklog") throw new Error("simulated: client disconnected mid-stream");
      frames.push(frame);
    };

    // Must resolve — not hang, not throw — even though the queued worklog emit above rejects.
    await streamTurn(deps, session.id, turnId, emit);

    expect(frames.map((f) => f.event)).toEqual(["error"]);
    expect(frames[0]?.data).toMatchObject({ message: expect.stringContaining("transient dispatch failure") });
  });

  it("(c) POST /api/setup/decision {choiceId: 'continue'} re-dispatches the context step with a resume-from-disk prompt", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-max-turns-test-"));
    const { app, store, sessionId } = await setupToContextCheckpoint(workspaceRoot, async () => {
      mkdirSync(path.join(workspaceRoot, "acme", "models", "customers"), { recursive: true });
      throw new Error("error_max_turns");
    });

    const decisionRes = await app.request("/api/setup/decision", { method: "POST", body: JSON.stringify({ sessionId, choiceId: "continue" }) });
    expect(decisionRes.status).toBe(200);
    const { turnId: resumeTurnId } = (await decisionRes.json()) as { sessionId: string; turnId: string };

    const resumeTurn = store.getTurn(resumeTurnId);
    expect(resumeTurn?.agentId).toBe(BUILD_CONTEXT_AGENT_ID);
    expect(resumeTurn?.setupStepKey).toBe("context");
    expect(resumeTurn?.composedInput).toContain("ran out of turns partway through");
    // The resume prompt carries a concrete "already done" inventory (read straight
    // off disk, not from the agent) instead of a bare "some models may already exist" hedge —
    // the "customers" model dir written by the stubbed setupRunner above must show up by name.
    expect(resumeTurn?.composedInput).toContain("1 model(s) already written");
    expect(resumeTurn?.composedInput).toContain("customers");
    expect(resumeTurn?.composedInput).toMatch(/already fetched the generate-mdl skill/i);
    expect(resumeTurn?.composedInput).not.toContain("wren skills get generate-mdl");
    expect(resumeTurn?.composedInput).toMatch(/go straight to finishing/i);
    expect(resumeTurn?.composedInput).not.toMatch(/follow the wren generate-mdl skill \(and, optionally/i);

    // The decision checkpoint is cleared back to "active" so the resumed turn can stream normally.
    const session = store.getSession(sessionId);
    expect(session?.status).toBe("active");
    expect(session?.pendingDecision).toBeNull();

    // Plan B fallback confirmation: no session id was ever captured (a plain Error, not a
    // DispatchedSessionError, was thrown above), so the resumed turn carries no resumeSessionId —
    // there is nothing for setup/runner.ts to forward as `--resume <id>`.
    expect(resumeTurn?.resumeSessionId).toBeNull();
  });

  it("(c2) Plan A: when the failed turn surfaced a resumable session id (DispatchedSessionError), 'continue' resumes that SAME session with the short continuation prompt instead of the resume-from-disk inventory prompt", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-max-turns-resume-session-test-"));
    const CAPTURED_SESSION_ID = "sess_captured_abc123";
    const { app, store, sessionId } = await setupToContextCheckpoint(workspaceRoot, async () => {
      mkdirSync(path.join(workspaceRoot, "acme", "models", "customers"), { recursive: true });
      // Unlike test (c)'s plain Error, this is a DispatchedSessionError — the shape a real
      // warble-agent-sdk `error_max_turns` exit produces once it has read the dispatcher's
      // `{t:"session",id}` line (see runDispatchedDefault/spawnChat in harness/route/dispatched.ts).
      throw new DispatchedSessionError("dispatcher exited: error_max_turns after 120 turns", CAPTURED_SESSION_ID);
    }, undefined, () => ({ mode: "subscription", provider: "claude" }));

    // The captured session id is persisted on the pending decision, ready for the "continue" branch.
    const session = store.getSession(sessionId);
    expect(session?.pendingDecision && JSON.parse(session.pendingDecision)).toEqual({
      kind: "max_turns_continue",
      stepKey: "context",
      sessionId: CAPTURED_SESSION_ID,
      sessionProvider: "claude",
      sessionRunner: "subscription:claude",
    });

    const recovery = await (await app.request("/api/setup/recovery")).json();
    expect(JSON.stringify(recovery)).not.toContain(CAPTURED_SESSION_ID);
    expect(JSON.stringify(recovery)).not.toContain("subscription:");

    const decisionRes = await app.request("/api/setup/decision", {
      method: "POST",
      body: JSON.stringify({ sessionId, choiceId: "continue" }),
    });
    expect(decisionRes.status).toBe(200);
    const { turnId: resumeTurnId } = (await decisionRes.json()) as { sessionId: string; turnId: string };

    const resumeTurn = store.getTurn(resumeTurnId);
    expect(resumeTurn?.agentId).toBe(BUILD_CONTEXT_AGENT_ID);
    expect(resumeTurn?.setupStepKey).toBe("context");

    // Plan A: the dispatcher-level resume anchor is threaded onto the resumed turn row, ready
    // for setup/runner.ts to forward as `--resume <id>` on the next dispatch.
    expect(resumeTurn?.resumeSessionId).toBe(CAPTURED_SESSION_ID);

    // The short continuation prompt (composeSetupPrompt's resumeSession branch), NOT the
    // resumeFromDisk inventory prompt from test (c) above.
    expect(resumeTurn?.composedInput).toContain("Continue this same conversation exactly where you left off");
    expect(resumeTurn?.composedInput).not.toContain("ran out of turns partway through");
    expect(resumeTurn?.composedInput).not.toContain("already written");
    expect(resumeTurn?.composedInput).toMatch(/do not re-fetch any skill you already fetched/i);

    // The checkpoint clears back to "active" for the resumed turn, same as the Plan B path.
    const resumedSession = store.getSession(sessionId);
    expect(resumedSession?.status).toBe("active");
    expect(resumedSession?.pendingDecision).toBeNull();
  });

  it.each([
    ["max_turns_continue", "continue"],
    ["schema_discovery_retry", "retry"],
  ] as const)("does not resume a %s anchor after the subscription provider changes", async (kind, choiceId) => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-decision-provider-switch-test-"));
    const { app, store } = buildApp(undefined, {
      workspaceRoot,
      getAuthChoice: () => ({ mode: "subscription", provider: "codex" }),
      setupRunner: stubSetupRunner(async () => ({ finalText: "SETUP_STATUS: needs_input - user action required" })),
    });
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });
    store.updateSessionDecision(session.id, "awaiting_decision", JSON.stringify({
      kind,
      stepKey: "context",
      sessionId: "claude-session",
      sessionProvider: "claude",
      sessionRunner: "subscription:claude",
    }));

    const response = await app.request("/api/setup/decision", { method: "POST", body: JSON.stringify({ sessionId: session.id, choiceId }) });
    expect(response.status).toBe(200);
    const { turnId } = (await response.json()) as { turnId: string };
    const turn = store.getTurn(turnId)!;
    expect(turn.resumeSessionId).toBeNull();
    expect(turn.composedInput).not.toContain("Continue this same conversation exactly where you left off");
  });

  it("preserves an adopted context turn's workspace root through a max-turn continuation", async () => {
    const bootstrapRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-bootstrap-root-"));
    const adoptedRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-adopted-root-"));
    const { app, store } = buildApp(undefined, {
      workspaceRoot: bootstrapRoot,
      setupRunner: stubSetupRunner(async () => ({ finalText: "SETUP_STATUS: needs_input - user action required" })),
    });
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "postgres" });
    const turnId = newId("turn");
    store.createTurn({ id: turnId, sessionId: session.id, question: "context", composedInput: "context", agentId: BUILD_CONTEXT_AGENT_ID, setupStepKey: "context", workspaceRoot: adoptedRoot });
    store.updateSessionDecision(session.id, "awaiting_decision", JSON.stringify({ kind: "max_turns_continue", stepKey: "context", workspaceRoot: adoptedRoot }));

    const response = await app.request("/api/setup/decision", { method: "POST", body: JSON.stringify({ sessionId: session.id, choiceId: "continue" }) });
    const { turnId: resumedId } = (await response.json()) as { turnId: string };
    expect(store.getTurn(resumedId)?.workspaceRoot).toBe(adoptedRoot);
    expect(store.getTurn(resumedId)?.composedInput).toContain(path.join(adoptedRoot, "acme"));
  });

  it("(d) POST /api/setup/connect pre-flight: an existing non-empty project directory returns a name_conflict decision instead of dispatching a turn", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-name-conflict-test-"));
    mkdirSync(path.join(workspaceRoot, "acme"), { recursive: true });
    writeFileSync(path.join(workspaceRoot, "acme", "wren_project.yml"), "name: acme\n"); // a real leftover project

    const setupRunner = stubSetupRunner(async () => {
      throw new Error("setupRunner.run must never be called — the pre-flight must short-circuit before any turn dispatch");
    });
    const store = new Store(":memory:");
    const deps: TurnDeps = { store, route: okConnectRoute, baseRouteOptions: BASE_ROUTE_OPTIONS, setupRunner, workspaceRoot };
    const app = createApp(deps);

    const res = await app.request("/api/setup/connect", { method: "POST", body: JSON.stringify({ projectName: "acme", sourceType: "postgres" }) });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { sessionId: string; status: string; decision: unknown };
    expect(body.status).toBe("needs_decision");
    expect(body.decision).toMatchObject({
      kind: "name_conflict",
      options: [{ id: "rename" }, { id: "clean" }, { id: "cancel" }],
      detail: expect.stringContaining('"acme"'),
    });

    // No turn was dispatched: a session exists for the decision bookkeeping, but has no turn yet,
    // and is parked awaiting the decision rather than left "active".
    const session = store.getSession(body.sessionId);
    expect(session?.status).toBe("awaiting_decision");
    expect(store.getLatestTurn(body.sessionId)).toBeUndefined();
  });

  it("(e) POST /api/setup/decision {choiceId: 'clean'} removes the existing project directory then proceeds with the original connect dispatch", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-name-conflict-test-"));
    const projectDir = path.join(workspaceRoot, "acme");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "wren_project.yml"), "name: acme\n");
    writeFileSync(path.join(projectDir, "stale.txt"), "leftover from a previous failed run\n");

    const setupRunner = stubSetupRunner(async () => ({ finalText: "SETUP_STATUS: ok - connected to postgres" }));
    const store = new Store(":memory:");
    const deps: TurnDeps = { store, route: okConnectRoute, baseRouteOptions: BASE_ROUTE_OPTIONS, setupRunner, workspaceRoot };
    const app = createApp(deps);

    const connectRes = await app.request("/api/setup/connect", { method: "POST", body: JSON.stringify({ projectName: "acme", sourceType: "bigquery", variant: "dataset" }) });
    expect(connectRes.status).toBe(409);
    const { sessionId } = (await connectRes.json()) as { sessionId: string };
    expect(existsSync(projectDir)).toBe(true); // untouched by the pre-flight itself — only the decision endpoint deletes

    const decisionRes = await app.request("/api/setup/decision", { method: "POST", body: JSON.stringify({ sessionId, choiceId: "clean" }) });
    expect(decisionRes.status).toBe(200);
    const { turnId } = (await decisionRes.json()) as { sessionId: string; turnId: string };

    expect(existsSync(projectDir)).toBe(false); // wiped before the connect turn is dispatched

    const turn = store.getTurn(turnId);
    expect(turn?.agentId).toBe(CONNECT_SOURCE_AGENT_ID);
    expect(turn?.setupStepKey).toBe("connect");
    expect(turn?.composedInput).toContain("acme");
    expect(turn?.composedInput).toContain("BIGQUERY_PROJECT_ID");

    const session = store.getSession(sessionId);
    expect(session?.status).toBe("active");
    expect(session?.pendingDecision).toBeNull();
  });

  it("(e-guard) POST /api/setup/decision 400s a 'clean' whose recorded pendingDecision.projectName resolves outside the workspace root, instead of deleting anything (defense-in-depth path-traversal guard)", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-name-conflict-test-"));
    const setupRunner = stubSetupRunner(async () => ({ finalText: "SETUP_STATUS: ok" }));
    const store = new Store(":memory:");
    // Simulates a corrupted/adversarial pendingDecision that bypassed POST /api/setup/connect's own
    // SAFE_PROJECT_NAME validation entirely — the decision endpoint must re-validate rather than
    // trust a value read back out of the store (mirrors resolveProjectDir's own doc comment).
    const session = store.createSession("Setup: escape");
    store.updateSessionDecision(session.id, "awaiting_decision", JSON.stringify({ kind: "name_conflict", projectName: "../escape", sourceType: "postgres" }));
    const deps: TurnDeps = { store, route: okConnectRoute, baseRouteOptions: BASE_ROUTE_OPTIONS, setupRunner, workspaceRoot };
    const app = createApp(deps);

    const res = await app.request("/api/setup/decision", { method: "POST", body: JSON.stringify({ sessionId: session.id, choiceId: "clean" }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("projectName") });

    // Still parked awaiting the decision — nothing was cleared or deleted.
    const reread = store.getSession(session.id);
    expect(reread?.status).toBe("awaiting_decision");
  });
});

describe("GET /api/sessions — excludes the setup session", () => {
  it("filters out the tracked setup session, keeping ordinary Ask sessions", async () => {
    const { app, store } = buildApp();
    const ordinary = store.createSession("Revenue by region");
    const setupSession = store.createSession("Setup: acme");
    store.setSetupSessionId(setupSession.id);

    const res = await app.request("/api/sessions");
    expect(res.status).toBe(200);
    const sessions = (await res.json()) as Array<{ id: string; title: string }>;
    expect(sessions.map((s) => s.id)).toEqual([ordinary.id]);
    expect(sessions.some((s) => s.id === setupSession.id)).toBe(false);
  });

  it("returns all sessions, including one titled 'Setup: ...', when no setup session is tracked", async () => {
    const { app, store } = buildApp();
    const ordinary = store.createSession("Revenue by region");
    // A session that merely looks like a setup session (title prefix) but isn't the tracked
    // getSetupSessionId() one must NOT be filtered — the fix keys off id, not title.
    const lookalike = store.createSession("Setup: acme");
    expect(store.getSetupSessionId()).toBeUndefined();

    const res = await app.request("/api/sessions");
    expect(res.status).toBe(200);
    const sessions = (await res.json()) as Array<{ id: string; title: string }>;
    expect(sessions.map((s) => s.id).sort()).toEqual([ordinary.id, lookalike.id].sort());
  });

  it("GET /api/sessions/:id still serves the setup session directly by id (only the list filters it)", async () => {
    const { app, store } = buildApp();
    const setupSession = store.createSession("Setup: acme");
    store.setSetupSessionId(setupSession.id);

    const res = await app.request(`/api/sessions/${setupSession.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(setupSession.id);
  });
});

describe("POST /api/setup/reset — deletes the tracked setup session row, not just its id", () => {
  it("a reset after a failed adopt deletes the previously-tracked setup session row (turns/events included), so /api/sessions never leaks the orphan, while ordinary sessions and a subsequent new setup session are unaffected", async () => {
    const unbindProject = vi.fn();
    const { app, store } = buildApp(undefined, {
      setupRunner: stubSetupRunner(async () => ({ finalText: "SETUP_STATUS: ok" })),
      workspaceRoot: mkdtempSync(path.join(tmpdir(), "wren-harness-setup-test-")),
      unbindProject,
    });

    // Simulate the real repro: a setup session gets created and dispatched into (turn + events),
    // then tracked as the wizard's setup session — mirroring what POST /api/setup/connect does.
    const staleSetupSession = store.createSession("Setup: demo");
    store.createTurn({ id: "stale-turn", sessionId: staleSetupSession.id, question: "connect_source", composedInput: null });
    store.insertEvent({ sessionId: staleSetupSession.id, kind: "user", payload: { id: "evt-stale", kind: "user", text: "connect_source" }, turnId: null });
    store.setSetupSessionId(staleSetupSession.id);

    // An ordinary Ask session must survive the reset untouched.
    const ordinary = store.createSession("Revenue by region");

    const res = await app.request("/api/setup/reset", { method: "POST" });
    expect(res.status).toBe(200);

    // The orphan-causing bug: resetSetup used to forget the id (deleteConfig) without deleting the
    // row, so the row survived while getSetupSessionId() returned undefined — leaking it back into
    // the Ask sidebar (the /api/sessions id-filter matched nothing). Assert the ROW itself is gone.
    expect(store.getSession(staleSetupSession.id)).toBeUndefined();
    expect(store.getTurn("stale-turn")).toBeUndefined();
    expect(store.listEventsForSession(staleSetupSession.id)).toHaveLength(0);

    const sessions = (await (await app.request("/api/sessions")).json()) as Array<{ id: string }>;
    expect(sessions.map((s) => s.id)).toEqual([ordinary.id]);
    expect(sessions.some((s) => s.id === staleSetupSession.id)).toBe(false);

    // Ordinary session state is untouched by the reset.
    expect(store.getSession(ordinary.id)).toBeDefined();

    // A subsequent setup session (e.g. the next connect attempt) still works normally.
    const freshSetupSession = store.createSession("Setup: demo");
    store.setSetupSessionId(freshSetupSession.id);
    expect(store.getSetupSessionId()).toBe(freshSetupSession.id);
    const sessionsAfterFreshSetup = (await (await app.request("/api/sessions")).json()) as Array<{ id: string }>;
    expect(sessionsAfterFreshSetup.map((s) => s.id)).toEqual([ordinary.id]); // fresh setup session correctly filtered too
  });

  it("resetSetup with no tracked setup session (nothing to clean up) is a no-op on sessions — doesn't throw, doesn't touch ordinary sessions", async () => {
    const { app, store } = buildApp(undefined, {
      setupRunner: stubSetupRunner(async () => ({ finalText: "SETUP_STATUS: ok" })),
      workspaceRoot: mkdtempSync(path.join(tmpdir(), "wren-harness-setup-test-")),
    });
    const ordinary = store.createSession("Revenue by region");
    expect(store.getSetupSessionId()).toBeUndefined();

    const res = await app.request("/api/setup/reset", { method: "POST" });
    expect(res.status).toBe(200);
    expect(store.getSession(ordinary.id)).toBeDefined();
  });
});
