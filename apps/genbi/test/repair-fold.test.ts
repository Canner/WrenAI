import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult, LanguageModelV4Usage } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { loadBundle } from "../harness/bundle/loader.js";
import { executeAgent, InvalidRepairFoldError, RepairExhaustedError } from "../harness/loop/index.js";
import type { ExecuteAgentContext } from "../harness/loop/index.js";
import { createDefaultProviderRegistry, MOCK_ADAPTER_ID } from "../harness/providers/index.js";
import type { TierBinding } from "../harness/providers/index.js";
import { resolveTools } from "../harness/tools/index.js";
import { mockWrenServerConfig } from "./mock-mcp-server.js";
import { readFixture } from "./fixtures.js";
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

/** Builds the strong-tier mock model turns: a `query` tool call, repeated per attempt, then a final text answer. */
function scriptStrongTurns(attempts: number, finalText: string) {
  const results: LanguageModelV4GenerateResult[] = [];
  for (let i = 0; i < attempts; i += 1) {
    results.push(toolCallResult("query", `call-${i + 1}`, { sql: "select * from customers" }));
  }
  results.push(textResult(finalText));
  return results;
}

function buildBinding(
  cheapText: string,
  strongResults: LanguageModelV4GenerateResult[],
): { binding: TierBinding; strongCalls: LanguageModelV4CallOptions[] } {
  const strongCalls: LanguageModelV4CallOptions[] = [];
  let strongIndex = 0;

  const binding: TierBinding = {
    tiers: {
      cheap: {
        adapter: MOCK_ADAPTER_ID,
        config: { doGenerate: async () => textResult(cheapText) },
      },
      strong: {
        adapter: MOCK_ADAPTER_ID,
        config: {
          doGenerate: async (options: LanguageModelV4CallOptions) => {
            strongCalls.push(options);
            const result = strongResults[strongIndex] ?? strongResults[strongResults.length - 1]!;
            strongIndex += 1;
            return result;
          },
        },
      },
    },
  };

  return { binding, strongCalls };
}

describe("executeAgent repair_fold", () => {
  it("recovers after exactly one repair attempt when the tool fails once then succeeds", async () => {
    const bundle = loadBundle(readFixture("genbi-default.bundle.json"));
    const agent = bundle.agents.find((candidate) => candidate.id === "answer_query")!;

    const resolved = await resolveTools(agent, {
      mcpServers: { sample: mockWrenServerConfig({ failQueryCount: 1 }) },
    });
    try {
      // Turn 1: generate_sql calls `query` (fails server-side once).
      // Turn 2 (the repair turn, folded in via prepareStep): calls `query` again (succeeds).
      // Turn 3: finishing turn with the recovered, verified JSON payload.
      const finalText = JSON.stringify({
        columns: ["customer", "revenue"],
        rows: [["Acme", 1000]],
        verified: true,
        definition: { sql: "select * from customers", source_tables: ["customers"], filters: [] },
      });
      const { binding, strongCalls } = buildBinding(
        "intent: top customer by revenue",
        scriptStrongTurns(2, finalText),
      );

      const ctx: ExecuteAgentContext = {
        binding,
        registry: createDefaultProviderRegistry(),
        tools: resolved.tools,
        userInput: "who is our top customer?",
      };

      const artifacts = await executeAgent(agent, ctx);

      // Exactly 3 strong-tier turns: the failing tool call, the folded-in
      // repair retry, and the finishing turn — no more (max_attempts: 1).
      expect(strongCalls).toHaveLength(3);

      // The repair turn's instructions were swapped to repair_sql's prompt.
      const repairTurnCall = strongCalls[1]!;
      expect(JSON.stringify(repairTurnCall.prompt)).toContain("Repair step");

      // generate_sql still produces query_result, and repair_sql's
      // repaired_result now appears too (a repair actually happened).
      expect(artifacts.get("query_result")).toBe(finalText);
      expect(artifacts.get("repaired_result")).toBe(finalText);
    } finally {
      await resolved.close();
    }
  });

  it("loud-fails with RepairExhaustedError when the tool keeps failing past max_attempts", async () => {
    const bundle = loadBundle(readFixture("genbi-default.bundle.json"));
    const agent = bundle.agents.find((candidate) => candidate.id === "answer_query")!;

    const resolved = await resolveTools(agent, {
      // Fails every call the test's script issues (well past max_attempts: 1).
      mcpServers: { sample: mockWrenServerConfig({ failQueryCount: 10 }) },
    });
    try {
      const { binding } = buildBinding(
        "intent: top customer by revenue",
        // Two tool-call turns is enough: attempt 1 (original) fails, the
        // folded-in repair retry (attempt 2, the only one allowed) also
        // fails, so the third prepareStep call must throw before a third
        // model turn is ever requested.
        scriptStrongTurns(2, "unreachable"),
      );

      const ctx: ExecuteAgentContext = {
        binding,
        registry: createDefaultProviderRegistry(),
        tools: resolved.tools,
        userInput: "who is our top customer?",
      };

      // A single run only — the mock model's script is stateful (indexed by
      // call count), so invoking executeAgent twice against it would corrupt
      // the script on the second call rather than exercising a fresh repair
      // cycle. Inspect the one rejection for both the error class and message.
      let caught: unknown;
      try {
        await executeAgent(agent, ctx);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(RepairExhaustedError);
      expect((caught as Error).message).toMatch(/generate_sql/);
    } finally {
      await resolved.close();
    }
  });

  it("loud-fails with InvalidRepairFoldError when a repair_fold's when-guard doesn't match its fold_into target", async () => {
    const malformed = buildSyntheticBundle({ tools: [{ name: "query", source: "mcp:sample/query" }] }) as {
      agents: Array<{ steps: unknown[] }>;
    };
    malformed.agents[0]!.steps.push({
      name: "bad_repair",
      tier: "cheap",
      consumes: ["result"],
      produces: "repaired",
      prompt: "repair",
      when: { guard: "on_failure", target: "some_other_step" },
      realization: { kind: "repair_fold", fold_into: "only_step", max_attempts: 1 },
    });
    const bundle = loadBundle(malformed);
    const agent = bundle.agents[0]!;

    const registry = createDefaultProviderRegistry();
    const binding: TierBinding = {
      tiers: { cheap: { adapter: MOCK_ADAPTER_ID, config: { doGenerate: async () => textResult("x") } } },
    };

    await expect(
      executeAgent(agent, { binding, registry, tools: {}, userInput: "x" }),
    ).rejects.toThrow(InvalidRepairFoldError);
  });
});
