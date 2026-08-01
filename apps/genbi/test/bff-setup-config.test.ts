import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app.js";
import type { WrenContextShow } from "../server/context-source.js";
import { newId, Store } from "../server/db.js";
import { streamTurn } from "../server/turn.js";
import type { TurnDeps } from "../server/turn.js";
import { BUILD_CONTEXT_AGENT_ID, CONNECT_SOURCE_AGENT_ID, loadBundle, ModeBSessionError, SUBSCRIPTION_TOS_WARNING, WarbleCommandFailedError } from "../harness/index.js";
import type { AgentEvent, AuthChoice, Bundle, RouteOptions, RouteResult, SetupStepRunner } from "../harness/index.js";
import type { ContextFileNode, ContextOverview, EvalRun, RuntimeSettings, RuntimeSettingsPutResponse, SetupStatusEvent, SetupStep, SseFrame } from "../server/wire-types.js";
import { parseSse } from "./bff-sse-helpers.js";
import type { ParsedSseFrame } from "./bff-sse-helpers.js";
import { buildSyntheticBundle } from "./synthetic-bundle.js";

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
  readonly setupRunner?: SetupStepRunner;
  readonly setupRunnerFor?: (choice: AuthChoice) => SetupStepRunner;
  readonly getAuthChoice?: () => AuthChoice;
  readonly workspaceRoot?: string;
  readonly userProject?: string;
  readonly unbindProject?: () => void;
}

function buildApp(describeBundle?: TurnDeps["describeBundle"], setupOpts?: BuildAppSetupOptions) {
  const route = async (): Promise<RouteResult> => ({
    backend: "agent",
    warnings: [],
    kind: "answer",
    envelope: { blocks: [], summary: "ok" },
    trace: { steps: [] },
  });
  const store = new Store(":memory:");
  const deps: TurnDeps = {
    store,
    route,
    baseRouteOptions: setupOpts?.userProject !== undefined ? { ...BASE_ROUTE_OPTIONS, userProject: setupOpts.userProject } : BASE_ROUTE_OPTIONS,
    ...(describeBundle ? { describeBundle } : {}),
    ...(setupOpts?.setupRunner ? { setupRunner: setupOpts.setupRunner } : {}),
    ...(setupOpts?.setupRunnerFor ? { setupRunnerFor: setupOpts.setupRunnerFor } : {}),
    ...(setupOpts?.getAuthChoice ? { getAuthChoice: setupOpts.getAuthChoice } : {}),
    ...(setupOpts?.workspaceRoot !== undefined ? { workspaceRoot: setupOpts.workspaceRoot } : {}),
    ...(setupOpts?.unbindProject ? { unbindProject: setupOpts.unbindProject } : {}),
  };
  return { app: createApp(deps), store };
}

/** A `SetupStepRunner` stub whose `run()` is fully scripted by the test — no real Mode B/CLI involved. */
function stubSetupRunner(run: SetupStepRunner["run"]): SetupStepRunner {
  return { run };
}

/** Records the minimum successful Mode-A setup_execution discovery trace the terminal gate requires. */
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
}

function bundleWithGatedCheck(locked: boolean): Bundle {
  return loadBundle(buildSyntheticBundle({ guardrails: { some_gate: { enforcement: "gated_check", locked } } }));
}

describe("config/runtime + setup wizard endpoints", () => {
  it("GETs the seeded runtime settings and PUTs a partial patch that merges rather than replaces", async () => {
    const { app } = buildApp();
    const initial = (await (await app.request("/api/config/runtime")).json()) as RuntimeSettings;
    expect(initial.authMode).toBe("subscription");

    const putRes = await app.request("/api/config/runtime", { method: "PUT", body: JSON.stringify({ hybrid: true }) });
    expect(putRes.status).toBe(200);
    const updated = (await putRes.json()) as RuntimeSettingsPutResponse;
    expect(updated).toEqual({ ...initial, hybrid: true, warnings: [SUBSCRIPTION_TOS_WARNING] });

    const { warnings: _warnings, ...persisted } = updated;
    const reread = (await (await app.request("/api/config/runtime")).json()) as RuntimeSettings;
    expect(reread).toEqual(persisted);
  });

  it("saving runtime settings advances the wizard's first step (runtime -> done, connect -> current) exactly once — a later save is a no-op", async () => {
    const { app, store } = buildApp();
    // Seeded state: runtime current, everything else todo.
    expect(store.getSetupSteps().find((s) => s.key === "runtime")?.state).toBe("current");

    await app.request("/api/config/runtime", { method: "PUT", body: JSON.stringify({ hybrid: true }) });
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

    it("rejects switching to an api-key adapter whose env var is missing, without persisting or advancing the wizard", async () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      const { app, store } = buildApp();
      const before = store.getRuntimeSettings();

      const res = await app.request("/api/config/runtime", {
        method: "PUT",
        body: JSON.stringify({ authMode: "byo", apiKeyAdapter: "anthropic" }),
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
        body: JSON.stringify({ authMode: "byo", apiKeyAdapter: "openai-compatible" }),
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining("OPENAI_API_KEY") });
      expect(store.getRuntimeSettings()).toEqual(before);
      expect(store.getSetupSteps().find((s) => s.key === "runtime")?.state).toBe("current");
    });

    it("rejects switching to an api-key adapter with a blank model, without persisting or advancing the wizard — neither adapter has a default, so a blank value must not slip through as a silent 200", async () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-something");
      const { app, store } = buildApp();
      const before = store.getRuntimeSettings();

      const res = await app.request("/api/config/runtime", {
        method: "PUT",
        body: JSON.stringify({ authMode: "byo", apiKeyAdapter: "anthropic" }), // apiKeyModel omitted
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
        body: JSON.stringify({ authMode: "byo", apiKeyAdapter: "anthropic", apiKeyModel: "https://example.com/model" }),
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
    const { app, store } = buildApp(undefined, {
      setupRunner: stubSetupRunner(async () => ({ finalText: "SETUP_STATUS: ok" })),
      workspaceRoot: mkdtempSync(path.join(tmpdir(), "wren-harness-setup-test-")),
      unbindProject,
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
    expect(unbindProject).toHaveBeenCalledTimes(1);
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
    const { app } = buildApp(async () => bundleWithGatedCheck(true), { setupRunner, workspaceRoot });

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

  it("full flow: connect binds the project, then context builds the MDL and advances context->done + bind->current WITHOUT rebinding the project", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-context-test-"));
    let boundProject: string | undefined;
    let bindCallCount = 0;
    const setupRunner = stubSetupRunner(async (opts) => {
      if (opts.agentId === "build_context") {
        recordSuccessfulSchemaDiscovery(opts.onEvent);
        writeMdl(path.join(workspaceRoot, "acme"), ["customers", "orders", "products"]);
        return { finalText: "Generated MDL from the discovered schema.\nSETUP_STATUS: ok - built MDL with 3 models" };
      }
      mkdirSync(path.join(workspaceRoot, "acme"), { recursive: true });
      writeFileSync(path.join(workspaceRoot, "acme", "wren_project.yml"), "name: acme\n");
      return { finalText: "Scaffolded project acme and wrote an empty .env template.\nSETUP_STATUS: ok - connected to postgres" };
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
    expect(boundProject).toBe(path.join(workspaceRoot, "acme"));

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
    expect(boundProject).toBe(path.join(workspaceRoot, "acme")); // same project, unchanged

    const finalSteps = (await (await app.request("/api/setup/steps")).json()) as SetupStep[];
    expect(finalSteps.find((s) => s.key === "context")?.state).toBe("done");
    expect(finalSteps.find((s) => s.key === "bind")?.state).toBe("current");
  });

  it("a successful-looking context build without discovery creates one explicit retry checkpoint, then the retry resumes the captured SDK session and succeeds", async () => {
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
      expect(opts.prompt).toMatch(/corrective requirement/i);
      recordSuccessfulSchemaDiscovery(opts.onEvent);
      return { finalText: "SETUP_STATUS: ok - built MDL with 1 model and 1 measure", sessionId: "sdk-context-session" };
    });
    const { app, store } = buildApp(undefined, { setupRunner, workspaceRoot, getAuthChoice: () => ({ mode: "subscription", provider: "claude" }) });
    mkdirSync(path.join(workspaceRoot, "acme"), { recursive: true });
    writeFileSync(path.join(workspaceRoot, "acme", "wren_project.yml"), "name: acme\n");
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "duckdb" });

    const initial = await app.request("/api/setup/context", { method: "POST" });
    const { turnId: initialTurnId } = (await initial.json()) as { turnId: string };
    const initialFrames = parseSse(await (await app.request(`/api/sessions/${session.id}/stream?turn=${initialTurnId}`)).text());
    const checkpoint = initialFrames.find((frame) => frame.event === "event")?.data as SetupStatusEvent;
    expect(checkpoint).toMatchObject({ status: "needs_decision", decision: { kind: "schema_discovery_retry", options: [{ id: "retry" }, { id: "stop" }] } });
    expect(store.getSession(session.id)?.status).toBe("awaiting_decision");
    expect(store.getTurn(initialTurnId)?.contextRecovery).toBeNull();
    expect(JSON.parse(store.getTurn(initialTurnId)?.traceJson ?? "[]")).toEqual(
      expect.arrayContaining([expect.objectContaining({ input: { command: "wren context build" } })]),
    );

    const retry = await app.request("/api/setup/decision", { method: "POST", body: JSON.stringify({ sessionId: session.id, choiceId: "retry" }) });
    expect(retry.status).toBe(200);
    const { turnId: retryTurnId } = (await retry.json()) as { turnId: string };
    expect(store.getTurn(retryTurnId)).toMatchObject({ setupStepKey: "context", contextRecovery: "schema_discovery", resumeSessionId: "sdk-context-session" });

    const retryFrames = parseSse(await (await app.request(`/api/sessions/${session.id}/stream?turn=${retryTurnId}`)).text());
    expect(retryFrames).toEqual(expect.arrayContaining([expect.objectContaining({ event: "done" })]));
    expect(store.getSession(session.id)?.status).toBe("active");
    expect(contextRuns).toBe(2);
  });

  it("rejects a second context request while its schema-discovery checkpoint is pending, without creating another turn or dispatching the runner", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-setup-context-pending-decision-test-"));
    let contextRuns = 0;
    const setupRunner = stubSetupRunner(async (opts) => {
      contextRuns += 1;
      writeMdl(path.join(workspaceRoot, "acme"), ["customers"]);
      return { finalText: "SETUP_STATUS: ok - built MDL", sessionId: "sdk-context-session" };
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
    const modeBRunner = stubSetupRunner(async () => {
      throw new Error("Mode B must not run after the runtime switch");
    });
    const modeARunner = stubSetupRunner(async (opts) => {
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
      setupRunnerFor: (choice) => (choice.mode === "subscription" ? modeBRunner : modeARunner),
    });
    mkdirSync(path.join(workspaceRoot, "acme"), { recursive: true });
    writeFileSync(path.join(workspaceRoot, "acme", "wren_project.yml"), "name: acme\n");
    const session = store.createSession("Setup: acme");
    store.setSetupSessionId(session.id);
    store.setSetupConnectForm({ projectName: "acme", sourceType: "duckdb" });
    store.updateSessionDecision(
      session.id,
      "awaiting_decision",
      JSON.stringify({ kind: "schema_discovery_retry", stepKey: "context", sessionId: "mode-b-session" }),
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
  it("a context turn whose profile fails to compile emits a friendly error setup_status instead of a silent ok", async () => {
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

    // Not a silent success: the setup_status the wizard actually sees reports the compile failure.
    const setupStatusFrame = frames.find((f) => f.event === "event" && (f.data as { kind?: string }).kind === "setup_status");
    const statusEvent = setupStatusFrame?.data as SetupStatusEvent | undefined;
    expect(statusEvent).toBeDefined();
    expect(statusEvent?.status).toBe("error");
    // Friendly summary (the FIRST stderr line), never the raw multi-line stderr dump.
    expect(statusEvent?.message).toContain('relationship "orders_customers" references unknown model "orders"');
    expect(statusEvent?.message).not.toContain("help: define");
    expect(statusEvent?.message).not.toContain("relationships.yml:4:3");

    // Not the generic SSE error path either — the turn resolves normally (an "answer", carrying
    // the setup_status), with a trailing "done" frame, same as any other resolved setup turn.
    expect(frames.some((f) => f.event === "error")).toBe(false);
    expect(frames.some((f) => f.event === "done")).toBe(true);

    // Context genuinely finished building the MDL (that part of the step really succeeded) — the
    // step-state advance still runs; only the reported status changes.
    const steps = (await (await app.request("/api/setup/steps")).json()) as SetupStep[];
    expect(steps.find((s) => s.key === "context")?.state).toBe("done");
    expect(steps.find((s) => s.key === "bind")?.state).toBe("current");
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

    const res = await app.request("/api/setup/compile-bind", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { steps: SetupStep[]; verifyGatePassed: boolean };
    expect(body.verifyGatePassed).toBe(true);
    expect(body.steps.find((s) => s.key === "bind")?.state).toBe("done");
    expect(store.getVerifyGatePassed()).toBe(true);
  });

  it("compiles+loads the bundle and sets the gate FALSE when no compiled agent has a locked gated_check", async () => {
    const { app, store } = buildApp(async () => bundleWithGatedCheck(false));

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
    // `ModeBSetupRunner.effectiveMaxTurns` is what `server/turn.ts` reads to build the
    // "Continue (+N turns)" label. Omitted (as in tests (a)/(c) below) means the stub has no
    // `effectiveMaxTurns`, matching a plain `SetupStepRunner` that predates this override.
    effectiveMaxTurns?: SetupStepRunner["effectiveMaxTurns"],
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
    const { store, sessionId, contextTurnId, frames } = await setupToContextCheckpoint(workspaceRoot, async () => {
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
      // Stands in for a ModeBSetupRunner constructed with WREN_HARNESS_SETUP_MAX_TURNS=25 —
      // see ModeBSetupRunner.effectiveMaxTurns in harness/setup/runner.ts.
      (agentId) => (agentId === BUILD_CONTEXT_AGENT_ID ? CUSTOM_MAX_TURNS : undefined),
    );

    // The label shows the real budget, not DEFAULT_SETUP_MAX_TURNS (120).
    expect(frames[1]?.data).toMatchObject({
      decision: { options: [{ id: "continue", label: `Continue (+${CUSTOM_MAX_TURNS} turns)` }, { id: "stop", label: "Stop" }] },
    });

    // Picking "continue" re-dispatches the context step against the SAME setupRunner instance
    // (deps.setupRunner is wired once at boot — see server/bin.ts), so whatever budget
    // effectiveMaxTurns() reported is exactly what run() will apply on resume: the two can't
    // drift because both read `ModeBSetupRunnerOptions.maxTurns` through the same resolver.
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
    // ModeBSessionError, was thrown above), so the resumed turn carries no resumeSessionId —
    // there is nothing for setup/runner.ts to forward as `--resume <id>`.
    expect(resumeTurn?.resumeSessionId).toBeNull();
  });

  it("(c2) Plan A: when the failed turn surfaced a resumable session id (ModeBSessionError), 'continue' resumes that SAME session with the short continuation prompt instead of the resume-from-disk inventory prompt", async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-max-turns-resume-session-test-"));
    const CAPTURED_SESSION_ID = "sess_captured_abc123";
    const { app, store, sessionId } = await setupToContextCheckpoint(workspaceRoot, async () => {
      mkdirSync(path.join(workspaceRoot, "acme", "models", "customers"), { recursive: true });
      // Unlike test (c)'s plain Error, this is a ModeBSessionError — the shape a real
      // warble-agent-sdk `error_max_turns` exit produces once it has read the dispatcher's
      // `{t:"session",id}` line (see runModeBDefault/spawnChat in harness/route/mode-b.ts).
      throw new ModeBSessionError("dispatcher exited: error_max_turns after 120 turns", CAPTURED_SESSION_ID);
    });

    // The captured session id is persisted on the pending decision, ready for the "continue" branch.
    const session = store.getSession(sessionId);
    expect(session?.pendingDecision && JSON.parse(session.pendingDecision)).toEqual({
      kind: "max_turns_continue",
      stepKey: "context",
      sessionId: CAPTURED_SESSION_ID,
    });

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

    const connectRes = await app.request("/api/setup/connect", { method: "POST", body: JSON.stringify({ projectName: "acme", sourceType: "postgres" }) });
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
