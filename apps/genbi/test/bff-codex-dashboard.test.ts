import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { Store } from "../server/db.js";
import type { ArtifactDto, AskSessionData, SseFrame, ToolStep } from "../server/wire-types.js";
import {
  route,
  type AgentEvent,
  type Bundle,
  type CodexAskExecutor,
  type RouteOptions,
} from "../harness/index.js";
import type { AgentEventInput } from "../harness/events/index.js";
import { streamTurn, type TurnDeps } from "../server/turn.js";
import { parseSse } from "./bff-sse-helpers.js";

const ARTIFACT_CAPABILITY: Bundle["agents"][number]["capabilities"][number] = {
  capability: "artifact_write",
  outcome: "realize-via",
  provided_by: "consumer-persisted-render-envelope",
  criticality: "required",
};

function agent(id: string, capabilities: Bundle["agents"][number]["capabilities"] = []): Bundle["agents"][number] {
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
    capabilities,
  };
}

const CODEX_BUNDLE: Bundle = {
  vercel_bundle_version: "0.1",
  compat: { min_ir_version: "0.4", max_ir_version: "0.4" },
  profile: "genbi-default",
  target: "codex:local",
  agents: [agent("answer_query"), agent("generate_dashboard", [ARTIFACT_CAPABILITY])],
};

const ENVELOPE = {
  blocks: [
    { type: "kpi_card", label: "Orders", value: 42, unit: "orders" },
    {
      type: "chart",
      chart_type: "bar",
      x: "order_id",
      series: ["amount"],
      rows: [{ order_id: 1, amount: 10 }],
    },
    { type: "table", columns: ["order_id", "amount"], rows: [{ order_id: 1, amount: 10 }] },
    {
      type: "definition",
      sql: "SELECT order_id, amount FROM orders",
      source_tables: ["orders"],
      filters: [],
    },
  ],
  summary: "Orders dashboard",
  verified: true,
};

function event(seq: number, value: AgentEventInput): AgentEvent {
  return { ...value, runId: "codex-dashboard", seq } as AgentEvent;
}

describe("Codex dashboard BFF integration", () => {
  let outDir = "";

  afterEach(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  it("routes to codex:local, streams attributed work, and persists one replay-safe artifact", async () => {
    const receivedAgentIds: string[] = [];
    let calls = 0;
    const codexAsk: CodexAskExecutor = async (options) => {
      calls += 1;
      receivedAgentIds.push(options.agentId ?? "");
      const events: AgentEvent[] = [
        event(0, { kind: "run.start", mode: "B", agentId: "generate_dashboard" }),
        event(1, { kind: "step.start", stepId: "plan_dashboard", name: "plan_dashboard", tier: "strong", parent: "parent", depth: 1 }),
        event(2, { kind: "tool.call", stepId: "plan_dashboard", callId: "context", tool: "wren.get_context", parent: "plan", depth: 2, status: "running" }),
        event(3, { kind: "tool.result", stepId: "plan_dashboard", callId: "context", tool: "wren.get_context", status: "success" }),
        event(4, { kind: "step.finish", stepId: "plan_dashboard", name: "plan_dashboard", status: "ok" }),
        event(5, { kind: "step.start", stepId: "compose_layout", name: "compose_layout", tier: "cheap", parent: "parent", depth: 1 }),
        event(6, { kind: "tool.call", stepId: "compose_layout", callId: "query", tool: "wren.run_sql", parent: "compose", depth: 2, status: "running" }),
        event(7, { kind: "tool.result", stepId: "compose_layout", callId: "query", tool: "wren.run_sql", status: "success" }),
        event(8, { kind: "step.finish", stepId: "compose_layout", name: "compose_layout", status: "ok" }),
        event(9, { kind: "answer", text: JSON.stringify(ENVELOPE) }),
        event(10, { kind: "run.finish", status: "answer" }),
      ];
      for (const item of events) options.onEvent?.(item);
      return { finalText: JSON.stringify(ENVELOPE) };
    };
    outDir = mkdtempSync(path.join(tmpdir(), "genbi-codex-dashboard-"));
    const baseRouteOptions: Omit<RouteOptions, "question" | "onEvent"> = {
      authChoice: { mode: "subscription", provider: "codex" },
      profileSource: "/fixture/profile",
      userProject: "/fixture/project",
      outDir,
      codexAsk,
    };
    const deps: TurnDeps = {
      store: new Store(":memory:"),
      route,
      baseRouteOptions,
      describeBundle: async () => CODEX_BUNDLE,
    };
    const app = createApp(deps);
    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };
    const { turnId } = (await (
      await app.request(`/api/sessions/${session.id}/turns`, {
        method: "POST",
        body: JSON.stringify({ question: "Build a dashboard of orders" }),
      })
    ).json()) as { turnId: string };

    const frames = parseSse(await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text());
    const worklog = frames.filter((frame) => frame.event === "worklog").at(-1)?.data as ToolStep[];
    expect(worklog.map((step) => [step.label, step.kind, step.depth])).toEqual([
      ["Route", "decision", undefined],
      ["plan_dashboard", "step", 1],
      ["wren.get_context", "tool", 2],
      ["compose_layout", "step", 1],
      ["wren.run_sql", "tool", 2],
    ]);
    expect(receivedAgentIds).toEqual(["generate_dashboard"]);
    const artifactFrames = frames.filter(
      (frame) => frame.event === "event" && (frame.data as { kind?: string }).kind === "artifact",
    );
    expect(artifactFrames).toHaveLength(1);
    const artifactId = (artifactFrames[0]!.data as { artifactId: string }).artifactId;
    const artifact = (await (await app.request(`/api/artifacts/${artifactId}`)).json()) as ArtifactDto;
    expect(artifact).toMatchObject({ artifactKind: "dashboard", verified: true });
    expect(JSON.parse(readFileSync(artifact.location!, "utf8"))).toEqual(ENVELOPE);
    expect(frames.find((frame) => frame.event === "event" && (frame.data as { kind?: string }).kind === "answer")?.data)
      .toMatchObject({ kind: "answer", answer: { form: "rich", envelope: ENVELOPE } });

    const replay = parseSse(await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text());
    expect(replay.filter((frame) => frame.event === "event" && (frame.data as { kind?: string }).kind === "artifact"))
      .toHaveLength(1);
    expect(calls).toBe(1);
  });

  it("keeps a degraded dashboard as text and does not fabricate an artifact", async () => {
    const codexAsk: CodexAskExecutor = async () => ({
      // The real Codex mapper converts `render_degraded` JSON into this
      // plain-text best effort before the BFF sees it.
      finalText: "Dashboard rendering degraded",
    });
    outDir = mkdtempSync(path.join(tmpdir(), "genbi-codex-dashboard-degraded-"));
    const deps: TurnDeps = {
      store: new Store(":memory:"),
      route,
      baseRouteOptions: {
        authChoice: { mode: "subscription", provider: "codex" },
        profileSource: "/fixture/profile",
        userProject: "/fixture/project",
        outDir,
        codexAsk,
      },
      describeBundle: async () => CODEX_BUNDLE,
    };
    const app = createApp(deps);
    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };
    const { turnId } = (await (
      await app.request(`/api/sessions/${session.id}/turns`, {
        method: "POST",
        body: JSON.stringify({ question: "Build a dashboard of orders" }),
      })
    ).json()) as { turnId: string };

    const frames = parseSse(await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text());
    expect(frames.find((frame) => frame.event === "event")?.data).toMatchObject({
      kind: "answer",
      answer: { form: "text", verified: false },
    });
    expect(frames.some((frame) => frame.event === "event" && (frame.data as { kind?: string }).kind === "artifact"))
      .toBe(false);
    expect(deps.store.listArtifacts()).toHaveLength(0);
  });

  it("routes follow-up dashboards independently and exposes both artifacts in the session API", async () => {
    const receivedAgentIds: string[] = [];
    const codexAsk: CodexAskExecutor = async (options) => {
      receivedAgentIds.push(options.agentId ?? "");
      return { finalText: JSON.stringify(ENVELOPE) };
    };
    outDir = mkdtempSync(path.join(tmpdir(), "genbi-codex-dashboard-follow-up-"));
    const deps: TurnDeps = {
      store: new Store(":memory:"),
      route,
      baseRouteOptions: {
        authChoice: { mode: "subscription", provider: "codex" },
        profileSource: "/fixture/profile",
        userProject: "/fixture/project",
        outDir,
        codexAsk,
      },
      describeBundle: async () => CODEX_BUNDLE,
    };
    const app = createApp(deps);
    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };

    for (const question of [
      "Build a dashboard of orders",
      "Update the dashboard with a monthly order breakdown",
    ]) {
      const { turnId } = (await (
        await app.request(`/api/sessions/${session.id}/turns`, {
          method: "POST",
          body: JSON.stringify({ question }),
        })
      ).json()) as { turnId: string };
      await (await app.request(`/api/sessions/${session.id}/stream?turn=${turnId}`)).text();
    }

    expect(receivedAgentIds).toEqual(["generate_dashboard", "generate_dashboard"]);
    const snapshot = (await (await app.request(`/api/sessions/${session.id}`)).json()) as AskSessionData;
    const artifactEvents = snapshot.events.filter((event) => event.kind === "artifact");
    expect(artifactEvents).toHaveLength(2);
    expect(new Set(artifactEvents.map((event) => event.artifactId)).size).toBe(2);
    for (const artifactEvent of artifactEvents) {
      const response = await app.request(`/api/artifacts/${artifactEvent.artifactId}`);
      expect(response.status).toBe(200);
      expect((await response.json()) as ArtifactDto).toMatchObject({
        sessionId: session.id,
        artifactKind: "dashboard",
        verified: true,
      });
    }
  });

  it("persists the resolved dashboard before a disconnect and replays without reinvocation", async () => {
    let calls = 0;
    const codexAsk: CodexAskExecutor = async () => {
      calls += 1;
      return { finalText: JSON.stringify(ENVELOPE) };
    };
    outDir = mkdtempSync(path.join(tmpdir(), "genbi-codex-dashboard-disconnect-"));
    const deps: TurnDeps = {
      store: new Store(":memory:"),
      route,
      baseRouteOptions: {
        authChoice: { mode: "subscription", provider: "codex" },
        profileSource: "/fixture/profile",
        userProject: "/fixture/project",
        outDir,
        codexAsk,
      },
      describeBundle: async () => CODEX_BUNDLE,
    };
    const app = createApp(deps);
    const session = (await (await app.request("/api/sessions", { method: "POST", body: "{}" })).json()) as { id: string };
    const { turnId } = (await (
      await app.request(`/api/sessions/${session.id}/turns`, {
        method: "POST",
        body: JSON.stringify({ question: "Build a dashboard of orders" }),
      })
    ).json()) as { turnId: string };

    await expect(streamTurn(deps, session.id, turnId, async (frame) => {
      if (frame.event === "event" && (frame.data as { kind?: string }).kind === "artifact") {
        throw new Error("simulated dashboard client disconnect");
      }
    })).rejects.toThrow(/client disconnect/);

    const replay: SseFrame[] = [];
    await streamTurn(deps, session.id, turnId, async (frame) => {
      replay.push(frame);
    });
    expect(replay.filter((frame) => frame.event === "event" && (frame.data as { kind?: string }).kind === "artifact"))
      .toHaveLength(1);
    expect(replay.some((frame) => frame.event === "event" && (frame.data as { kind?: string }).kind === "answer"))
      .toBe(true);
    expect(calls).toBe(1);
    expect(deps.store.listEventsForTurn(turnId).filter((event) => event.kind === "artifact")).toHaveLength(1);
  });
});
