import { describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { Store } from "../server/db.js";
import type { TurnDeps } from "../server/turn.js";
import type { Bundle, RouteOptions, RouteResult } from "../harness/index.js";
import { parseSse } from "./bff-sse-helpers.js";

const BASE_ROUTE_OPTIONS: Omit<RouteOptions, "question" | "onEvent"> = {
  authChoice: { mode: "api-key", adapter: "mock" },
  profileSource: "/fixture/profile",
  userProject: "/fixture/project",
};

// Minimal but schema-shaped agents — enough for `bundle.agents.map(a => a.id)` and
// nothing else; these never actually run (route() is stubbed in every test below).
function minimalAgent(id: string): Bundle["agents"][number] {
  return {
    id,
    verb: id,
    component_type: "analytical",
    realization_kind: "skill",
    trigger: "one_shot",
    outcome: "none",
    steps: [],
    guardrails: {},
    tools: [],
    output_schema: { type: "object", properties: {}, required: [] },
    capabilities: [],
  };
}

const THREE_AGENT_BUNDLE: Bundle = {
  vercel_bundle_version: "0.1",
  compat: { min_ir_version: "0.4", max_ir_version: "0.4" },
  profile: "genbi-default",
  target: "vercel:headless",
  agents: [minimalAgent("answer_query"), minimalAgent("explain_change"), minimalAgent("generate_dashboard")],
};

function capturingRoute(receivedAgentIds: (string | undefined)[]): (options: RouteOptions) => Promise<RouteResult> {
  return async (options: RouteOptions): Promise<RouteResult> => {
    receivedAgentIds.push(options.agentId);
    return { backend: "agent", warnings: [], kind: "answer", envelope: { blocks: [], summary: "ok" }, trace: { steps: [] } };
  };
}

describe("intent routing, end-to-end through the BFF turn flow", () => {
  it("classifies a 'why did ...' question as explain_change, persists it on the turn, and passes it to route()", async () => {
    const receivedAgentIds: (string | undefined)[] = [];
    const store = new Store(":memory:");
    const deps: TurnDeps = {
      store,
      route: capturingRoute(receivedAgentIds),
      baseRouteOptions: BASE_ROUTE_OPTIONS,
      describeBundle: async () => THREE_AGENT_BUNDLE,
    };
    const app = createApp(deps);

    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };
    const turnRes = await app.request(`/api/sessions/${session.id}/turns`, {
      method: "POST",
      body: JSON.stringify({ question: "Why did revenue drop this quarter?" }),
    });
    const { turnId, clarify } = (await turnRes.json()) as { turnId: string; clarify?: unknown };
    expect(clarify).toBeUndefined(); // "why" alone must never trip the D1 comparative-clarify heuristic

    // Persisted on the turn row BEFORE route() is even invoked (postTurn classifies synchronously
    // relative to the HTTP response — the stream request below is a separate call).
    expect(store.getTurn(turnId)?.agentId).toBe("explain_change");

    const streamRes = await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`);
    expect(streamRes.status).toBe(200);
    await streamRes.text();

    expect(receivedAgentIds).toEqual(["explain_change"]);
    expect(store.getTurn(turnId)?.agentId).toBe("explain_change"); // unchanged by execution/resolution

    // Replay: re-streaming an already-resolved turn must NOT re-invoke route() (no new agentId
    // observed) — the persisted agent_id, not a fresh classification, is what made it deterministic.
    const replayFrames = parseSse(await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text());
    expect(replayFrames.map((f) => f.event)).toEqual(["worklog", "event", "done"]);
    expect(receivedAgentIds).toEqual(["explain_change"]); // still just the one real invocation
  });

  it("classifies a dashboard-shaped question as generate_dashboard", async () => {
    const receivedAgentIds: (string | undefined)[] = [];
    const deps: TurnDeps = {
      store: new Store(":memory:"),
      route: capturingRoute(receivedAgentIds),
      baseRouteOptions: BASE_ROUTE_OPTIONS,
      describeBundle: async () => THREE_AGENT_BUNDLE,
    };
    const app = createApp(deps);

    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };
    const turnRes = await app.request(`/api/sessions/${session.id}/turns`, {
      method: "POST",
      body: JSON.stringify({ question: "Show me a dashboard of revenue by region" }),
    });
    const { turnId } = (await turnRes.json()) as { turnId: string };

    await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text();
    expect(receivedAgentIds).toEqual(["generate_dashboard"]);
  });

  it("defaults to answer_query for a plain question, and when describeBundle is not configured", async () => {
    const receivedAgentIds: (string | undefined)[] = [];
    // No describeBundle dependency at all — intent routing must default gracefully, not crash the turn.
    const deps: TurnDeps = { store: new Store(":memory:"), route: capturingRoute(receivedAgentIds), baseRouteOptions: BASE_ROUTE_OPTIONS };
    const app = createApp(deps);

    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };
    const turnRes = await app.request(`/api/sessions/${session.id}/turns`, {
      method: "POST",
      body: JSON.stringify({ question: "What is total revenue?" }),
    });
    const { turnId } = (await turnRes.json()) as { turnId: string };

    await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text();
    expect(receivedAgentIds).toEqual(["answer_query"]);
  });

  it("falls back to answer_query when describeBundle throws", async () => {
    const receivedAgentIds: (string | undefined)[] = [];
    const deps: TurnDeps = {
      store: new Store(":memory:"),
      route: capturingRoute(receivedAgentIds),
      baseRouteOptions: BASE_ROUTE_OPTIONS,
      describeBundle: async () => {
        throw new Error("compile failed");
      },
    };
    const app = createApp(deps);

    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };
    const turnRes = await app.request(`/api/sessions/${session.id}/turns`, {
      method: "POST",
      body: JSON.stringify({ question: "Why did revenue drop?" }),
    });
    const { turnId } = (await turnRes.json()) as { turnId: string };

    await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text();
    expect(receivedAgentIds).toEqual(["answer_query"]); // explain_change isn't in the (empty) fallback agent list
  });

  it("recovers from a transient describeBundle failure instead of poisoning the cache for the rest of the process", async () => {
    // A rejected describeBundle() call must not be cached — the
    // next turn on the same TurnDeps should retry it, not be locked to answer_query forever.
    const receivedAgentIds: (string | undefined)[] = [];
    let shouldFail = true;
    const deps: TurnDeps = {
      store: new Store(":memory:"),
      route: capturingRoute(receivedAgentIds),
      baseRouteOptions: BASE_ROUTE_OPTIONS,
      describeBundle: async () => {
        if (shouldFail) throw new Error("transient compile-cache hiccup");
        return THREE_AGENT_BUNDLE;
      },
    };
    const app = createApp(deps);

    // First turn: describeBundle is failing — graceful fallback to answer_query.
    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };
    const firstTurnRes = await app.request(`/api/sessions/${session.id}/turns`, {
      method: "POST",
      body: JSON.stringify({ question: "Why did revenue drop?" }),
    });
    const { turnId: firstTurnId } = (await firstTurnRes.json()) as { turnId: string };
    await (await app.request(`/api/sessions/${session.id}/stream?turn=${firstTurnId}`)).text();
    expect(receivedAgentIds).toEqual(["answer_query"]);

    // describeBundle recovers.
    shouldFail = false;

    // Second turn, same deps/cache: should retry describeBundle and classify correctly —
    // proving the earlier rejection was NOT cached/poisoned.
    const secondTurnRes = await app.request(`/api/sessions/${session.id}/turns`, {
      method: "POST",
      body: JSON.stringify({ question: "Why did expenses spike?" }),
    });
    const { turnId: secondTurnId } = (await secondTurnRes.json()) as { turnId: string };
    await (await app.request(`/api/sessions/${session.id}/stream?turn=${secondTurnId}`)).text();
    expect(receivedAgentIds).toEqual(["answer_query", "explain_change"]);
  });
});
