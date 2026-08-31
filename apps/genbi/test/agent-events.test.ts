import { tool, type ToolSet } from "ai";
import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult, LanguageModelV4Usage } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loadBundle } from "../harness/bundle/loader.js";
import { createDefaultCapabilityRegistry } from "../harness/capability/registry.js";
import {
  MalformedSseFrameError,
  parseAgentEvent,
  serializeAgentEvent,
} from "../harness/events/index.js";
import type { AgentEvent, AgentEventInput, StepTrace, TokenEvent } from "../harness/events/index.js";
import { executeAgent } from "../harness/loop/index.js";
import type { ExecuteAgentContext } from "../harness/loop/index.js";
import { createDefaultProviderRegistry, MOCK_ADAPTER_ID } from "../harness/providers/index.js";
import type { TierBinding } from "../harness/providers/index.js";
import { runDispatchedDefault } from "../harness/route/index.js";
import { runAgent } from "../harness/session/index.js";
import type { RunAgentContext } from "../harness/session/index.js";
import { WRITE_ARTIFACT_TOOL_NAME } from "../harness/tools/index.js";
import { readFixture } from "./fixtures.js";
import { mockWrenServerConfig } from "./mock-mcp-server.js";
import { buildSyntheticBundle } from "./synthetic-bundle.js";

const EMPTY_USAGE: LanguageModelV4Usage = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
};

function textResult(text: string): LanguageModelV4GenerateResult {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: EMPTY_USAGE,
    warnings: [],
  };
}

function toolCallResult(toolName: string, toolCallId: string, input: unknown): LanguageModelV4GenerateResult {
  return {
    content: [{ type: "tool-call", toolCallId, toolName, input: JSON.stringify(input) }],
    finishReason: { unified: "tool-calls", raw: "tool-calls" },
    usage: EMPTY_USAGE,
    warnings: [],
  };
}

function scriptedTurns(turns: readonly LanguageModelV4GenerateResult[]) {
  let index = 0;
  return async (): Promise<LanguageModelV4GenerateResult> => {
    const result = turns[index]!;
    index += 1;
    return result;
  };
}

/**
 * Same two-tier (`cheap`/`strong`) scripting `test/run-agent.test.ts` uses
 * for the golden `answer_query` shape, duplicated here (rather than shared)
 * since these tests need direct access to raw `AgentEvent`s, not just the
 * `RunAgentResult`.
 */
function buildAnswerQueryBinding(strongTurns: readonly LanguageModelV4GenerateResult[]): TierBinding {
  return {
    tiers: {
      cheap: {
        adapter: MOCK_ADAPTER_ID,
        config: { doGenerate: async () => textResult("intent: top customer by revenue") },
      },
      strong: { adapter: MOCK_ADAPTER_ID, config: { doGenerate: scriptedTurns(strongTurns) } },
    },
  };
}

function buildRunAgentContext(binding: TierBinding, onEvent?: (event: AgentEvent) => void): RunAgentContext {
  return {
    binding,
    registry: createDefaultProviderRegistry(),
    capabilityRegistry: createDefaultCapabilityRegistry(),
    mcpServers: { sample: mockWrenServerConfig() },
    ...(onEvent !== undefined ? { onEvent } : {}),
  };
}

// The flat table shape `generate_sql`'s finishing text is contractually
// supposed to produce, already carrying `verified`/`summary` — the
// deterministic direct-render fast path (`renderEnvelope`'s
// `tryDirectEnvelope`) picks this up straight off the dataflow artifact, so
// no separate render-LLM call happens after it.
const VERIFIED_QUERY_RESULT_TEXT = JSON.stringify({
  columns: ["customer", "revenue"],
  rows: [["Acme", 1000]],
  summary: "Acme is the top customer by revenue.",
  verified: true,
});
const UNVERIFIED_QUERY_RESULT_TEXT = JSON.stringify({
  columns: ["customer", "revenue"],
  rows: [["Acme", 1000]],
  summary: "Not fully confirmed.",
  verified: false,
});

describe("executeAgent: step.*/tool.*/artifact events", () => {
  it("emits step.start then step.finish(status: ok) around a no-tools single-generate step", async () => {
    const bundle = loadBundle(buildSyntheticBundle());
    const agent = bundle.agents[0]!;

    const registry = createDefaultProviderRegistry();
    const binding: TierBinding = {
      tiers: { cheap: { adapter: MOCK_ADAPTER_ID, config: { doGenerate: async () => textResult("synthetic answer") } } },
    };

    const events: AgentEventInput[] = [];
    const ctx: ExecuteAgentContext = {
      binding,
      registry,
      tools: {},
      userInput: "irrelevant",
      onEvent: (e) => events.push(e),
    };

    await executeAgent(agent, ctx);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ kind: "step.start", stepId: "only_step", name: "only_step", tier: "cheap", depth: 0 });
    // step.finish now carries the step's own reasoning/output as `detail`.
    expect(events[1]).toMatchObject({ kind: "step.finish", stepId: "only_step", name: "only_step", status: "ok", detail: "synthetic answer" });
  });

  it("emits step.finish(status: error) and still rethrows when a step's model call throws", async () => {
    const bundle = loadBundle(buildSyntheticBundle());
    const agent = bundle.agents[0]!;

    const registry = createDefaultProviderRegistry();
    const binding: TierBinding = {
      tiers: {
        cheap: {
          adapter: MOCK_ADAPTER_ID,
          config: {
            doGenerate: async () => {
              throw new Error("model unavailable");
            },
          },
        },
      },
    };

    const events: AgentEventInput[] = [];
    const ctx: ExecuteAgentContext = { binding, registry, tools: {}, userInput: "x", onEvent: (e) => events.push(e) };

    await expect(executeAgent(agent, ctx)).rejects.toThrow(/model unavailable/);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ kind: "step.start", stepId: "only_step" });
    // An error step.finish still carries the best available detail (the error message).
    expect(events[1]).toMatchObject({ kind: "step.finish", stepId: "only_step", status: "error", detail: "model unavailable" });
  });

  it("emits tool.call, tool.result(success), and an artifact event for a successful write_artifact call", async () => {
    const bundle = loadBundle(
      buildSyntheticBundle({ tools: [{ name: WRITE_ARTIFACT_TOOL_NAME, source: "native:write_artifact" }] }),
    );
    const agent = bundle.agents[0]!;

    const tools: ToolSet = {
      [WRITE_ARTIFACT_TOOL_NAME]: tool({
        description: "write an artifact",
        inputSchema: z.object({ path: z.string(), content: z.string() }),
        execute: async (input) => ({ written: true, path: input.path, bytes: input.content.length }),
      }),
    };

    const registry = createDefaultProviderRegistry();
    const binding: TierBinding = {
      tiers: {
        cheap: {
          adapter: MOCK_ADAPTER_ID,
          config: {
            doGenerate: scriptedTurns([
              toolCallResult(WRITE_ARTIFACT_TOOL_NAME, "call-1", { path: "dashboard.json", content: "{}" }),
              textResult("wrote the dashboard"),
            ]),
          },
        },
      },
    };

    const events: AgentEventInput[] = [];
    const ctx: ExecuteAgentContext = { binding, registry, tools, userInput: "make me a dashboard", onEvent: (e) => events.push(e) };

    await executeAgent(agent, ctx);

    const toolCallEvent = events.find((e) => e.kind === "tool.call");
    const toolResultEvent = events.find((e) => e.kind === "tool.result");
    const artifactEvent = events.find((e) => e.kind === "artifact");

    expect(toolCallEvent).toMatchObject({
      kind: "tool.call",
      stepId: "only_step",
      callId: "call-1",
      tool: WRITE_ARTIFACT_TOOL_NAME,
      depth: 0,
      status: "running",
    });
    expect(toolResultEvent).toMatchObject({
      kind: "tool.result",
      stepId: "only_step",
      callId: "call-1",
      tool: WRITE_ARTIFACT_TOOL_NAME,
      status: "success",
    });
    expect(artifactEvent).toMatchObject({ kind: "artifact", name: "dashboard.json", location: "dashboard.json" });
  });

  it("emits tool.result(status: error) with a derived error message when a tool's execute throws", async () => {
    const bundle = loadBundle(buildSyntheticBundle({ tools: [{ name: "query", source: "mcp:sample/query" }] }));
    const agent = bundle.agents[0]!;

    const tools: ToolSet = {
      query: tool({
        description: "run a query",
        inputSchema: z.object({ sql: z.string() }),
        execute: async (input): Promise<unknown> => {
          void input;
          throw new Error("query backend unavailable");
        },
      }),
    };

    const registry = createDefaultProviderRegistry();
    const binding: TierBinding = {
      tiers: {
        cheap: {
          adapter: MOCK_ADAPTER_ID,
          config: {
            doGenerate: scriptedTurns([
              toolCallResult("query", "call-1", { sql: "select 1" }),
              textResult("done despite the error"),
            ]),
          },
        },
      },
    };

    const events: AgentEventInput[] = [];
    const ctx: ExecuteAgentContext = { binding, registry, tools, userInput: "irrelevant", onEvent: (e) => events.push(e) };

    await executeAgent(agent, ctx);

    const toolResultEvent = events.find((e) => e.kind === "tool.result");
    expect(toolResultEvent).toMatchObject({
      kind: "tool.result",
      callId: "call-1",
      tool: "query",
      status: "error",
      error: expect.stringContaining("query backend unavailable"),
    });
  });
});

describe("runAgent: run.start/answer/refusal/run.finish/error events, runId+seq bookkeeping", () => {
  it("emits a fully-stamped run.start -> ... -> answer -> run.finish(status: answer) sequence on the happy path", async () => {
    const bundle = loadBundle(readFixture("genbi-default.bundle.json"));
    const binding = buildAnswerQueryBinding([
      toolCallResult("query", "call-1", { sql: "select * from customers" }),
      textResult(VERIFIED_QUERY_RESULT_TEXT),
    ]);

    const events: AgentEvent[] = [];
    const result = await runAgent(
      bundle,
      "answer_query",
      "who is our top customer?",
      buildRunAgentContext(binding, (e) => events.push(e)),
    );

    expect(result.kind).toBe("answer");

    const kinds = events.map((e) => e.kind);
    expect(kinds[0]).toBe("run.start");
    expect(kinds).toEqual(expect.arrayContaining(["step.start", "step.finish", "tool.call", "tool.result", "answer", "run.finish"]));
    expect(kinds[kinds.length - 2]).toBe("answer");
    expect(kinds[kinds.length - 1]).toBe("run.finish");

    // Every event shares one runId, and seq is 1-based and strictly increasing.
    const runId = events[0]!.runId;
    events.forEach((event, i) => {
      expect(event.runId).toBe(runId);
      expect(event.seq).toBe(i + 1);
    });

    expect(events[0]).toMatchObject({ kind: "run.start", mode: "A", agentId: "answer_query" });
    const answerEvent = events.find((e) => e.kind === "answer");
    expect(answerEvent).toMatchObject({ kind: "answer", envelope: { verified: true } });
    expect(events[events.length - 1]).toMatchObject({ kind: "run.finish", status: "answer" });
  });

  it("emits answer (not refusal) when a real successful data-access call earns verified:true, even though the render output self-attests verified: false", async () => {
    // Pre-existing behavior trusted the render output's own "verified"
    // self-attestation and refused here. The fix intentionally changes this:
    // a locked gated_check guardrail on a data-access-requiring agent is
    // satisfied by a real successful `query` tool call, regardless of what
    // the render output separately claims about "verified" (see the matching
    // test in test/run-agent.test.ts for the full rationale).
    const bundle = loadBundle(readFixture("genbi-default.bundle.json"));
    const binding = buildAnswerQueryBinding([
      toolCallResult("query", "call-1", { sql: "select * from customers" }),
      textResult(UNVERIFIED_QUERY_RESULT_TEXT),
    ]);

    const events: AgentEvent[] = [];
    const result = await runAgent(
      bundle,
      "answer_query",
      "who is our top customer?",
      buildRunAgentContext(binding, (e) => events.push(e)),
    );

    expect(result.kind).toBe("answer");
    const answerEvent = events.find((e) => e.kind === "answer");
    expect(answerEvent).toMatchObject({ kind: "answer", envelope: { verified: true } });
    expect(events[events.length - 1]).toMatchObject({ kind: "run.finish", status: "answer" });
  });

  it("emits error + run.finish(status: error) and still rethrows when the rendered envelope fails output_schema validation", async () => {
    const bundle = loadBundle(readFixture("genbi-default.bundle.json"));
    const malformedEnvelopeJson = JSON.stringify({ summary: "no blocks here", verified: true });
    // Not a flat table shape (no JSON at all), so the direct fast path skips
    // it and the render-LLM path actually runs, hitting the malformed JSON
    // below.
    const binding = buildAnswerQueryBinding([
      toolCallResult("query", "call-1", { sql: "select * from customers" }),
      textResult("executed the query and got a row back, haven't structured it yet"),
      textResult(malformedEnvelopeJson),
    ]);

    const events: AgentEvent[] = [];
    await expect(
      runAgent(bundle, "answer_query", "who is our top customer?", buildRunAgentContext(binding, (e) => events.push(e))),
    ).rejects.toThrow();

    expect(events[0]).toMatchObject({ kind: "run.start", mode: "A" });
    const errorEvent = events.find((e) => e.kind === "error");
    expect(errorEvent).toBeDefined();
    expect(typeof (errorEvent as { message: string }).message).toBe("string");
    expect(events[events.length - 1]).toMatchObject({ kind: "run.finish", status: "error" });
  });
});

describe("runAgent: FLOOR StepTrace", () => {
  it("accumulates a populated StepTrace from tool call outcomes, independent of whether onEvent is set", async () => {
    const bundle = loadBundle(readFixture("genbi-default.bundle.json"));
    const binding = buildAnswerQueryBinding([
      toolCallResult("query", "call-1", { sql: "select * from customers" }),
      textResult(VERIFIED_QUERY_RESULT_TEXT),
    ]);

    // No onEvent at all — the FLOOR trace must still populate.
    const result = await runAgent(bundle, "answer_query", "who is our top customer?", buildRunAgentContext(binding));

    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") throw new Error("expected an answer result");

    const trace = result.trace as StepTrace;
    expect(trace.steps).toHaveLength(1);
    // TraceStep now also carries `input` (the tool call's input)
    // and a compact `detail` (success summary) — asserted narrowly here since
    // `detail`'s exact truncated text is an implementation detail of
    // `summarizeToolOutput`.
    expect(trace.steps[0]).toMatchObject({ id: "call-1", tool: "query", outcome: "success", ordinal: 0, input: { sql: "select * from customers" } });
    expect(typeof trace.steps[0]!.detail).toBe("string");
  });

  it("a SQL-repair retry's TraceSteps carry input + a compact detail — the error step shows the failing SQL and why it failed, the success step shows the retried SQL and a compact result summary", async () => {
    const bundle = loadBundle(readFixture("genbi-default.bundle.json"));
    const finalText = JSON.stringify({
      columns: ["customer", "revenue"],
      rows: [["Acme", 1000]],
      verified: true,
      definition: { sql: "select * from customers", source_tables: ["customers"], filters: [] },
    });
    // Turn 1: generate_sql calls `query` with bad SQL (server-side failure,
    // via mockWrenServerConfig's failQueryCount:1). Turn 2 (folded-in repair
    // turn): calls `query` again with corrected SQL (succeeds). Turn 3: the
    // finishing turn.
    const binding = buildAnswerQueryBinding([
      toolCallResult("query", "call-1", { sql: "select * from bogus_table" }),
      toolCallResult("query", "call-2", { sql: "select * from customers" }),
      textResult(finalText),
    ]);

    const ctx: RunAgentContext = {
      binding,
      registry: createDefaultProviderRegistry(),
      capabilityRegistry: createDefaultCapabilityRegistry(),
      mcpServers: { sample: mockWrenServerConfig({ failQueryCount: 1 }) },
    };

    const result = await runAgent(bundle, "answer_query", "who is our top customer?", ctx);
    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") throw new Error("expected an answer result");

    const trace = result.trace as StepTrace;
    expect(trace.steps).toHaveLength(2);

    const [errorStep, successStep] = trace.steps;
    expect(errorStep).toMatchObject({ tool: "query", outcome: "error", input: { sql: "select * from bogus_table" } });
    expect(typeof errorStep!.detail).toBe("string");
    expect(errorStep!.detail!.length).toBeLessThan(500); // bounded/compact — never a full result dump

    expect(successStep).toMatchObject({ tool: "query", outcome: "success", input: { sql: "select * from customers" } });
    expect(typeof successStep!.detail).toBe("string");
    // `summarizeToolOutput` truncates to 200 chars + an ellipsis character.
    expect(successStep!.detail!.length).toBeLessThanOrEqual(201);
  });
});

describe("mode-parity: in-process vs dispatched emit the same shape for the kinds both can drive hermetically", () => {
  it("run.start/run.finish/error share the same field set across modes, differing only in mode/status/content", async () => {
    const bundle = loadBundle(readFixture("genbi-default.bundle.json"));
    const binding = buildAnswerQueryBinding([
      toolCallResult("query", "call-1", { sql: "select * from customers" }),
      textResult(VERIFIED_QUERY_RESULT_TEXT),
    ]);

    const inProcessEvents: AgentEvent[] = [];
    await runAgent(bundle, "answer_query", "who is our top customer?", buildRunAgentContext(binding, (e) => inProcessEvents.push(e)));

    // Dispatched has no mock adapter seam — it shells a real CLI, so its *success*
    // path can't be driven hermetically here (same limitation documented in
    // test/parity-contract.test.ts). Its error path, though, still exercises
    // the identical run.start -> error -> run.finish sequence through the
    // same createAgentEventEmitter seam in-process uses, via a nonexistent
    // profileSource that fails fast inside compileProfile's first line
    // (hashDirectory) — see harness/compile/pipeline.ts.
    const dispatchedEvents: AgentEvent[] = [];
    await expect(
      runDispatchedDefault({
        authChoice: { mode: "subscription", provider: "claude" },
        profileSource: "/nonexistent/profile",
        userProject: "/nonexistent/project",
        question: "who is our top customer?",
        deployment: "personal",
        onEvent: (e) => dispatchedEvents.push(e),
      }),
    ).rejects.toThrow();

    const inProcessRunStart = inProcessEvents.find((e) => e.kind === "run.start")!;
    const dispatchedRunStart = dispatchedEvents.find((e) => e.kind === "run.start")!;
    expect(Object.keys(inProcessRunStart).sort()).toEqual(Object.keys(dispatchedRunStart).sort());
    expect(inProcessRunStart).toMatchObject({ kind: "run.start", mode: "A" });
    expect(dispatchedRunStart).toMatchObject({ kind: "run.start", mode: "B" });

    const inProcessRunFinish = inProcessEvents[inProcessEvents.length - 1]!;
    const dispatchedRunFinish = dispatchedEvents[dispatchedEvents.length - 1]!;
    expect(inProcessRunFinish.kind).toBe("run.finish");
    expect(dispatchedRunFinish.kind).toBe("run.finish");
    expect(Object.keys(inProcessRunFinish).sort()).toEqual(Object.keys(dispatchedRunFinish).sort());

    const dispatchedError = dispatchedEvents.find((e) => e.kind === "error")!;
    expect(dispatchedError).toMatchObject({ kind: "error" });
    expect(typeof (dispatchedError as { message: string }).message).toBe("string");

    // Documented gap, not a parity violation: dispatched is a single-shot
    // subprocess shell-out with no live visibility into its own internals —
    // it never emits step.*/tool.*/artifact granularity (see
    // harness/route/dispatched.ts's doc comment).
    expect(dispatchedEvents.some((e) => e.kind === "step.start" || e.kind === "tool.call" || e.kind === "artifact")).toBe(false);
  });
});

describe("serializeAgentEvent / parseAgentEvent (SSE wire format round-trip)", () => {
  it("round-trips a representative event through serialize -> parse without loss", () => {
    const sample: AgentEvent = {
      kind: "tool.call",
      runId: "run-1",
      seq: 3,
      stepId: "generate_sql",
      callId: "call-1",
      tool: "query",
      input: { sql: "select 1" },
      depth: 0,
      status: "running",
    };

    const frame = serializeAgentEvent(sample);
    expect(frame).toMatch(/^event: tool\.call\n/);
    expect(frame.endsWith("\n\n")).toBe(true);
    expect(parseAgentEvent(frame)).toEqual(sample);
  });

  it("round-trips one representative event per AgentEventKind, including the type-only, currently-unemitted `token` kind", () => {
    const events: AgentEvent[] = [
      { kind: "run.start", runId: "r", seq: 1, mode: "A", agentId: "answer_query" },
      { kind: "step.start", runId: "r", seq: 2, stepId: "s1", name: "s1", tier: "cheap", depth: 0 },
      { kind: "step.finish", runId: "r", seq: 3, stepId: "s1", name: "s1", status: "ok" },
      { kind: "tool.call", runId: "r", seq: 4, stepId: "s1", callId: "c1", tool: "query", depth: 0, status: "running" },
      { kind: "tool.result", runId: "r", seq: 5, stepId: "s1", callId: "c1", tool: "query", status: "success" },
      // `token` is defined in the contract's union but neither in-process
      // (non-streaming generateText/ToolLoopAgent turns) nor dispatched (reads
      // only the dispatcher's final stdout) emits it in production today —
      // a documented, type-only gap. Exercised here purely for SSE
      // round-trip coverage.
      { kind: "token", runId: "r", seq: 6, text: "partial" } as TokenEvent,
      { kind: "answer", runId: "r", seq: 7, text: "done" },
      { kind: "refusal", runId: "r", seq: 8, reason: "nope" },
      { kind: "artifact", runId: "r", seq: 9, name: "dash.json", artifactKind: "dashboard", location: "dash.json" },
      { kind: "run.finish", runId: "r", seq: 10, status: "answer" },
      { kind: "error", runId: "r", seq: 11, message: "boom" },
    ];

    for (const event of events) {
      expect(parseAgentEvent(serializeAgentEvent(event))).toEqual(event);
    }
  });

  it("throws MalformedSseFrameError when the event: or data: line is missing", () => {
    expect(() => parseAgentEvent("data: {}\n\n")).toThrow(MalformedSseFrameError);
    expect(() => parseAgentEvent("event: answer\n\n")).toThrow(MalformedSseFrameError);
  });

  it("throws MalformedSseFrameError on invalid JSON in the data: line", () => {
    expect(() => parseAgentEvent("event: answer\ndata: not-json\n\n")).toThrow(MalformedSseFrameError);
  });

  it("throws MalformedSseFrameError when the data payload has no kind field", () => {
    expect(() => parseAgentEvent('event: answer\ndata: {"foo":"bar"}\n\n')).toThrow(MalformedSseFrameError);
  });

  it("throws MalformedSseFrameError when the event: line's kind and data.kind disagree", () => {
    expect(() =>
      parseAgentEvent('event: answer\ndata: {"kind":"error","runId":"r","seq":1,"message":"x"}\n\n'),
    ).toThrow(MalformedSseFrameError);
  });
});
