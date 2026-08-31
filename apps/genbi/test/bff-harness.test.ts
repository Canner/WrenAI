import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app.js";
import { Store } from "../server/db.js";
import type { TurnDeps } from "../server/turn.js";
import type { HarnessDto } from "../server/wire-types.js";
import { loadBundle } from "../harness/index.js";
import type { Bundle, RouteOptions, RouteResult } from "../harness/index.js";
import { HARNESS_PROFILE_IDENTITY_ERROR, NATIVE_DISPATCH_REGISTRY } from "../server/native-dispatch-registry.js";
import { buildSyntheticBundle } from "./synthetic-bundle.js";

const BASE_ROUTE_OPTIONS: Omit<RouteOptions, "question" | "onEvent"> = {
  authChoice: { mode: "api-key", adapter: "mock" },
  profileSource: "/fixture/profile",
  userProject: "/fixture/project",
};

function bundleForPurpose(purpose: keyof typeof NATIVE_DISPATCH_REGISTRY): Bundle {
  return loadBundle(buildSyntheticBundle({ profile: NATIVE_DISPATCH_REGISTRY[purpose].profile }));
}

function noRoute(): (options: RouteOptions) => Promise<RouteResult> {
  return async () => {
    throw new Error("route() must never be invoked by GET /api/harness");
  };
}

describe("GET /api/harness", () => {
  it("compiles/describes the bundle via the injected dependency and returns the mapped HarnessDto", async () => {
    const bundle: Bundle = loadBundle(
      buildSyntheticBundle({
        profile: "genbi-default",
        guardrails: { some_gate: { enforcement: "gated_check", locked: true } },
      }),
    );
    const deps: TurnDeps = {
      store: new Store(":memory:"),
      route: noRoute(),
      baseRouteOptions: BASE_ROUTE_OPTIONS,
      describeHarnessBundle: async (purpose) => {
        expect(purpose).toBe("analysis");
        return bundle;
      },
    };
    const app = createApp(deps);

    const res = await app.request("/api/harness?purpose=analysis");
    expect(res.status).toBe(200);
    const dto = (await res.json()) as HarnessDto;

    expect(dto.purpose).toEqual({ purpose: "analysis", profile: "genbi-default", scopeKind: "bound_project", executionKind: "native_session", available: false, reason: "The selected native session is unavailable." });
    expect(dto.profile).toMatchObject({ id: "genbi-default", verifyGate: true, bundleId: "genbi-default@vercel:headless", status: "Not bound yet" });
    expect(dto.runtime).toEqual({
      backend: "api-key",
      label: "API key (mock)",
      dispatcher: "in-process", // authChoice.mode "api-key" -> in-process, in-process
      // synthetic bundle's only agent has a single step on tier "cheap"; runtime.tierModels
      // reports the effective boot route until the seeded Setup defaults are explicitly saved.
      // That keeps the runtime panel aligned with what dispatch will actually use.
      tierModels: [{ tier: "cheap", model: "mock (no fixed model)" }],
    });
    expect(dto.connection.tablesSynced).toBe(3); // Store seeds 3 context models
    expect(dto.components).toHaveLength(1);
    expect(dto.components[0]).toMatchObject({ id: "synthetic_agent", name: "Synthetic Agent", callableAs: "do_thing", status: "unavailable", unavailableReason: "The selected native session is unavailable." });
    expect(dto.components[0]?.tiers).toEqual([{ tier: "cheap", model: "mock (no fixed model)" }]);
    expect(dto.components[0]?.tiers).toEqual(dto.runtime.tierModels);
  });

  it("makes selected-purpose unavailability disable otherwise available components", async () => {
    const deps: TurnDeps = {
      store: new Store(":memory:"),
      route: noRoute(),
      baseRouteOptions: BASE_ROUTE_OPTIONS,
      describeHarnessBundle: async () => bundleForPurpose("analysis"),
      nativeSessions: {
        readiness: async () => ({
          purposes: { analysis: { available: false, reason: "native host is unavailable" } },
        }),
      } as never,
    };
    const app = createApp(deps);

    const res = await app.request("/api/harness?purpose=analysis");
    expect(res.status).toBe(200);
    const dto = await res.json() as HarnessDto;
    expect(dto.purpose).toMatchObject({ available: false, reason: "native host is unavailable" });
    expect(dto.components[0]).toMatchObject({ status: "unavailable", unavailableReason: "native host is unavailable" });
  });

  it("uses Setup runner readiness for Setup while retaining native Setup compatibility only in diagnostics", async () => {
    const deps: TurnDeps = {
      store: new Store(":memory:"),
      route: noRoute(),
      baseRouteOptions: BASE_ROUTE_OPTIONS,
      describeHarnessBundle: async () => bundleForPurpose("setup"),
      setupRunner: {} as never,
      workspaceRoot: "/fixture/bootstrap-workspace",
      nativeSessions: {
        readiness: async () => ({
          purposes: { setup: { available: false, reason: "native setup sessions require a workspace root" } },
        }),
      } as never,
    };
    const app = createApp(deps);

    const res = await app.request("/api/harness?purpose=setup");
    expect(res.status).toBe(200);
    const dto = await res.json() as HarnessDto;
    expect(dto.purpose).toEqual({
      purpose: "setup",
      profile: "genbi-setup",
      scopeKind: "bootstrap",
      executionKind: "setup_runner",
      target: "in-process:setup",
      targetLabel: "In-process Setup runner",
      available: true,
    });
    expect(dto.components.every((component) => component.status === "ready")).toBe(true);
    expect(dto.nativeSessions.dispatches.find((dispatch) => dispatch.purpose === "setup")).toMatchObject({
      available: false,
      reason: "native setup sessions require a workspace root",
    });
  });

  it("keeps Setup available when its native-session diagnostic probe fails", async () => {
    const deps: TurnDeps = {
      store: new Store(":memory:"),
      route: noRoute(),
      baseRouteOptions: BASE_ROUTE_OPTIONS,
      describeHarnessBundle: async () => bundleForPurpose("setup"),
      setupRunner: {} as never,
      workspaceRoot: "/fixture/bootstrap-workspace",
      nativeSessions: {
        readiness: async () => { throw new Error("native readiness probe failed"); },
      } as never,
    };
    const app = createApp(deps);

    const res = await app.request("/api/harness?purpose=setup");
    expect(res.status).toBe(200);
    const dto = await res.json() as HarnessDto;
    expect(dto.purpose).toMatchObject({ executionKind: "setup_runner", available: true });
    expect(dto.components.every((component) => component.status === "ready")).toBe(true);
    expect(dto.nativeSessions.dispatches).toEqual(expect.arrayContaining([
      expect.objectContaining({ purpose: "setup", available: false }),
    ]));
  });

  it("reports the Setup wizard's own bootstrap-root requirement without classifying it as a native session", async () => {
    const deps: TurnDeps = {
      store: new Store(":memory:"),
      route: noRoute(),
      baseRouteOptions: { ...BASE_ROUTE_OPTIONS, authChoice: { mode: "subscription", provider: "codex" } },
      describeHarnessBundle: async () => bundleForPurpose("setup"),
      setupRunner: {} as never,
      nativeSessions: {
        readiness: async () => ({ purposes: { setup: { available: false, reason: "wrong native reason" } } }),
      } as never,
    };
    const app = createApp(deps);

    const res = await app.request("/api/harness?purpose=setup");
    expect(res.status).toBe(200);
    const dto = await res.json() as HarnessDto;
    expect(dto.purpose).toMatchObject({
      executionKind: "setup_runner",
      target: "codex-local:setup",
      targetLabel: "Codex Setup runner",
      available: false,
      reason: "The Setup wizard requires a bootstrap workspace root.",
    });
    expect(dto.purpose.reason).not.toContain("native");
    expect(dto.components[0]).toMatchObject({ status: "unavailable", unavailableReason: "The Setup wizard requires a bootstrap workspace root." });
  });

  it("returns 500 with a JSON error (not a crash) when the compile/describe dependency throws", async () => {
    const deps: TurnDeps = {
      store: new Store(":memory:"),
      route: noRoute(),
      baseRouteOptions: BASE_ROUTE_OPTIONS,
      describeHarnessBundle: async () => {
        throw new Error("warble dispatch failed: boom");
      },
    };
    const app = createApp(deps);

    const res = await app.request("/api/harness?purpose=setup");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "warble dispatch failed: boom" });
  });

  it("resolves every accepted purpose through the dedicated read-only seam", async () => {
    const describeHarnessBundle = vi.fn<(purpose: keyof typeof NATIVE_DISPATCH_REGISTRY) => Promise<Bundle>>(async (purpose) => bundleForPurpose(purpose));
    const deps: TurnDeps = { store: new Store(":memory:"), route: noRoute(), baseRouteOptions: BASE_ROUTE_OPTIONS, describeHarnessBundle };
    const app = createApp(deps);

    for (const [purpose, profile, scopeKind] of [
      ["setup", "genbi-setup", "bootstrap"],
      ["analysis", "genbi-default", "bound_project"],
      ["context_enrichment", "genbi-enrich-context", "bound_project"],
    ] as const) {
      const res = await app.request(`/api/harness?purpose=${purpose}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ purpose: { purpose, profile, scopeKind } });
    }
    expect(describeHarnessBundle.mock.calls.map(([purpose]) => purpose)).toEqual(["setup", "analysis", "context_enrichment"]);
  });

  it("does not let URL input select the BFF-owned descriptor source or bundle identity", async () => {
    const describeHarnessBundle = vi.fn<(purpose: keyof typeof NATIVE_DISPATCH_REGISTRY, options: Omit<RouteOptions, "question" | "onEvent">) => Promise<Bundle>>(async (purpose) => bundleForPurpose(purpose));
    const deps: TurnDeps = { store: new Store(":memory:"), route: noRoute(), baseRouteOptions: BASE_ROUTE_OPTIONS, describeHarnessBundle };
    const app = createApp(deps);

    const res = await app.request("/api/harness?purpose=analysis&profileSource=%2Fattacker%2Fprofile&profile=genbi-setup");
    expect(res.status).toBe(200);
    expect(describeHarnessBundle).toHaveBeenCalledWith("analysis", expect.objectContaining({ profileSource: "/fixture/profile" }));
    expect(await res.json()).toMatchObject({ purpose: { purpose: "analysis", profile: "genbi-default" }, profile: { id: "genbi-default" } });
  });

  it("fails closed for every purpose when the server-owned source produces a mismatched bundle", async () => {
    const wrongProfileForPurpose = {
      setup: "analysis",
      analysis: "setup",
      context_enrichment: "analysis",
    } as const;
    const describeHarnessBundle = vi.fn<(purpose: keyof typeof NATIVE_DISPATCH_REGISTRY) => Promise<Bundle>>(async (purpose) => bundleForPurpose(wrongProfileForPurpose[purpose]));
    const deps: TurnDeps = {
      store: new Store(":memory:"),
      route: noRoute(),
      baseRouteOptions: { ...BASE_ROUTE_OPTIONS, profileSource: "/configured/profiles/genbi-default" },
      describeHarnessBundle,
    };
    const app = createApp(deps);

    for (const purpose of ["setup", "analysis", "context_enrichment"] as const) {
      const res = await app.request(`/api/harness?purpose=${purpose}&profile=genbi-default`);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: HARNESS_PROFILE_IDENTITY_ERROR });
    }
    expect(describeHarnessBundle.mock.calls).toEqual([
      ["setup", expect.objectContaining({ profileSource: "/configured/profiles/genbi-default" })],
      ["analysis", expect.objectContaining({ profileSource: "/configured/profiles/genbi-default" })],
      ["context_enrichment", expect.objectContaining({ profileSource: "/configured/profiles/genbi-default" })],
    ]);
  });

  it("returns 500 without crashing when no describeBundle dependency is configured", async () => {
    const deps: TurnDeps = { store: new Store(":memory:"), route: noRoute(), baseRouteOptions: BASE_ROUTE_OPTIONS };
    const app = createApp(deps);

    const res = await app.request("/api/harness?purpose=analysis");
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("not configured") });
  });

  it("rejects missing, repeated, and unknown purpose values before describing a bundle", async () => {
    const describeHarnessBundle = vi.fn<(purpose: keyof typeof NATIVE_DISPATCH_REGISTRY) => Promise<Bundle>>(async (purpose) => bundleForPurpose(purpose));
    const deps: TurnDeps = { store: new Store(":memory:"), route: noRoute(), baseRouteOptions: BASE_ROUTE_OPTIONS, describeHarnessBundle };
    const app = createApp(deps);

    for (const path of ["/api/harness", "/api/harness?purpose=analysis&purpose=setup", "/api/harness?purpose=profile-override"]) {
      const res = await app.request(path);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining("harness purpose") });
    }
    expect(describeHarnessBundle).not.toHaveBeenCalled();
  });
});
