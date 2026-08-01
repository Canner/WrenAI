import { describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { Store } from "../server/db.js";
import type { TurnDeps } from "../server/turn.js";
import type { HarnessDto } from "../server/wire-types.js";
import { loadBundle } from "../harness/index.js";
import type { Bundle, RouteOptions, RouteResult } from "../harness/index.js";
import { buildSyntheticBundle } from "./synthetic-bundle.js";

const BASE_ROUTE_OPTIONS: Omit<RouteOptions, "question" | "onEvent"> = {
  authChoice: { mode: "api-key", adapter: "mock" },
  profileSource: "/fixture/profile",
  userProject: "/fixture/project",
};

function noRoute(): (options: RouteOptions) => Promise<RouteResult> {
  return async () => {
    throw new Error("route() must never be invoked by GET /api/harness");
  };
}

describe("GET /api/harness", () => {
  it("compiles/describes the bundle via the injected dependency and returns the mapped HarnessDto", async () => {
    const bundle: Bundle = loadBundle(
      buildSyntheticBundle({
        guardrails: { some_gate: { enforcement: "gated_check", locked: true } },
      }),
    );
    const deps: TurnDeps = {
      store: new Store(":memory:"),
      route: noRoute(),
      baseRouteOptions: BASE_ROUTE_OPTIONS,
      describeBundle: async () => bundle,
    };
    const app = createApp(deps);

    const res = await app.request("/api/harness");
    expect(res.status).toBe(200);
    const dto = (await res.json()) as HarnessDto;

    expect(dto.profile).toMatchObject({ id: "synthetic-profile", verifyGate: true, bundleId: "synthetic-profile@vercel:headless", status: "Not bound yet" });
    expect(dto.runtime).toEqual({
      backend: "api-key",
      label: "API key (mock)",
      dispatcher: "in-process", // authChoice.mode "api-key" -> Mode A, in-process
      // synthetic bundle's only agent has a single step on tier "cheap"; runtime.tierModels
      // mirrors the store's seeded settings (the same source GET /api/config/runtime reports),
      // not the mock adapter's real (non-)binding — that's what dto.components reports instead.
      tierModels: [{ tier: "cheap", model: "claude-haiku" }],
    });
    expect(dto.connection.tablesSynced).toBe(3); // Store seeds 3 context models
    expect(dto.components).toHaveLength(1);
    expect(dto.components[0]).toMatchObject({ id: "synthetic_agent", name: "Synthetic Agent", callableAs: "do_thing", status: "ready" });
  });

  it("returns 500 with a JSON error (not a crash) when the compile/describe dependency throws", async () => {
    const deps: TurnDeps = {
      store: new Store(":memory:"),
      route: noRoute(),
      baseRouteOptions: BASE_ROUTE_OPTIONS,
      describeBundle: async () => {
        throw new Error("warble dispatch failed: boom");
      },
    };
    const app = createApp(deps);

    const res = await app.request("/api/harness");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "warble dispatch failed: boom" });
  });

  it("returns 500 without crashing when no describeBundle dependency is configured", async () => {
    const deps: TurnDeps = { store: new Store(":memory:"), route: noRoute(), baseRouteOptions: BASE_ROUTE_OPTIONS };
    const app = createApp(deps);

    const res = await app.request("/api/harness");
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("not configured") });
  });
});
