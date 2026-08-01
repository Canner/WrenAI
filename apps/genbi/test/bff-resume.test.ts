import { describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { Store } from "../server/db.js";
import type { TurnDeps } from "../server/turn.js";
import type { RouteOptions, RouteResult } from "../harness/index.js";
import { parseSse } from "./bff-sse-helpers.js";

const BASE_ROUTE_OPTIONS: Omit<RouteOptions, "question" | "onEvent"> = {
  authChoice: { mode: "api-key", adapter: "mock" },
  profileSource: "/fixture/profile",
  userProject: "/fixture/project",
};

describe("resuming/replaying an already-resolved turn never re-invokes route()", () => {
  it("replays identical worklog/answer/done frames for a resolved answer turn", async () => {
    let calls = 0;
    const route = async (): Promise<RouteResult> => {
      calls += 1;
      if (calls > 1) throw new Error("route must not be invoked twice for a resolved turn");
      return {
        backend: "agent",
        warnings: [],
        kind: "answer",
        envelope: { blocks: [{ type: "text", text: "42" }], summary: "42" },
        trace: { steps: [{ id: "s1", tool: "query", outcome: "success", ordinal: 0 }] },
      };
    };
    const deps: TurnDeps = { store: new Store(":memory:"), route, baseRouteOptions: BASE_ROUTE_OPTIONS };
    const app = createApp(deps);

    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };
    const turn = (await (
      await app.request(`/api/sessions/${session.id}/turns`, { method: "POST", body: JSON.stringify({ question: "What is total revenue?" }) })
    ).json()) as { turnId: string };

    const firstFrames = parseSse(await (await app.request(`/api/sessions/${session.id}/stream?turn=${turn.turnId}`)).text());
    expect(calls).toBe(1);

    const secondFrames = parseSse(await (await app.request(`/api/sessions/${session.id}/stream?turn=${turn.turnId}`)).text());
    expect(calls).toBe(1); // replay path must not call route() again

    expect(secondFrames).toEqual(firstFrames);
    expect(firstFrames.map((f) => f.event)).toEqual(["worklog", "event", "done"]);
  });

  it("replays ONLY the error frame (no trailing done) for a resolved error turn, and never re-invokes route()", async () => {
    let calls = 0;
    const route = async (): Promise<RouteResult> => {
      calls += 1;
      throw new Error(`boom (call #${calls})`);
    };
    const deps: TurnDeps = { store: new Store(":memory:"), route, baseRouteOptions: BASE_ROUTE_OPTIONS };
    const app = createApp(deps);

    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };
    const turn = (await (
      await app.request(`/api/sessions/${session.id}/turns`, { method: "POST", body: JSON.stringify({ question: "What is total revenue?" }) })
    ).json()) as { turnId: string };

    const firstFrames = parseSse(await (await app.request(`/api/sessions/${session.id}/stream?turn=${turn.turnId}`)).text());
    expect(calls).toBe(1);
    expect(firstFrames).toEqual([{ event: "error", data: { message: "boom (call #1)" } }]);

    const secondFrames = parseSse(await (await app.request(`/api/sessions/${session.id}/stream?turn=${turn.turnId}`)).text());
    expect(calls).toBe(1); // replay path must not call route() again
    expect(secondFrames).toEqual(firstFrames);
  });
});
