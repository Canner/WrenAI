import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult, LanguageModelV4Usage } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { loadBundle } from "../harness/bundle/loader.js";
import { MOCK_ADAPTER_ID } from "../harness/providers/index.js";
import { buildHybridTierBinding } from "../harness/route/index.js";
import { filterTierBindingForAgent } from "../harness/route/mode-a.js";
import { route } from "../harness/route/index.js";
import type { AuthChoice } from "../harness/auth/index.js";
import { mockWrenServerConfig } from "./mock-mcp-server.js";
import { readFixture } from "./fixtures.js";

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

/** Scripts a sequence of turns for one tier's mock adapter, tracking every call it received. */
function scriptedTurns(turns: LanguageModelV4GenerateResult[]) {
  const calls: LanguageModelV4CallOptions[] = [];
  let index = 0;
  const doGenerate = async (options: LanguageModelV4CallOptions) => {
    calls.push(options);
    const result = turns[index]!;
    index += 1;
    return result;
  };
  return { calls, doGenerate };
}

describe("buildHybridTierBinding", () => {
  const bundle = loadBundle(readFixture("genbi-default.bundle.json"));
  const answerQuery = bundle.agents.find((agent) => agent.id === "answer_query")!;

  it("builds a TierBinding as-is when every agent tier is bound exactly once", () => {
    const tiers = {
      cheap: { adapter: MOCK_ADAPTER_ID, config: {} },
      strong: { adapter: MOCK_ADAPTER_ID, config: {} },
    };

    expect(buildHybridTierBinding(answerQuery, tiers)).toEqual({ tiers });
  });

  it("loud-fails naming the missing tier(s) when a tier the agent uses has no entry", () => {
    expect(() => buildHybridTierBinding(answerQuery, { cheap: { adapter: MOCK_ADAPTER_ID, config: {} } })).toThrow(
      /missing an adapter for tier\(s\): strong/,
    );
  });

  it("loud-fails naming the unknown tier(s) when an entry names a tier the agent doesn't use", () => {
    const tiers = {
      cheap: { adapter: MOCK_ADAPTER_ID, config: {} },
      strong: { adapter: MOCK_ADAPTER_ID, config: {} },
      nonexistent: { adapter: MOCK_ADAPTER_ID, config: {} },
    };

    expect(() => buildHybridTierBinding(answerQuery, tiers)).toThrow(/unknown tier\(s\).*nonexistent/);
  });

  it("projects a bundle-wide binding onto the selected agent before strict validation", () => {
    const selected = { id: "cheap-only", steps: [{ tier: "cheap" }] };
    const fullBundleBinding = {
      cheap: { adapter: MOCK_ADAPTER_ID, config: {} },
      strong: { adapter: MOCK_ADAPTER_ID, config: {} }, // used by another component
    };
    const projected = filterTierBindingForAgent(selected, fullBundleBinding);
    expect(projected).toEqual({ cheap: fullBundleBinding.cheap });
    expect(buildHybridTierBinding(selected as typeof answerQuery, projected)).toEqual({ tiers: projected });
  });
});

describe("hybrid Mode A: route() with a non-uniform tierBinding", () => {
  it("routes each step to its own bound adapter — cheap and strong hit distinctly scripted mocks", async () => {
    const bundle = loadBundle(readFixture("genbi-default.bundle.json"));

    const { calls: cheapCalls, doGenerate: cheapGenerate } = scriptedTurns([
      textResult("intent: top customer by revenue"),
    ]);
    const { calls: strongCalls, doGenerate: strongGenerate } = scriptedTurns([
      toolCallResult("query", "call-1", { sql: "select * from customers" }),
      textResult(VERIFIED_QUERY_RESULT_TEXT),
    ]);

    const authChoice: AuthChoice = { mode: "api-key", adapter: MOCK_ADAPTER_ID };

    const result = await route({
      authChoice,
      profileSource: "/unused/profile",
      userProject: "/unused/project",
      question: "who is our top customer?",
      bundle,
      mcpServers: { sample: mockWrenServerConfig() },
      tierBinding: {
        cheap: { adapter: MOCK_ADAPTER_ID, config: { doGenerate: cheapGenerate } },
        strong: { adapter: MOCK_ADAPTER_ID, config: { doGenerate: strongGenerate } },
      },
    });

    if (result.backend !== "agent") throw new Error("expected the agent backend (Mode A)");
    expect(result.kind).toBe("answer");
    // resolve_intent (cheap) only ever hit the cheap mock, never the strong one.
    expect(cheapCalls).toHaveLength(1);
    // the query tool-call turn and its finishing text hit strong; the direct
    // fast path skips the render-envelope synthesis call entirely.
    expect(strongCalls).toHaveLength(2);
  });

  it("loud-fails before running anything when a declared tier is left unbound", async () => {
    const bundle = loadBundle(readFixture("genbi-default.bundle.json"));
    const authChoice: AuthChoice = { mode: "api-key", adapter: MOCK_ADAPTER_ID };

    await expect(
      route({
        authChoice,
        profileSource: "/unused/profile",
        userProject: "/unused/project",
        question: "who is our top customer?",
        bundle,
        mcpServers: { sample: mockWrenServerConfig() },
        tierBinding: {
          cheap: {
            adapter: MOCK_ADAPTER_ID,
            config: {
              doGenerate: async () => {
                throw new Error("must not be reached — the tier binding is incomplete and should fail first");
              },
            },
          },
        },
      }),
    ).rejects.toThrow(/missing an adapter for tier\(s\): strong/);
  });
});
