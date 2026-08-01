import { tool, type ToolSet } from "ai";
import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult, LanguageModelV4Usage } from "@ai-sdk/provider";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { loadBundle } from "../harness/bundle/loader.js";
import {
  AgentScopeError,
  executeAgent,
  StepBudgetExhaustedError,
  type ExecuteAgentContext,
  type ToolCallOutcome,
} from "../harness/loop/index.js";
import { createDefaultProviderRegistry, MOCK_ADAPTER_ID } from "../harness/providers/index.js";
import type { TierBinding } from "../harness/providers/index.js";
import { readFixture } from "./fixtures.js";
import { buildSyntheticBundle } from "./synthetic-bundle.js";

// Captures every `settings` object handed to the real `ToolLoopAgent`
// constructor, across the whole test file — a wire-level tap, not a
// behavioral inference from what a mock model chooses to do. `vi.hoisted`
// is required because `vi.mock` factories are hoisted above imports and
// can't otherwise close over a module-scope array declared normally.
const toolLoopAgentSettings = vi.hoisted(() => [] as { readonly stopWhen?: unknown }[]);

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  // `any`-typed on purpose: this is a generic class with defaulted type
  // parameters (`ToolLoopAgent<CALL_OPTIONS = never, TOOLS = {}, ...>`), and
  // subclassing it while preserving those defaults exactly runs into
  // `exactOptionalPropertyTypes` friction that has nothing to do with what
  // this spy actually needs to assert (the shape of the runtime `settings`
  // object, not compile-time generic inference).
  const RealToolLoopAgent = actual.ToolLoopAgent as new (settings: unknown) => unknown;
  class SpyToolLoopAgent extends (RealToolLoopAgent as new (settings: unknown) => object) {
    constructor(settings: { readonly stopWhen?: unknown }) {
      toolLoopAgentSettings.push(settings);
      super(settings);
    }
  }
  return { ...actual, ToolLoopAgent: SpyToolLoopAgent };
});

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
    // `LanguageModelV4ToolCall.input` is a stringified JSON payload (parsed
    // against the tool's inputSchema by the loop), not the raw object.
    content: [{ type: "tool-call", toolCallId, toolName, input: JSON.stringify(input) }],
    finishReason: { unified: "tool-calls", raw: "tool-calls" },
    usage: EMPTY_USAGE,
    warnings: [],
  };
}

// `ToolLoopAgent` tags every request's `user-agent` header with
// "ai-sdk-agent/tool-loop"; a plain `generateText` call never does. Used
// below to assert *which* dispatch path the executor actually took.
function wentThroughToolLoop(call: LanguageModelV4CallOptions): boolean {
  const userAgent = call.headers?.["user-agent"];
  return typeof userAgent === "string" && userAgent.includes("ai-sdk-agent/tool-loop");
}

describe("executeAgent (loop executor)", () => {
  it("sequences answer_query's steps by dataflow (consumes/produces), threading query_intent into generate_sql", async () => {
    const bundle = loadBundle(readFixture("genbi-default.bundle.json"));
    const agent = bundle.agents.find((candidate) => candidate.id === "answer_query")!;

    const cheapCalls: LanguageModelV4CallOptions[] = [];
    const strongCalls: LanguageModelV4CallOptions[] = [];

    const registry = createDefaultProviderRegistry();
    const binding: TierBinding = {
      tiers: {
        cheap: {
          adapter: MOCK_ADAPTER_ID,
          config: {
            doGenerate: async (options: LanguageModelV4CallOptions) => {
              cheapCalls.push(options);
              return textResult("intent: top 5 customers by lifetime revenue, descending");
            },
          },
        },
        strong: {
          adapter: MOCK_ADAPTER_ID,
          config: {
            doGenerate: async (options: LanguageModelV4CallOptions) => {
              strongCalls.push(options);
              return textResult(JSON.stringify({ columns: ["customer"], rows: [["Acme"]] }));
            },
          },
        },
      },
    };

    const ctx: ExecuteAgentContext = {
      binding,
      registry,
      tools: {},
      userInput: "who are our top 5 customers by revenue?",
    };

    const artifacts = await executeAgent(agent, ctx);

    // Both steps ran (resolve_intent -> cheap, generate_sql -> strong).
    expect(cheapCalls).toHaveLength(1);
    expect(strongCalls).toHaveLength(1);

    // Ordering: generate_sql's step only becomes runnable once resolve_intent's
    // `query_intent` artifact exists, and its rendered prompt must carry the
    // value resolve_intent actually produced (not just a placeholder).
    expect(artifacts.get("query_intent")).toBe(
      "intent: top 5 customers by lifetime revenue, descending",
    );
    expect(JSON.stringify(strongCalls[0]!.prompt)).toContain(
      "intent: top 5 customers by lifetime revenue, descending",
    );

    // The dataflow target: generate_sql produces query_result.
    expect(artifacts.has("query_result")).toBe(true);
    expect(JSON.parse(artifacts.get("query_result") as string)).toEqual({
      columns: ["customer"],
      rows: [["Acme"]],
    });

    // repair_sql is a repair_fold step — recognized, but not executed (a not-yet-wired seam).
    expect(artifacts.has("repaired_result")).toBe(false);
  });

  it("runs a tools-bearing agent's step as a ToolLoopAgent turn that can call the injected tool", async () => {
    const bundle = loadBundle(
      buildSyntheticBundle({ tools: [{ name: "query", source: "mcp:sample/query" }] }),
    );
    const agent = bundle.agents[0]!;

    const calls: LanguageModelV4CallOptions[] = [];
    const results = [
      toolCallResult("query", "call-1", { sql: "select 1" }),
      textResult("done — result was 1 row"),
    ];
    let callIndex = 0;

    const registry = createDefaultProviderRegistry();
    const binding: TierBinding = {
      tiers: {
        cheap: {
          adapter: MOCK_ADAPTER_ID,
          config: {
            doGenerate: async (options: LanguageModelV4CallOptions) => {
              calls.push(options);
              const result = results[callIndex]!;
              callIndex += 1;
              return result;
            },
          },
        },
      },
    };

    let executedInput: unknown;
    const tools: ToolSet = {
      query: tool({
        description: "run a read-only query",
        inputSchema: z.object({ sql: z.string() }),
        execute: async (input) => {
          executedInput = input;
          return { columns: ["n"], rows: [[1]] };
        },
      }),
    };

    const artifacts = await executeAgent(agent, { binding, registry, tools, userInput: "irrelevant" });

    // Two model turns: the tool-call turn, then the finishing turn.
    expect(calls).toHaveLength(2);
    expect(calls.every(wentThroughToolLoop)).toBe(true);
    expect(executedInput).toEqual({ sql: "select 1" });
    expect(artifacts.get("result")).toBe("done — result was 1 row");
  });

  it("reports ToolCallOutcome.error (and input) when a tool call errors", async () => {
    const bundle = loadBundle(
      buildSyntheticBundle({ tools: [{ name: "query", source: "mcp:sample/query" }] }),
    );
    const agent = bundle.agents[0]!;

    const registry = createDefaultProviderRegistry();
    const binding: TierBinding = {
      tiers: {
        cheap: {
          adapter: MOCK_ADAPTER_ID,
          config: {
            doGenerate: (() => {
              const results = [
                toolCallResult("query", "call-1", { sql: "select * from bogus_table" }),
                textResult("done despite the error"),
              ];
              let index = 0;
              return async () => {
                const result = results[index]!;
                index += 1;
                return result;
              };
            })(),
          },
        },
      },
    };

    const tools: ToolSet = {
      query: tool({
        description: "run a read-only query",
        inputSchema: z.object({ sql: z.string() }),
        execute: async (): Promise<unknown> => {
          throw new Error("relation \"bogus_table\" does not exist");
        },
      }),
    };

    const outcomes: ToolCallOutcome[] = [];
    await executeAgent(agent, { binding, registry, tools, userInput: "irrelevant", onToolCallOutcome: (o) => outcomes.push(o) });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      tool: "query",
      outcome: "error",
      callId: "call-1",
      input: { sql: "select * from bogus_table" },
      error: expect.stringContaining("bogus_table"),
    });
  });

  it("runs a no-tools agent's step as a single generateText call, not a ToolLoopAgent turn", async () => {
    const bundle = loadBundle(buildSyntheticBundle());
    const agent = bundle.agents[0]!;
    expect(agent.tools).toHaveLength(0);

    const calls: LanguageModelV4CallOptions[] = [];
    const registry = createDefaultProviderRegistry();
    const binding: TierBinding = {
      tiers: {
        cheap: {
          adapter: MOCK_ADAPTER_ID,
          config: {
            doGenerate: async (options: LanguageModelV4CallOptions) => {
              calls.push(options);
              return textResult("synthetic answer");
            },
          },
        },
      },
    };

    const artifacts = await executeAgent(agent, {
      binding,
      registry,
      tools: {},
      userInput: "do the thing please",
    });

    expect(calls).toHaveLength(1);
    expect(wentThroughToolLoop(calls[0]!)).toBe(false);
    expect(artifacts.get("result")).toBe("synthetic answer");
    // The user's question is threaded through even for a `consumes: []` step.
    expect(JSON.stringify(calls[0]!.prompt)).toContain("do the thing please");
  });

  it("invokes the guard-eval hook seam for every runnable step, even though it is currently a no-op", async () => {
    const bundle = loadBundle(buildSyntheticBundle());
    const agent = bundle.agents[0]!;

    const registry = createDefaultProviderRegistry();
    const binding: TierBinding = {
      tiers: {
        cheap: { adapter: MOCK_ADAPTER_ID, config: { doGenerate: textResult("synthetic answer") } },
      },
    };

    const seenSteps: string[] = [];
    const artifacts = await executeAgent(agent, {
      binding,
      registry,
      tools: {},
      userInput: "irrelevant",
      evaluateGuard: (guardCtx) => {
        seenSteps.push(guardCtx.step.name);
        return true;
      },
    });

    expect(seenSteps).toEqual(["only_step"]);
    expect(artifacts.get("result")).toBe("synthetic answer");
  });

  it("loud-fails with AgentScopeError for an agent outside v1 scope (component_type)", async () => {
    const bundle = loadBundle(buildSyntheticBundle({ componentType: "mutating" }));
    const agent = bundle.agents[0]!;
    const registry = createDefaultProviderRegistry();
    const binding: TierBinding = { tiers: {} };

    await expect(executeAgent(agent, { binding, registry, tools: {}, userInput: "x" })).rejects.toThrow(
      AgentScopeError,
    );
    await expect(executeAgent(agent, { binding, registry, tools: {}, userInput: "x" })).rejects.toThrow(
      /mutating/,
    );
  });

  it("loud-fails with AgentScopeError for an agent outside v1 scope (trigger)", async () => {
    const bundle = loadBundle(buildSyntheticBundle({ trigger: "scheduled" }));
    const agent = bundle.agents[0]!;
    const registry = createDefaultProviderRegistry();
    const binding: TierBinding = { tiers: {} };

    await expect(executeAgent(agent, { binding, registry, tools: {}, userInput: "x" })).rejects.toThrow(
      AgentScopeError,
    );
  });

  it("loud-fails with AgentScopeError for an agent outside v1 scope (outcome)", async () => {
    const bundle = loadBundle(buildSyntheticBundle({ outcome: "mutation" }));
    const agent = bundle.agents[0]!;
    const registry = createDefaultProviderRegistry();
    const binding: TierBinding = { tiers: {} };

    await expect(executeAgent(agent, { binding, registry, tools: {}, userInput: "x" })).rejects.toThrow(
      AgentScopeError,
    );
  });
});

describe("executeAgent — ExecuteAgentContext.maxSteps threading (wire-level, not mock-model cooperation)", () => {
  beforeEach(() => {
    toolLoopAgentSettings.length = 0;
  });

  // A tools-bearing agent is required to reach the `ToolLoopAgent` branch at
  // all (see the "runs a no-tools agent's step as a single generateText
  // call" test above — a no-tools step never constructs one).
  function buildToolsBearingAgent() {
    const bundle = loadBundle(buildSyntheticBundle({ tools: [{ name: "query", source: "mcp:sample/query" }] }));
    return bundle.agents[0]!;
  }

  it("passes stopWhen: isStepCount(maxSteps) into the actual ToolLoopAgent constructor when ExecuteAgentContext.maxSteps is set", async () => {
    const agent = buildToolsBearingAgent();
    const registry = createDefaultProviderRegistry();
    const binding: TierBinding = {
      tiers: {
        cheap: { adapter: MOCK_ADAPTER_ID, config: { doGenerate: textResult("no tool call needed") } },
      },
    };
    const tools: ToolSet = {
      query: tool({ description: "run a read-only query", inputSchema: z.object({ sql: z.string() }), execute: async () => ({}) }),
    };

    await executeAgent(agent, { binding, registry, tools, userInput: "irrelevant", maxSteps: 7 });

    // This is the assertion that would fail if someone drops the `stopWhen`
    // wiring in `runToolLoopStep`/`runToolLoopStepWithRepair` again: it reads
    // the actual `settings` object handed to `ai`'s real `ToolLoopAgent`
    // class, not any behavior a cooperating mock model chose to produce.
    expect(toolLoopAgentSettings).toHaveLength(1);
    const stopWhen = toolLoopAgentSettings[0]!.stopWhen as
      | ((options: { steps: readonly unknown[] }) => boolean)
      | undefined;
    expect(stopWhen).toBeTypeOf("function");
    // `isStepCount(7)`'s own contract (`ai`'s `isStepCount`, unmocked here —
    // only `ToolLoopAgent` itself is spied on): true at exactly 7 completed
    // steps, false at 6. Checking the predicate's behavior, not its identity,
    // is what actually pins "maxSteps reached ToolLoopAgent as a step-count
    // stop condition" without coupling to `isStepCount`'s internals.
    expect(stopWhen!({ steps: new Array(7) })).toBe(true);
    expect(stopWhen!({ steps: new Array(6) })).toBe(false);
  });

  it("omits stopWhen entirely when ExecuteAgentContext.maxSteps is unset — preserves ToolLoopAgent's own default for the Ask path", async () => {
    const agent = buildToolsBearingAgent();
    const registry = createDefaultProviderRegistry();
    const binding: TierBinding = {
      tiers: {
        cheap: { adapter: MOCK_ADAPTER_ID, config: { doGenerate: textResult("no tool call needed") } },
      },
    };
    const tools: ToolSet = {
      query: tool({ description: "run a read-only query", inputSchema: z.object({ sql: z.string() }), execute: async () => ({}) }),
    };

    // No `maxSteps` field at all — exactly the shape `runAgent`'s call site
    // (`harness/session/run.ts`) builds today, and the only shape it will
    // ever build unless a future change deliberately opts it in.
    await executeAgent(agent, { binding, registry, tools, userInput: "irrelevant" });

    expect(toolLoopAgentSettings).toHaveLength(1);
    expect(toolLoopAgentSettings[0]!.stopWhen).toBeUndefined();
  });

  it("throws StepBudgetExhaustedError (not a silent partial-text return) when the tool loop is still mid-tool-calls at the step budget", async () => {
    const agent = buildToolsBearingAgent();
    const registry = createDefaultProviderRegistry();
    // A model that always calls the tool again, never finishing on its own —
    // the only way `ToolLoopAgent`'s stop condition, rather than a natural
    // "stop" finish, is what ends the turn.
    const binding: TierBinding = {
      tiers: {
        cheap: {
          adapter: MOCK_ADAPTER_ID,
          config: {
            doGenerate: async () => toolCallResult("query", `call-${Math.random()}`, { sql: "select 1" }),
          },
        },
      },
    };
    const tools: ToolSet = {
      query: tool({
        description: "run a read-only query",
        inputSchema: z.object({ sql: z.string() }),
        execute: async () => ({ columns: ["n"], rows: [[1]] }),
      }),
    };

    const error = await executeAgent(agent, { binding, registry, tools, userInput: "irrelevant", maxSteps: 2 }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(StepBudgetExhaustedError);
    expect((error as StepBudgetExhaustedError).maxSteps).toBe(2);
    expect((error as StepBudgetExhaustedError).stepId).toBe("only_step");
  });
});
