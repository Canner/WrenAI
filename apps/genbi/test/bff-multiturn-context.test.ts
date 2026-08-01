import { describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { Store } from "../server/db.js";
import type { TurnDeps } from "../server/turn.js";
import type { RouteOptions, RouteResult } from "../harness/index.js";

const BASE_ROUTE_OPTIONS: Omit<RouteOptions, "question" | "onEvent"> = {
  authChoice: { mode: "api-key", adapter: "mock" },
  profileSource: "/fixture/profile",
  userProject: "/fixture/project",
};

describe("D3 multi-turn context composition, end-to-end through the HTTP surface", () => {
  it("composes the second turn's question from the first turn's question + answer summary", async () => {
    const questionsSeen: string[] = [];
    const summaries = ["Revenue is $100", "Margin is 20%"];
    let call = 0;
    const route = async (options: RouteOptions): Promise<RouteResult> => {
      questionsSeen.push(options.question);
      const summary = summaries[call] ?? "ok";
      call += 1;
      return { backend: "agent", warnings: [], kind: "answer", envelope: { blocks: [], summary }, trace: { steps: [] } };
    };
    const deps: TurnDeps = { store: new Store(":memory:"), route, baseRouteOptions: BASE_ROUTE_OPTIONS };
    const app = createApp(deps);

    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };

    const turn1 = (await (
      await app.request(`/api/sessions/${session.id}/turns`, { method: "POST", body: JSON.stringify({ question: "What is total revenue?" }) })
    ).json()) as { turnId: string };
    await (await app.request(`/api/sessions/${session.id}/stream?turn=${turn1.turnId}`)).text();

    const turn2 = (await (
      await app.request(`/api/sessions/${session.id}/turns`, { method: "POST", body: JSON.stringify({ question: "What is the margin?" }) })
    ).json()) as { turnId: string };
    await (await app.request(`/api/sessions/${session.id}/stream?turn=${turn2.turnId}`)).text();

    expect(questionsSeen).toEqual([
      "What is total revenue?",
      "User: What is total revenue?\nAssistant: Revenue is $100\n\nWhat is the margin?",
    ]);
  });

  it("bounds composed context to the last 5 resolved turns", async () => {
    const questionsSeen: string[] = [];
    const route = async (options: RouteOptions): Promise<RouteResult> => {
      questionsSeen.push(options.question);
      return { backend: "agent", warnings: [], kind: "answer", envelope: { blocks: [], summary: "ok" }, trace: { steps: [] } };
    };
    const deps: TurnDeps = { store: new Store(":memory:"), route, baseRouteOptions: BASE_ROUTE_OPTIONS };
    const app = createApp(deps);
    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };

    for (let i = 0; i < 7; i += 1) {
      const turn = (await (
        await app.request(`/api/sessions/${session.id}/turns`, { method: "POST", body: JSON.stringify({ question: `q${i}` }) })
      ).json()) as { turnId: string };
      await (await app.request(`/api/sessions/${session.id}/stream?turn=${turn.turnId}`)).text();
    }

    const lastComposed = questionsSeen[questionsSeen.length - 1] ?? "";
    expect(lastComposed).not.toContain("q0");
    expect(lastComposed).toContain("q1");
    expect(lastComposed.endsWith("q6")).toBe(true);
    expect(lastComposed.split("\n\n")).toHaveLength(6); // 5 bounded prior turns + the final question
  });
});
