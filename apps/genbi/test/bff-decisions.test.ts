import { describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { Store } from "../server/db.js";
import type { TurnDeps } from "../server/turn.js";
import type { AgentEvent, Bundle, RouteOptions, RouteResult } from "../harness/index.js";
import type { ToolStep } from "../server/wire-types.js";
import { parseSse } from "./bff-sse-helpers.js";

const BASE_ROUTE_OPTIONS: Omit<RouteOptions, "question" | "onEvent"> = {
  authChoice: { mode: "api-key", adapter: "mock" },
  profileSource: "/fixture/profile",
  userProject: "/fixture/project",
};

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

function makeApp(route: (options: RouteOptions) => Promise<RouteResult>) {
  const store = new Store(":memory:");
  const deps: TurnDeps = { store, route, baseRouteOptions: BASE_ROUTE_OPTIONS, describeBundle: async () => THREE_AGENT_BUNDLE };
  return { app: createApp(deps), store };
}

async function workLogAfterStream(app: ReturnType<typeof createApp>, sessionId: string, turnId: string): Promise<ToolStep[]> {
  await (await app.request(`/api/sessions/${sessionId}/stream?turn=${turnId}`)).text();
  const data = (await (await app.request(`/api/sessions/${sessionId}`)).json()) as { workLog: ToolStep[] };
  return data.workLog;
}

describe("control-flow decisions as work-log entries", () => {
  it("a verified answer turn leads with a Route decision (→ routed agent + reason) and ends with a Verify-gate verdict", async () => {
    const { app } = makeApp(async () => ({
      backend: "agent",
      warnings: [],
      kind: "answer",
      envelope: { blocks: [{ type: "text", text: "Here it is." }], summary: "ok", verified: true },
      trace: { steps: [{ id: "s1", tool: "query", outcome: "success", ordinal: 0 }] },
    }));
    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };
    const { turnId } = (await (
      await app.request(`/api/sessions/${session.id}/turns`, { method: "POST", body: JSON.stringify({ question: "Show me a dashboard of revenue by region" }) })
    ).json()) as { turnId: string };

    const workLog = await workLogAfterStream(app, session.id, turnId);

    const first = workLog[0];
    expect(first?.kind).toBe("decision");
    expect(first?.label).toBe("Route");
    expect(first?.detail).toBe("→ generate_dashboard: dashboard intent (dashboard)");

    const last = workLog[workLog.length - 1];
    expect(last).toEqual({ id: "decision-gate", label: "Verify gate", state: "done", kind: "decision", detail: "verified — grounded in a successful data-access" });

    // A proceeding (non-clarify) turn must carry NO Clarify decision entry.
    expect(workLog.some((s) => s.label === "Clarify")).toBe(false);
    // The agent's own step sits between the two decisions.
    expect(workLog.map((s) => s.kind)).toEqual(["decision", "tool", "decision"]);
  });

  it("a non-verified answer omits the Verify-gate entry (Route only)", async () => {
    const { app } = makeApp(async () => ({
      backend: "agent",
      warnings: [],
      kind: "answer",
      envelope: { blocks: [], summary: "ok" }, // no `verified: true`
      trace: { steps: [] },
    }));
    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };
    const { turnId } = (await (
      await app.request(`/api/sessions/${session.id}/turns`, { method: "POST", body: JSON.stringify({ question: "What is total revenue?" }) })
    ).json()) as { turnId: string };

    const workLog = await workLogAfterStream(app, session.id, turnId);
    expect(workLog.some((s) => s.label === "Verify gate")).toBe(false);
    expect(workLog[0]?.label).toBe("Route");
    expect(workLog[0]?.detail).toBe("→ answer_query: default → answer_query");
  });

  it("a refusal turn's Verify-gate entry is state \"error\" carrying the refusal reason", async () => {
    const { app } = makeApp(async () => ({
      backend: "agent",
      warnings: [],
      kind: "refusal",
      reason: "Access to the PII column is restricted.",
      envelope: { blocks: [], verified: false },
      trace: { steps: [] },
    }));
    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };
    const { turnId } = (await (
      await app.request(`/api/sessions/${session.id}/turns`, { method: "POST", body: JSON.stringify({ question: "List every customer's SSN" }) })
    ).json()) as { turnId: string };

    const workLog = await workLogAfterStream(app, session.id, turnId);
    const last = workLog[workLog.length - 1];
    expect(last).toEqual({ id: "decision-gate", label: "Verify gate", state: "error", kind: "decision", detail: "Access to the PII column is restricted." });
    expect(workLog[0]?.label).toBe("Route");
  });

  it("a clarify turn's work log has a Clarify decision (after Route) and NO Verify-gate entry", async () => {
    // route() is never invoked for a clarify turn — a throwing stub proves it.
    const { app, store } = makeApp(async () => {
      throw new Error("route() must not run for a clarify turn");
    });
    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };
    const posted = (await (
      await app.request(`/api/sessions/${session.id}/turns`, { method: "POST", body: JSON.stringify({ question: "Which product sells better?" }) })
    ).json()) as { turnId: string; clarify?: { prompt: string } };
    expect(posted.clarify?.prompt).toBe("Which time range should I use?");

    // Persisted worklog round-trips via GET /api/sessions/:id (no stream needed — it short-circuited).
    const data = (await (await app.request(`/api/sessions/${session.id}`)).json()) as { workLog: ToolStep[] };
    expect(data.workLog).toEqual([
      { id: "decision-route", label: "Route", state: "done", kind: "decision", detail: "→ answer_query: default → answer_query" },
      { id: "decision-clarify", label: "Clarify", state: "done", kind: "decision", detail: "Which time range should I use?" },
    ]);
    expect(data.workLog.some((s) => s.label === "Verify gate")).toBe(false);
    // trace_json was persisted directly at postTurn time.
    expect(store.getTurn(posted.turnId)?.resultKind).toBe("clarify");
  });

  it("resume (re-stream + GET session) round-trips the decision entries for a resolved turn", async () => {
    const { app } = makeApp(async () => ({
      backend: "agent",
      warnings: [],
      kind: "answer",
      envelope: { blocks: [], summary: "ok", verified: true },
      trace: { steps: [] },
    }));
    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };
    const { turnId } = (await (
      await app.request(`/api/sessions/${session.id}/turns`, { method: "POST", body: JSON.stringify({ question: "Why did revenue drop?" }) })
    ).json()) as { turnId: string };

    await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text();

    // Replay the resolved turn — the persisted worklog frame carries both decisions.
    const replay = parseSse(await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text());
    const worklogFrame = replay.find((f) => f.event === "worklog")?.data as ToolStep[];
    expect(worklogFrame[0]).toEqual({ id: "decision-route", label: "Route", state: "done", kind: "decision", detail: "→ explain_change: explanation intent (why)" });
    expect(worklogFrame[worklogFrame.length - 1]?.label).toBe("Verify gate");

    // And GET /api/sessions/:id returns the same decisions.
    const data = (await (await app.request(`/api/sessions/${session.id}`)).json()) as { workLog: ToolStep[] };
    expect(data.workLog.map((s) => s.label)).toEqual(["Route", "Verify gate"]);
  });

  it("a failed turn persists the PARTIAL work log (Route + captured steps + failure gate), not an empty one", async () => {
    // Fire some live steps, then throw — mirrors an agent run that got partway
    // (SQL error) before failing. liveLog.snapshot() must survive into the
    // persisted trace so GET /api/sessions/:id shows the decision trail + steps.
    const route = async (options: RouteOptions): Promise<RouteResult> => {
      let seq = 0;
      const emit = (event: Record<string, unknown>): void => {
        options.onEvent?.({ ...event, runId: "run-1", seq: (seq += 1) } as AgentEvent);
      };
      emit({ kind: "step.start", stepId: "generate_sql", name: "generate_sql", tier: "strong", depth: 0 });
      emit({ kind: "tool.call", stepId: "generate_sql", callId: "call-1", tool: "query", depth: 0, status: "running" });
      emit({ kind: "tool.result", stepId: "generate_sql", callId: "call-1", tool: "query", status: "error", error: "relation \"orders\" does not exist" });
      throw new Error("agent run failed after SQL error");
    };
    const { app } = makeApp(route);
    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };
    const { turnId } = (await (
      await app.request(`/api/sessions/${session.id}/turns`, { method: "POST", body: JSON.stringify({ question: "Why did revenue drop?" }) })
    ).json()) as { turnId: string };

    const frames = parseSse(await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text());
    // The failed stream terminates with the error frame and never a trailing done
    // (the catch block emits ONLY the error frame — the earlier worklog frames are
    // live progress that arrived BEFORE the throw, not part of the error path).
    expect(frames[frames.length - 1]).toEqual({ event: "error", data: { message: "agent run failed after SQL error" } });
    expect(frames.some((f) => f.event === "done")).toBe(false);

    // The win: GET /api/sessions/:id shows the partial trace, not an empty log.
    const data = (await (await app.request(`/api/sessions/${session.id}`)).json()) as { workLog: ToolStep[] };
    expect(data.workLog.length).toBeGreaterThan(1);
    expect(data.workLog[0]).toEqual({ id: "decision-route", label: "Route", state: "done", kind: "decision", detail: "→ explain_change: explanation intent (why)" });
    // The step/tool rows captured before the throw are preserved.
    expect(data.workLog.some((s) => s.label === "query" && s.state === "error")).toBe(true);
    expect(data.workLog.some((s) => s.label === "generate_sql")).toBe(true);
    // ...and it ends with the failure Verify-gate entry carrying the error.
    expect(data.workLog[data.workLog.length - 1]).toEqual({
      id: "decision-gate",
      label: "Verify gate",
      state: "error",
      kind: "decision",
      detail: "agent run failed after SQL error",
    });
  });
});
