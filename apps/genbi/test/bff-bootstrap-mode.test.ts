import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app.js";
import { Store } from "../server/db.js";
import { invalidateBundleAgentIdsCache, isProjectBound, resolveAuthChoice, resolveUserProject } from "../server/turn.js";
import type { TurnDeps } from "../server/turn.js";
import { loadBundle } from "../harness/index.js";
import type { AuthChoice, Bundle, RouteOptions, RouteResult } from "../harness/index.js";
import { NATIVE_DISPATCH_REGISTRY } from "../server/native-dispatch-registry.js";
import { buildSyntheticBundle } from "./synthetic-bundle.js";

const BASE_ROUTE_OPTIONS: Omit<RouteOptions, "question" | "onEvent"> = {
  authChoice: { mode: "api-key", adapter: "mock" },
  profileSource: "/fixture/profile",
  userProject: "", // bootstrap mode: no fixed project — resolveUserProject falls through to getUserProject()
};

const okRoute = async (): Promise<RouteResult> => ({
  backend: "agent",
  warnings: [],
  kind: "answer",
  envelope: { blocks: [], summary: "ok" },
  trace: { steps: [] },
});

const okBundle = (profile = "synthetic-profile"): Bundle => loadBundle(buildSyntheticBundle({ profile }));

/** Builds a bootstrap-mode `TurnDeps`: starts unbound, with a `bindProject`/`getUserProject` pair mirroring `server/bin.ts`'s mutable-binding closure. */
function buildBootstrapApp() {
  const store = new Store(":memory:");
  let boundProject: string | undefined;
  // eslint-disable-next-line prefer-const
  let deps: TurnDeps;
  function getUserProject(): string | undefined {
    return boundProject;
  }
  function bindProject(dir: string): void {
    boundProject = dir;
    invalidateBundleAgentIdsCache(deps);
  }
  deps = {
    store,
    route: okRoute,
    baseRouteOptions: BASE_ROUTE_OPTIONS,
    describeBundle: async () => okBundle(),
    describeHarnessBundle: async (purpose) => okBundle(NATIVE_DISPATCH_REGISTRY[purpose].profile),
    getUserProject,
    bindProject,
  };
  return { app: createApp(deps), store, deps, bindProject, getUserProject };
}

describe("bootstrap-mode project binding (getUserProject/bindProject)", () => {
  it("isProjectBound/resolveUserProject report unbound before bindProject is ever called", () => {
    const { deps } = buildBootstrapApp();
    expect(isProjectBound(deps)).toBe(false);
    expect(resolveUserProject(deps)).toBeUndefined();
  });

  it("bindProject(dir) makes isProjectBound/resolveUserProject report the newly bound dir", () => {
    const { deps, bindProject } = buildBootstrapApp();
    bindProject("/workspace/root/acme");
    expect(isProjectBound(deps)).toBe(true);
    expect(resolveUserProject(deps)).toBe("/workspace/root/acme");
  });

  it("a mutable getUserProject binding takes precedence over a fixed baseRouteOptions.userProject", () => {
    const store = new Store(":memory:");
    let boundProject: string | undefined = "/mutable/project";
    const deps: TurnDeps = {
      store,
      route: okRoute,
      baseRouteOptions: { ...BASE_ROUTE_OPTIONS, userProject: "/fixed/project" },
      getUserProject: () => boundProject,
    };
    expect(resolveUserProject(deps)).toBe("/mutable/project");
    boundProject = undefined;
    expect(resolveUserProject(deps)).toBeUndefined(); // falls to undefined, NOT back to the fixed value, once getUserProject is wired
  });

  it("without getUserProject wired at all, resolveUserProject falls back to the fixed baseRouteOptions.userProject (pre-bootstrap-mode behavior)", () => {
    const store = new Store(":memory:");
    const deps: TurnDeps = { store, route: okRoute, baseRouteOptions: { ...BASE_ROUTE_OPTIONS, userProject: "/fixed/project" } };
    expect(isProjectBound(deps)).toBe(true);
    expect(resolveUserProject(deps)).toBe("/fixed/project");
  });

  describe("live auth-choice switching (resolveAuthChoice) — mirrors the getUserProject/resolveUserProject pattern", () => {
    it("a mutable getAuthChoice binding takes precedence over a fixed baseRouteOptions.authChoice", () => {
      const store = new Store(":memory:");
      let boundAuthChoice: AuthChoice = { mode: "subscription", provider: "claude" };
      const deps: TurnDeps = {
        store,
        route: okRoute,
        baseRouteOptions: { ...BASE_ROUTE_OPTIONS, authChoice: { mode: "api-key", adapter: "mock" } },
        getAuthChoice: () => boundAuthChoice,
      };
      expect(resolveAuthChoice(deps)).toEqual({ mode: "subscription", provider: "claude" });

      boundAuthChoice = { mode: "local" };
      expect(resolveAuthChoice(deps)).toEqual({ mode: "local" }); // reflects the live rebind, not the fixed boot-time value
    });

    it("without getAuthChoice wired at all, resolveAuthChoice falls back to the fixed baseRouteOptions.authChoice (pre-live-switching behavior)", () => {
      const store = new Store(":memory:");
      const fixedAuthChoice: AuthChoice = { mode: "api-key", adapter: "mock" };
      const deps: TurnDeps = { store, route: okRoute, baseRouteOptions: { ...BASE_ROUTE_OPTIONS, authChoice: fixedAuthChoice } };
      expect(resolveAuthChoice(deps)).toEqual(fixedAuthChoice);
    });
  });

  describe("the 409 guard on routes that require a bound project", () => {
    it("POST /api/sessions/:id/turns 409s while unbound, and succeeds once bound", async () => {
      const { app, store, bindProject } = buildBootstrapApp();
      const session = store.createSession("s1");

      const before = await app.request(`/api/sessions/${session.id}/turns`, { method: "POST", body: JSON.stringify({ question: "hi" }) });
      expect(before.status).toBe(409);
      expect(await before.json()).toMatchObject({ error: expect.stringContaining("no wren project is bound") });

      bindProject("/workspace/root/acme");

      const after = await app.request(`/api/sessions/${session.id}/turns`, { method: "POST", body: JSON.stringify({ question: "hi" }) });
      expect(after.status).toBe(200);
      expect(await after.json()).toMatchObject({ turnId: expect.any(String) });
    });

    it("GET /api/harness permits raw Setup while unbound, but keeps analysis and context enrichment bound-gated", async () => {
      const { app, bindProject, deps } = buildBootstrapApp();
      const describeHarnessBundle = vi.fn(async (purpose: keyof typeof NATIVE_DISPATCH_REGISTRY) => okBundle(NATIVE_DISPATCH_REGISTRY[purpose].profile));
      (deps as { describeHarnessBundle?: TurnDeps["describeHarnessBundle"] }).describeHarnessBundle = describeHarnessBundle;

      const setup = await app.request("/api/harness?purpose=setup");
      expect(setup.status).toBe(200);
      expect(await setup.json()).toMatchObject({
        purpose: { purpose: "setup", scopeKind: "bootstrap" },
        profile: { boundContext: "Bootstrap workspace (no project bound)", status: "Bootstrap" },
        connection: { via: "Bootstrap workspace", tablesSynced: 0 },
      });
      expect(describeHarnessBundle).toHaveBeenCalledWith("setup", expect.objectContaining({ userProject: "" }));

      for (const purpose of ["analysis", "context_enrichment"]) {
        const before = await app.request(`/api/harness?purpose=${purpose}`);
        expect(before.status).toBe(409);
      }

      bindProject("/workspace/root/acme");
      const after = await app.request("/api/harness?purpose=analysis");
      expect(after.status).toBe(200);
    });

    it("POST /api/setup/compile-bind 409s while unbound, and succeeds once bound", async () => {
      const { app, bindProject } = buildBootstrapApp();

      const before = await app.request("/api/setup/compile-bind", { method: "POST" });
      expect(before.status).toBe(409);

      bindProject("/workspace/root/acme");

      const after = await app.request("/api/setup/compile-bind", { method: "POST" });
      expect(after.status).toBe(200);
      const body = (await after.json()) as { verifyGatePassed: boolean };
      expect(typeof body.verifyGatePassed).toBe("boolean");
    });

    it("GET /api/sessions/:id/stream 409s for a normal (non-setup) turn while unbound", async () => {
      const { app, store } = buildBootstrapApp();
      const session = store.createSession("s1");
      const turn = store.createTurn({ id: "turn-1", sessionId: session.id, question: "hi", composedInput: "hi", agentId: null });

      const res = await app.request(`/api/sessions/${session.id}/stream?turn=${turn.id}`);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining("no wren project is bound") });
    });

    it("GET /api/sessions/:id/stream is NOT 409-gated for a setup turn (setupStepKey !== null) even while unbound", async () => {
      const { app, store } = buildBootstrapApp();
      const session = store.createSession("s1");
      const turn = store.createTurn({
        id: "turn-setup-1",
        sessionId: session.id,
        question: "setup",
        composedInput: "setup",
        agentId: "connect_source",
        setupStepKey: "connect",
      });

      const res = await app.request(`/api/sessions/${session.id}/stream?turn=${turn.id}`);
      // Not a 409 — it may still fail downstream (no setupRunner wired in this test's deps), but
      // the point here is specifically that the bound-project guard does not block a setup turn.
      expect(res.status).not.toBe(409);
      expect(res.status).toBe(200);
    });
  });
});
