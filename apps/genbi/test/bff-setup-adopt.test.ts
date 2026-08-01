import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SetupStepRunner } from "../harness/index.js";

// Route-level tests for the adopt flow: mock verifyAdoptProject, runSetProfile, and
// adoptWithChosenProfile themselves (already unit-tested against a real execFile mock in
// test/adopt.test.ts, including the validate-then-rollback behavior) so these tests exercise
// only server/app.ts's routing/decision-checkpoint wiring — same division of labor as
// test/bff-setup-config.test.ts mocking loadContextShow for its context-route tests.
const verifyAdoptProjectMock = vi.fn<(typeof import("../server/adopt.js"))["verifyAdoptProject"]>();
const runSetProfileMock = vi.fn<(typeof import("../server/adopt.js"))["runSetProfile"]>();
const adoptWithChosenProfileMock = vi.fn<(typeof import("../server/adopt.js"))["adoptWithChosenProfile"]>();
vi.mock("../server/adopt.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/adopt.js")>();
  return {
    ...actual,
    verifyAdoptProject: (...args: unknown[]) => (verifyAdoptProjectMock as (...a: unknown[]) => unknown)(...args),
    runSetProfile: (...args: unknown[]) => (runSetProfileMock as (...a: unknown[]) => unknown)(...args),
    adoptWithChosenProfile: (...args: unknown[]) => (adoptWithChosenProfileMock as (...a: unknown[]) => unknown)(...args),
  };
});

const { createApp } = await import("../server/app.js");
const { Store } = await import("../server/db.js");
const { BUILD_CONTEXT_AGENT_ID } = await import("../harness/index.js");
const { parseSse } = await import("./bff-sse-helpers.js");

const BASE_ROUTE_OPTIONS = {
  authChoice: { mode: "api-key" as const, adapter: "mock" },
  profileSource: "/fixture/profile",
  userProject: "/fixture/project",
};

describe("POST /api/setup/adopt + GET/POST /api/setup/mode + the build_context decision checkpoint", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(path.join(tmpdir(), "wren-harness-adopt-test-"));
    verifyAdoptProjectMock.mockReset();
    runSetProfileMock.mockReset();
    adoptWithChosenProfileMock.mockReset();
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  function buildApp(opts?: {
    readonly bindProject?: (dir: string) => void;
    readonly getUserProject?: () => string | undefined;
    readonly run?: SetupStepRunner["run"];
  }) {
    const store = new (Store as unknown as new (path: string) => InstanceType<typeof Store>)(":memory:");
    const setupRunner = { run: opts?.run ?? (async () => ({ finalText: "SETUP_STATUS: ok" })) };
    const deps = {
      store,
      route: async () => ({ backend: "agent" as const, warnings: [], kind: "answer" as const, envelope: { blocks: [], summary: "ok" }, trace: { steps: [] } }),
      baseRouteOptions: BASE_ROUTE_OPTIONS,
      setupRunner,
      workspaceRoot,
      ...(opts?.bindProject ? { bindProject: opts.bindProject } : {}),
      ...(opts?.getUserProject ? { getUserProject: opts.getUserProject } : {}),
    };
    const app = createApp(deps as Parameters<typeof createApp>[0]);
    return { app, store };
  }

  it("GET /api/setup/mode returns an undefined mode before it's ever been chosen", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/setup/mode");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mode: undefined });
  });

  it("POST /api/setup/mode records the choice and swaps the connect/adopt steps entry", async () => {
    const { app, store } = buildApp();

    const adoptRes = await app.request("/api/setup/mode", { method: "POST", body: JSON.stringify({ mode: "adopt" }) });
    expect(adoptRes.status).toBe(200);
    const adoptBody = (await adoptRes.json()) as { mode: string; steps: Array<{ key: string; title: string }> };
    expect(adoptBody.mode).toBe("adopt");
    expect(adoptBody.steps.some((s) => s.key === "adopt")).toBe(true);
    expect(adoptBody.steps.some((s) => s.key === "connect")).toBe(false);
    expect((await (await app.request("/api/setup/mode")).json()) as { mode: string }).toEqual({ mode: "adopt" });

    const createRes = await app.request("/api/setup/mode", { method: "POST", body: JSON.stringify({ mode: "create" }) });
    const createBody = (await createRes.json()) as { mode: string; steps: Array<{ key: string }> };
    expect(createBody.steps.some((s) => s.key === "connect")).toBe(true);
    expect(createBody.steps.some((s) => s.key === "adopt")).toBe(false);
    expect(store.getSetupMode()).toBe("create");
  });

  it("POST /api/setup/mode 400s on an invalid mode value", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/setup/mode", { method: "POST", body: JSON.stringify({ mode: "bogus" }) });
    expect(res.status).toBe(400);
  });

  it("POST /api/setup/mode 500s when agentic setup isn't configured", async () => {
    const store = new Store(":memory:");
    const app = createApp({
      store,
      route: async () => ({ backend: "agent" as const, warnings: [], kind: "answer" as const, envelope: { blocks: [], summary: "ok" }, trace: { steps: [] } }),
      baseRouteOptions: BASE_ROUTE_OPTIONS,
    } as Parameters<typeof createApp>[0]);
    const res = await app.request("/api/setup/mode", { method: "POST", body: JSON.stringify({ mode: "adopt" }) });
    expect(res.status).toBe(500);
  });

  it("POST /api/setup/adopt 500s when agentic setup isn't configured", async () => {
    const store = new Store(":memory:");
    const app = createApp({
      store,
      route: async () => ({ backend: "agent" as const, warnings: [], kind: "answer" as const, envelope: { blocks: [], summary: "ok" }, trace: { steps: [] } }),
      baseRouteOptions: BASE_ROUTE_OPTIONS,
    } as Parameters<typeof createApp>[0]);
    const res = await app.request("/api/setup/adopt", { method: "POST", body: JSON.stringify({ projectPath: "/some/path" }) });
    expect(res.status).toBe(500);
  });

  it("POST /api/setup/adopt 400s when projectPath is missing", async () => {
    const { app } = buildApp();
    const res = await app.request("/api/setup/adopt", { method: "POST", body: JSON.stringify({}) });
    expect(res.status).toBe(400);
    expect(verifyAdoptProjectMock).not.toHaveBeenCalled();
  });

  it("verify-fail: passes verifyAdoptProject's failure message straight through as status: error, without binding", async () => {
    verifyAdoptProjectMock.mockResolvedValue({ status: "error", message: "connection check failed for profile \"acme\": connection refused" });
    const bindProject = vi.fn();
    const { app } = buildApp({ bindProject });

    const res = await app.request("/api/setup/adopt", { method: "POST", body: JSON.stringify({ projectPath: "/some/existing/acme" }) });
    expect(res.status).toBe(200); // per SetupAdoptResponse's doc comment: 200 for ok/error, 409 for select_profile, 400 only for a malformed body
    expect(await res.json()).toEqual({ status: "error", message: 'connection check failed for profile "acme": connection refused' });
    expect(bindProject).not.toHaveBeenCalled();
  });

  it("verify-ok + MDL present: binds the project directly and returns status: ok", async () => {
    verifyAdoptProjectMock.mockResolvedValue({ status: "ok", hasMdl: true, sourceType: "postgres" });
    const bindProject = vi.fn();
    const { app } = buildApp({ bindProject });

    const projectPath = path.join(workspaceRoot, "existing-project");
    const res = await app.request("/api/setup/adopt", { method: "POST", body: JSON.stringify({ projectPath }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; message: string };
    expect(body.status).toBe("ok");
    expect(bindProject).toHaveBeenCalledTimes(1);
    expect(bindProject).toHaveBeenCalledWith(path.resolve(projectPath));
  });

  it("verify-ok + MDL present (direct bind) marks adopt + context done, not just bind — so the sidebar never shows bind done above two un-started earlier steps", async () => {
    verifyAdoptProjectMock.mockResolvedValue({ status: "ok", hasMdl: true, sourceType: "postgres" });
    const { app, store } = buildApp({ bindProject: vi.fn() });

    // Enter adopt mode first, same as the real wizard flow, so the steps array carries the
    // "adopt" key (not "connect") before the direct-bind branch runs.
    await app.request("/api/setup/mode", { method: "POST", body: JSON.stringify({ mode: "adopt" }) });

    const projectPath = path.join(workspaceRoot, "existing-project");
    const res = await app.request("/api/setup/adopt", { method: "POST", body: JSON.stringify({ projectPath }) });
    expect((await res.json())).toMatchObject({ status: "ok" });

    const steps = store.getSetupSteps();
    expect(steps.find((s) => s.key === "adopt")?.state).toBe("done");
    expect(steps.find((s) => s.key === "context")?.state).toBe("done");
    // "bind" isn't touched by this route (that's POST /api/setup/compile-bind's job) — but it
    // must never be left "todo" beneath the two steps just marked "done" above. Simulate the
    // frontend's follow-up compile-bind call marking bind done + ask current, then confirm the
    // full sequence has no orphaned "todo" ahead of it.
    store.setSetupSteps(steps.map((s) => (s.key === "bind" ? { ...s, state: "done" as const } : s.key === "ask" ? { ...s, state: "current" as const } : s)));
    const finalSteps = store.getSetupSteps();
    expect(finalSteps.map((s) => [s.key, s.state])).toEqual([
      ["runtime", "current"], // unrelated to this bug — PUT /api/config/runtime was never called in this test
      ["adopt", "done"],
      ["context", "done"],
      ["bind", "done"],
      ["ask", "current"],
    ]);
  });

  it("verify-ok + MDL missing: does NOT bind, returns needs_decision with a build_context decision", async () => {
    verifyAdoptProjectMock.mockResolvedValue({ status: "ok", hasMdl: false, sourceType: "duckdb" });
    const bindProject = vi.fn();
    const { app, store } = buildApp({ bindProject });

    const projectPath = path.join(workspaceRoot, "existing-project");
    const res = await app.request("/api/setup/adopt", { method: "POST", body: JSON.stringify({ projectPath }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessionId: string; status: string; decision: { kind: string; options: Array<{ id: string }> } };
    expect(body.status).toBe("needs_decision");
    expect(body.decision).toMatchObject({ kind: "build_context", options: [{ id: "build" }, { id: "cancel" }] });
    expect(bindProject).not.toHaveBeenCalled();

    const session = store.getSession(body.sessionId);
    expect(session?.status).toBe("awaiting_decision");
    expect(session?.pendingDecision && JSON.parse(session.pendingDecision)).toEqual({
      kind: "build_context",
      projectPath: path.resolve(projectPath),
      sourceType: "duckdb",
    });
  });

  it("build_context decision, choiceId 'cancel': clears the checkpoint without dispatching a turn", async () => {
    verifyAdoptProjectMock.mockResolvedValue({ status: "ok", hasMdl: false, sourceType: "duckdb" });
    const { app, store } = buildApp();
    const projectPath = path.join(workspaceRoot, "existing-project");
    const adoptRes = await app.request("/api/setup/adopt", { method: "POST", body: JSON.stringify({ projectPath }) });
    const { sessionId } = (await adoptRes.json()) as { sessionId: string };

    const res = await app.request("/api/setup/decision", { method: "POST", body: JSON.stringify({ sessionId, choiceId: "cancel" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sessionId, action: "cancel" });

    const session = store.getSession(sessionId);
    expect(session?.status).toBe("active");
    expect(session?.pendingDecision).toBeNull();
  });

  it("build_context decision, unknown choiceId: 400s without touching the checkpoint", async () => {
    verifyAdoptProjectMock.mockResolvedValue({ status: "ok", hasMdl: false, sourceType: "duckdb" });
    const { app, store } = buildApp();
    const projectPath = path.join(workspaceRoot, "existing-project");
    const adoptRes = await app.request("/api/setup/adopt", { method: "POST", body: JSON.stringify({ projectPath }) });
    const { sessionId } = (await adoptRes.json()) as { sessionId: string };

    const res = await app.request("/api/setup/decision", { method: "POST", body: JSON.stringify({ sessionId, choiceId: "bogus" }) });
    expect(res.status).toBe(400);
    const session = store.getSession(sessionId);
    expect(session?.status).toBe("awaiting_decision");
  });

  it("build_context decision, choiceId 'build': creates a context turn scoped to the adopted project's own dirname/basename, and streaming it to completion binds the project", async () => {
    verifyAdoptProjectMock.mockResolvedValue({ status: "ok", hasMdl: false, sourceType: "duckdb" });
    const adoptedProjectDir = path.join(workspaceRoot, "some", "nested", "existing-project");
    let boundProject: string | undefined;
    const bindProject = vi.fn((dir: string) => {
      boundProject = dir;
    });
    const { app, store } = buildApp({
      bindProject,
      getUserProject: () => boundProject,
      run: async (opts) => {
        expect(opts.agentId).toBe(BUILD_CONTEXT_AGENT_ID);
        opts.onEvent?.({
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
        opts.onEvent?.({
          runId: "test-run",
          seq: 2,
          kind: "tool.result",
          stepId: "build",
          callId: "discover-schema",
          tool: "setup_execution",
          status: "success",
          summary: '{"exitCode":0,"stdout":"[\\"customers\\"]","stderr":""}',
        });
        // Actually write the MDL the real build_context agent would produce — parseSetupTerminal
        // (server/setup/runner.ts) verifies target/mdl.json on disk, not just the reported text.
        mkdirSync(path.join(adoptedProjectDir, "target"), { recursive: true });
        writeFileSync(
          path.join(adoptedProjectDir, "target", "mdl.json"),
          JSON.stringify({
            catalog: "wren",
            schema: "public",
            models: [{ name: "customers" }],
            relationships: [],
            views: [],
            cubes: [{ name: "metrics", baseObject: "customers", measures: [{ name: "row_count", expression: "COUNT(*)" }] }],
          }),
        );
        return { finalText: "Generated MDL from the discovered schema.\nSETUP_STATUS: ok - built MDL with 1 model" };
      },
    });

    // Real usage always picks a mode before adopting (see POST /api/setup/mode's doc comment);
    // this matters here specifically because the steps array only carries an "adopt" key once
    // that's happened (the fix marks that key done further down).
    await app.request("/api/setup/mode", { method: "POST", body: JSON.stringify({ mode: "adopt" }) });

    const adoptRes = await app.request("/api/setup/adopt", { method: "POST", body: JSON.stringify({ projectPath: adoptedProjectDir }) });
    const { sessionId } = (await adoptRes.json()) as { sessionId: string };

    const decisionRes = await app.request("/api/setup/decision", { method: "POST", body: JSON.stringify({ sessionId, choiceId: "build" }) });
    expect(decisionRes.status).toBe(200);
    const { turnId } = (await decisionRes.json()) as { sessionId: string; turnId: string };

    const turn = store.getTurn(turnId);
    expect(turn?.agentId).toBe(BUILD_CONTEXT_AGENT_ID);
    expect(turn?.setupStepKey).toBe("context");
    // The adopted project can live anywhere on disk — the turn carries ITS OWN workspaceRoot
    // (dirname of the adopted path), not the bootstrap workspaceRoot.
    expect(turn?.workspaceRoot).toBe(path.dirname(adoptedProjectDir));

    const session = store.getSession(sessionId);
    expect(session?.status).toBe("active");
    expect(session?.pendingDecision).toBeNull();

    // Bind only actually happens once the turn resolves ok (executeSetupTurn, server/turn.ts) —
    // not at decision time.
    expect(bindProject).not.toHaveBeenCalled();

    const streamRes = await app.request(`/api/sessions/${sessionId}/stream?turn=${turnId}`);
    const frames = parseSse(await streamRes.text());
    const setupStatusFrame = frames.find((f) => f.event === "event");
    expect((setupStatusFrame?.data as { status?: string } | undefined)?.status).toBe("ok");

    expect(bindProject).toHaveBeenCalledTimes(1);
    expect(bindProject).toHaveBeenCalledWith(adoptedProjectDir);

    const steps = store.getSetupSteps();
    // Adopt's own verification already succeeded before this build_context turn ever
    // ran (see POST /api/setup/adopt), so "adopt" must be done here too, not left at "todo"
    // underneath "context" done and "bind" current.
    expect(steps.find((s) => s.key === "adopt")?.state).toBe("done");
    expect(steps.find((s) => s.key === "context")?.state).toBe("done");
    expect(steps.find((s) => s.key === "bind")?.state).toBe("current");
  });

  describe("no profile pinned: the select_profile decision checkpoint", () => {
    it("needs_profile: returns HTTP 409 with a select_profile decision (one option per candidate), without binding or calling runSetProfile", async () => {
      verifyAdoptProjectMock.mockResolvedValue({
        status: "needs_profile",
        sourceType: "duckdb",
        candidates: [
          { name: "demo", datasource: "duckdb" },
          { name: "staging", datasource: "duckdb" },
        ],
      });
      const bindProject = vi.fn();
      const { app } = buildApp({ bindProject });

      const projectPath = path.join(workspaceRoot, "existing-project");
      const res = await app.request("/api/setup/adopt", { method: "POST", body: JSON.stringify({ projectPath }) });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { status: string; decision?: { kind: string; options: Array<{ id: string; label: string }> } };
      expect(body.status).toBe("needs_decision");
      expect(body.decision).toMatchObject({
        kind: "select_profile",
        options: [
          { id: "demo", label: "demo" },
          { id: "staging", label: "staging" },
        ],
      });
      expect(bindProject).not.toHaveBeenCalled();
      expect(runSetProfileMock).not.toHaveBeenCalled();
    });

    it("needs_profile with a single candidate still returns a checkpoint (409) rather than auto-pinning", async () => {
      verifyAdoptProjectMock.mockResolvedValue({ status: "needs_profile", sourceType: "duckdb", candidates: [{ name: "demo", datasource: "duckdb" }] });
      const bindProject = vi.fn();
      const { app } = buildApp({ bindProject });

      const projectPath = path.join(workspaceRoot, "existing-project");
      const res = await app.request("/api/setup/adopt", { method: "POST", body: JSON.stringify({ projectPath }) });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { decision?: { options: Array<{ id: string }> } };
      expect(body.decision?.options).toEqual([{ id: "demo", label: "demo" }]);
      expect(bindProject).not.toHaveBeenCalled();
      expect(runSetProfileMock).not.toHaveBeenCalled();
    });

    // The route must dispatch a re-POST-with-`profile` call through `adoptWithChosenProfile`
    // (never through the raw `runSetProfile` + `verifyAdoptProject` pair directly) — that
    // function is what re-validates the chosen name against the candidate list and rolls back
    // the manifest on a failed connection check (unit-tested in test/adopt.test.ts against a
    // real execFile mock). These route-level tests only prove app.ts wires the dispatch and
    // response-branching correctly, not the validate/rollback logic itself.

    it("re-POST with a chosen profile: dispatches through adoptWithChosenProfile, then proceeds down the normal ok/MDL-present path", async () => {
      adoptWithChosenProfileMock.mockResolvedValue({ status: "ok", hasMdl: true, sourceType: "duckdb" });
      const bindProject = vi.fn();
      const { app } = buildApp({ bindProject });

      const projectPath = path.join(workspaceRoot, "existing-project");
      const res = await app.request("/api/setup/adopt", { method: "POST", body: JSON.stringify({ projectPath, profile: "demo" }) });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe("ok");
      expect(adoptWithChosenProfileMock).toHaveBeenCalledWith(projectPath, "demo", expect.anything());
      expect(runSetProfileMock).not.toHaveBeenCalled();
      expect(verifyAdoptProjectMock).not.toHaveBeenCalled();
      expect(bindProject).toHaveBeenCalledTimes(1);
    });

    it("re-POST with a chosen profile: can land on needs_decision(build_context) if MDL is still missing", async () => {
      adoptWithChosenProfileMock.mockResolvedValue({ status: "ok", hasMdl: false, sourceType: "duckdb" });
      const bindProject = vi.fn();
      const { app } = buildApp({ bindProject });

      const projectPath = path.join(workspaceRoot, "existing-project");
      const res = await app.request("/api/setup/adopt", { method: "POST", body: JSON.stringify({ projectPath, profile: "demo" }) });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; decision?: { kind: string } };
      expect(body.status).toBe("needs_decision");
      expect(body.decision?.kind).toBe("build_context");
      expect(bindProject).not.toHaveBeenCalled();
    });

    it("re-POST with a chosen profile: when adoptWithChosenProfile reports an incompatible/rejected profile, returns status: error with zero mutation and never touches bind", async () => {
      adoptWithChosenProfileMock.mockResolvedValue({
        status: "error",
        message: 'profile "tpch" is not a compatible candidate for "existing-project" (data_source "duckdb") — choose one of: demo, staging',
      });
      const bindProject = vi.fn();
      const { app } = buildApp({ bindProject });

      const projectPath = path.join(workspaceRoot, "existing-project");
      const res = await app.request("/api/setup/adopt", { method: "POST", body: JSON.stringify({ projectPath, profile: "tpch" }) });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; message: string };
      expect(body.status).toBe("error");
      expect(body.message).toContain("not a compatible candidate");
      expect(bindProject).not.toHaveBeenCalled();
    });

    it("re-POST with a chosen profile: when the set-profile/validate step itself fails (e.g. rolled back after a failed connection check), returns status: error", async () => {
      adoptWithChosenProfileMock.mockResolvedValue({ status: "error", message: 'connection check failed for profile "demo": connection refused' });
      const bindProject = vi.fn();
      const { app } = buildApp({ bindProject });

      const projectPath = path.join(workspaceRoot, "existing-project");
      const res = await app.request("/api/setup/adopt", { method: "POST", body: JSON.stringify({ projectPath, profile: "demo" }) });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "error", message: 'connection check failed for profile "demo": connection refused' });
      expect(bindProject).not.toHaveBeenCalled();
    });

    it("zero candidates: verifyAdoptProject's own error message passes straight through as status: error (HTTP 200), not 409", async () => {
      verifyAdoptProjectMock.mockResolvedValue({
        status: "error",
        message: 'wren_project.yml at "/some/existing/acme" has no profile: pinned, and no compatible profile (data_source "duckdb") was found in ~/.wren/profiles.yml — run `wren profile add` to create one, then retry.',
      });
      const { app } = buildApp();

      const res = await app.request("/api/setup/adopt", { method: "POST", body: JSON.stringify({ projectPath: "/some/existing/acme" }) });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; message: string };
      expect(body.status).toBe("error");
      expect(body.message).toContain("no compatible profile");
    });
  });
});
