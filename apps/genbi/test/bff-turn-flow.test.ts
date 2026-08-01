import { describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { Store } from "../server/db.js";
import type { TurnDeps } from "../server/turn.js";
import type { AgentEvent, RouteOptions, RouteResult } from "../harness/index.js";
import { parseSse } from "./bff-sse-helpers.js";

const BASE_ROUTE_OPTIONS: Omit<RouteOptions, "question" | "onEvent"> = {
  authChoice: { mode: "api-key", adapter: "mock" },
  profileSource: "/fixture/profile",
  userProject: "/fixture/project",
};

function richAnswerRoute(): (options: RouteOptions) => Promise<RouteResult> {
  return async (): Promise<RouteResult> => ({
    backend: "agent",
    warnings: [],
    kind: "answer",
    envelope: { blocks: [{ type: "text", text: "Total revenue is $42." }], summary: "Total revenue is $42." },
    trace: { steps: [{ id: "step-1", tool: "query", outcome: "success", ordinal: 0 }] },
  });
}

describe("BFF turn flow (POST turn -> GET SSE stream -> GET session)", () => {
  it("executes a Mode A turn end-to-end and persists it for later retrieval", async () => {
    const deps: TurnDeps = { store: new Store(":memory:"), route: richAnswerRoute(), baseRouteOptions: BASE_ROUTE_OPTIONS };
    const app = createApp(deps);

    const createRes = await app.request("/api/sessions", { method: "POST", body: JSON.stringify({ title: "Revenue" }) });
    expect(createRes.status).toBe(201);
    const session = (await createRes.json()) as { id: string };

    const turnRes = await app.request(`/api/sessions/${session.id}/turns`, {
      method: "POST",
      body: JSON.stringify({ question: "What is total revenue?" }),
    });
    expect(turnRes.status).toBe(200);
    const { turnId, clarify } = (await turnRes.json()) as { turnId: string; clarify?: unknown };
    expect(clarify).toBeUndefined();

    const streamRes = await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`);
    expect(streamRes.status).toBe(200);
    const frames = parseSse(await streamRes.text());

    // The Route decision leads the (single) worklog frame — prepended
    // to the agent's steps. The plain question routes to answer_query by default;
    // the verified-answer gate is omitted here because this envelope carries no
    // `verified: true`.
    const routeStep = { id: "decision-route", label: "Route", state: "done", kind: "decision", detail: "→ answer_query: default → answer_query" };
    expect(frames.map((f) => f.event)).toEqual(["worklog", "event", "done"]);
    expect(frames[0]?.data).toEqual([routeStep, { id: "step-1", label: "query", state: "done", kind: "tool" }]);
    expect(frames[1]?.data).toMatchObject({ kind: "answer", answer: { form: "rich" } });
    expect(frames[2]?.data).toEqual({});

    const sessionData = (await (await app.request(`/api/sessions/${session.id}`)).json()) as {
      events: { kind: string }[];
      workLog: { id: string }[];
    };
    expect(sessionData.events.map((e) => e.kind)).toEqual(["user", "answer"]);
    expect(sessionData.workLog).toEqual([routeStep, { id: "step-1", label: "query", state: "done", kind: "tool" }]);
  });

  it("the finalized worklog includes the LLM step row (kind \"step\", with its own detail), not just tool calls", async () => {
    // Simulates what runAgent's real onEvent firings look like for a Mode A
    // turn: a step.start/step.finish bracketing one tool.call/tool.result —
    // the live worklog this produces is richer than the floor trace (which
    // only ever carries tool outcomes), so it must win at finalization.
    const route = async (options: RouteOptions): Promise<RouteResult> => {
      let seq = 0;
      const emit = (event: Record<string, unknown>): void => {
        options.onEvent?.({ ...event, runId: "run-1", seq: (seq += 1) } as AgentEvent);
      };
      emit({ kind: "step.start", stepId: "generate_sql", name: "generate_sql", tier: "strong", depth: 0 });
      emit({ kind: "tool.call", stepId: "generate_sql", callId: "call-1", tool: "query", depth: 0, status: "running" });
      emit({ kind: "tool.result", stepId: "generate_sql", callId: "call-1", tool: "query", status: "success", summary: "3 rows" });
      emit({ kind: "step.finish", stepId: "generate_sql", name: "generate_sql", status: "ok", detail: "Top customer by revenue is Acme." });

      return {
        backend: "agent",
        warnings: [],
        kind: "answer",
        envelope: { blocks: [{ type: "text", text: "Acme is the top customer." }], summary: "Acme is the top customer." },
        // The floor trace only ever has tool-outcome rows — no step rows —
        // so if finalization fell back to foldTrace(trace) here, the LLM
        // step's reasoning would be silently dropped.
        trace: { steps: [{ id: "call-1", tool: "query", outcome: "success", ordinal: 0 }] },
      };
    };
    const deps: TurnDeps = { store: new Store(":memory:"), route, baseRouteOptions: BASE_ROUTE_OPTIONS };
    const app = createApp(deps);

    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };
    const { turnId } = (await (
      await app.request(`/api/sessions/${session.id}/turns`, { method: "POST", body: JSON.stringify({ question: "Who is our top customer?" }) })
    ).json()) as { turnId: string };

    const frames = parseSse(await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text());
    // Multiple "worklog" frames stream as the live events arrive — the LAST
    // one (right before the terminal answer/done frames) is the finalized,
    // fully-accumulated work log this test cares about.
    const worklogFrames = frames.filter((f) => f.event === "worklog");
    const worklog = worklogFrames[worklogFrames.length - 1]?.data as { id: string; kind: string; detail?: string }[];

    // The Route decision leads the finalized worklog (prepended); the
    // envelope has no `verified: true`, so no trailing Verify-gate entry.
    const routeStep = { id: "decision-route", label: "Route", state: "done", kind: "decision", detail: "→ answer_query: default → answer_query" };
    expect(worklog).toEqual([
      routeStep,
      { id: "generate_sql", label: "generate_sql", state: "done", kind: "step", depth: 0, detail: "Top customer by revenue is Acme." },
      { id: "call-1", label: "query", state: "done", kind: "tool", depth: 0, detail: "3 rows" },
    ]);

    // Persisted for resume (GET session) too — trace_json round-trips whatever ToolStep[] was picked.
    const sessionData = (await (await app.request(`/api/sessions/${session.id}`)).json()) as { workLog: { kind: string }[] };
    expect(sessionData.workLog.map((s) => s.kind)).toEqual(["decision", "step", "tool"]);
  });

  it("returns 404 for an unknown session on every session-scoped route", async () => {
    const deps: TurnDeps = { store: new Store(":memory:"), route: richAnswerRoute(), baseRouteOptions: BASE_ROUTE_OPTIONS };
    const app = createApp(deps);

    expect((await app.request("/api/sessions/nope")).status).toBe(404);
    expect((await (await app.request("/api/sessions/nope/turns", { method: "POST", body: JSON.stringify({ question: "hi" }) })).json())).toMatchObject({
      error: expect.stringContaining("nope"),
    });
    expect((await app.request("/api/sessions/nope/stream?turn=also-nope")).status).toBe(404);
  });

  it("404s when the stream's turn query param is missing or doesn't belong to the session", async () => {
    const deps: TurnDeps = { store: new Store(":memory:"), route: richAnswerRoute(), baseRouteOptions: BASE_ROUTE_OPTIONS };
    const app = createApp(deps);
    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };

    // Missing required `turn` param -> 400; a well-formed but unknown turn -> 404.
    expect((await app.request(`/api/sessions/${session.id}/stream`)).status).toBe(400);
    expect((await app.request(`/api/sessions/${session.id}/stream?turn=not-a-real-turn`)).status).toBe(404);
  });
});

describe("D1 clarify flow, end-to-end through the HTTP surface", () => {
  it("short-circuits an ambiguous comparative with a clarify prompt, then resolves normally once the follow-up answers it", async () => {
    let receivedQuestion: string | undefined;
    const route = async (options: RouteOptions): Promise<RouteResult> => {
      receivedQuestion = options.question;
      return { backend: "agent", warnings: [], kind: "answer", envelope: { blocks: [], summary: "Product B sold better." }, trace: { steps: [] } };
    };
    const deps: TurnDeps = { store: new Store(":memory:"), route, baseRouteOptions: BASE_ROUTE_OPTIONS };
    const app = createApp(deps);
    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };

    const clarifyTurnRes = await app.request(`/api/sessions/${session.id}/turns`, {
      method: "POST",
      body: JSON.stringify({ question: "Which product sells better?" }),
    });
    const clarifyTurn = (await clarifyTurnRes.json()) as { turnId: string; clarify?: { prompt: string; chips: string[] } };
    expect(clarifyTurn.clarify?.prompt).toBe("Which time range should I use?");

    const clarifyFrames = parseSse(await (await app.request(`/api/sessions/${session.id}/stream?turn=${clarifyTurn.turnId}`)).text());
    expect(clarifyFrames.map((f) => f.event)).toEqual(["event", "done"]);
    expect(clarifyFrames[0]?.data).toMatchObject({ kind: "clarify", prompt: "Which time range should I use?" });
    expect(receivedQuestion).toBeUndefined(); // route() must never be invoked for a clarify-only turn

    const followUpRes = await app.request(`/api/sessions/${session.id}/turns`, { method: "POST", body: JSON.stringify({ question: "this quarter" }) });
    const followUpTurn = (await followUpRes.json()) as { turnId: string; clarify?: unknown };
    expect(followUpTurn.clarify).toBeUndefined();

    await (await app.request(`/api/sessions/${session.id}/stream?turn=${followUpTurn.turnId}`)).text();
    expect(receivedQuestion).toBe("Which product sells better? (this quarter)");
  });

  it("keeps the ORIGINAL pending question when a follow-up itself re-triggers clarify, then still resolves correctly once a concrete follow-up arrives", async () => {
    let receivedQuestion: string | undefined;
    const route = async (options: RouteOptions): Promise<RouteResult> => {
      receivedQuestion = options.question;
      return { backend: "agent", warnings: [], kind: "answer", envelope: { blocks: [], summary: "Product B sold better." }, trace: { steps: [] } };
    };
    const store = new Store(":memory:");
    const deps: TurnDeps = { store, route, baseRouteOptions: BASE_ROUTE_OPTIONS };
    const app = createApp(deps);
    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };

    // First ambiguous question -> enters awaiting_clarify with pending_question = original question.
    const firstClarifyRes = await app.request(`/api/sessions/${session.id}/turns`, {
      method: "POST",
      body: JSON.stringify({ question: "Which product sells better?" }),
    });
    const firstClarify = (await firstClarifyRes.json()) as { turnId: string; clarify?: { prompt: string } };
    expect(firstClarify.clarify?.prompt).toBe("Which time range should I use?");
    expect(store.getSession(session.id)?.pendingQuestion).toBe("Which product sells better?");

    // Follow-up is ITSELF ambiguous (matches the clarify heuristic again) -> re-clarifies.
    // Pre-fix, this would overwrite pending_question with "which vs better?", losing the original.
    const reClarifyRes = await app.request(`/api/sessions/${session.id}/turns`, {
      method: "POST",
      body: JSON.stringify({ question: "which vs better?" }),
    });
    const reClarify = (await reClarifyRes.json()) as { turnId: string; clarify?: { prompt: string } };
    expect(reClarify.clarify?.prompt).toBe("Which time range should I use?");

    // The bug reproduction: pending_question must STILL be the original question, not the follow-up.
    expect(store.getSession(session.id)?.status).toBe("awaiting_clarify");
    expect(store.getSession(session.id)?.pendingQuestion).toBe("Which product sells better?");

    // Happy path still works: a concrete follow-up resolves the ORIGINAL pending question and runs the turn.
    const followUpRes = await app.request(`/api/sessions/${session.id}/turns`, { method: "POST", body: JSON.stringify({ question: "this quarter" }) });
    const followUpTurn = (await followUpRes.json()) as { turnId: string; clarify?: unknown };
    expect(followUpTurn.clarify).toBeUndefined();

    await (await app.request(`/api/sessions/${session.id}/stream?turn=${followUpTurn.turnId}`)).text();
    expect(receivedQuestion).toBe("Which product sells better? (this quarter)");
    expect(store.getSession(session.id)?.status).toBe("active");
    expect(store.getSession(session.id)?.pendingQuestion).toBeNull();
  });
});
