import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult, LanguageModelV4Usage } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { loadBundle } from "../harness/bundle/loader.js";
import { createDefaultCapabilityRegistry } from "../harness/capability/registry.js";
import { createDefaultProviderRegistry, MOCK_ADAPTER_ID } from "../harness/providers/index.js";
import type { TierBinding } from "../harness/providers/index.js";
import { runAgent } from "../harness/session/index.js";
import type { RunAgentContext } from "../harness/session/index.js";
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

/**
 * Builds a `TierBinding` scripting the golden `answer_query` shape's two
 * tiers: `cheap` (resolve_intent, one call) and `strong` (generate_sql's
 * tool-loop turns, *plus* the render envelope's separate `generateObject`
 * call — both run on the same tier by default, see `renderEnvelope`'s
 * documented tier choice). `strongTurns` supplies every "strong" call in
 * order: the tool call, then generate_sql's finishing text, then the
 * envelope-stage JSON.
 */
function buildBinding(strongTurns: LanguageModelV4GenerateResult[]) {
  const strongCalls: LanguageModelV4CallOptions[] = [];
  let strongIndex = 0;

  const binding: TierBinding = {
    tiers: {
      cheap: {
        adapter: MOCK_ADAPTER_ID,
        config: { doGenerate: async () => textResult("intent: top customer by revenue") },
      },
      strong: {
        adapter: MOCK_ADAPTER_ID,
        config: {
          doGenerate: async (options: LanguageModelV4CallOptions) => {
            strongCalls.push(options);
            const result = strongTurns[strongIndex]!;
            strongIndex += 1;
            return result;
          },
        },
      },
    },
  };

  return { binding, strongCalls };
}

function buildRunAgentContext(binding: TierBinding, failQueryCount = 0): RunAgentContext {
  return {
    binding,
    registry: createDefaultProviderRegistry(),
    capabilityRegistry: createDefaultCapabilityRegistry(),
    mcpServers: { sample: mockWrenServerConfig({ failQueryCount }) },
  };
}

// The flat table shape `generate_sql`'s finishing text is contractually
// supposed to produce (see the fixture's own step prompt) — since the
// deterministic direct-render fast path (`renderEnvelope`'s `tryDirectEnvelope`)
// now picks this up straight off the dataflow artifact, no separate
// render-LLM call happens on the happy/refusal paths below; only a
// genuinely non-JSON/non-flat finishing text still falls through to it.
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

describe("runAgent (end-to-end)", () => {
  it("returns an AnswerResult whose envelope validates against output_schema on the happy path", async () => {
    const bundle = loadBundle(readFixture("genbi-default.bundle.json"));

    const { binding, strongCalls } = buildBinding([
      toolCallResult("query", "call-1", { sql: "select * from customers" }),
      textResult(VERIFIED_QUERY_RESULT_TEXT),
    ]);

    const result = await runAgent(
      bundle,
      "answer_query",
      "who is our top customer?",
      buildRunAgentContext(binding),
    );

    expect(result.kind).toBe("answer");
    expect(result.envelope).toEqual({
      blocks: [{ type: "table", columns: ["customer", "revenue"], rows: [["Acme", 1000]] }],
      summary: "Acme is the top customer by revenue.",
      verified: true,
    });
    // cheap (resolve_intent) + strong tool-call + strong finish; the direct
    // fast path skips the render-LLM synthesis call entirely.
    expect(strongCalls).toHaveLength(2);
  });

  it("a real successful data-access call earns verified:true even when the render output self-attests verified: false", async () => {
    // Pre-existing behavior (before this fix) trusted the
    // render output's own "verified" self-attestation here and refused. The
    // fix intentionally changes this: a locked gated_check guardrail on a
    // data-access-requiring agent is satisfied by a real successful `query`
    // tool call — mirroring the toolTable seed's own justification (a
    // successful, non-erroring execution IS the evidence the deterministic
    // gate requires) — regardless of what the render output separately
    // claims about "verified". The still-refuses case (no successful query
    // call at all) is covered by the test right below.
    const bundle = loadBundle(readFixture("genbi-default.bundle.json"));

    const { binding } = buildBinding([
      toolCallResult("query", "call-1", { sql: "select * from customers" }),
      textResult(UNVERIFIED_QUERY_RESULT_TEXT),
    ]);

    const result = await runAgent(
      bundle,
      "answer_query",
      "who is our top customer?",
      buildRunAgentContext(binding),
    );

    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") throw new Error("expected an answer result");
    expect(result.envelope.verified).toBe(true);
  });

  it("forces a refusal on a fabricated verified:true when the run had zero successful query tool calls", async () => {
    const bundle = loadBundle(readFixture("genbi-default.bundle.json"));

    // The model never calls the `query` tool at all — generate_sql's tool-loop
    // turn finishes on plain text — yet the render stage still asserts
    // verified: true. The deterministic gate must refuse this
    // regardless of the self-attested "verified" field, because
    // answer_query declares a `sql_execution:read_only` capability and the
    // run had zero successful data-access calls to back the claim.
    const envelopeJson = JSON.stringify({
      blocks: [{ type: "table" }],
      summary: "Acme is the top customer by revenue.",
      verified: true,
    });

    const { binding } = buildBinding([textResult("I already know the answer without querying."), textResult(envelopeJson)]);

    const result = await runAgent(
      bundle,
      "answer_query",
      "who is our top customer?",
      buildRunAgentContext(binding),
    );

    expect(result.kind).toBe("refusal");
    if (result.kind !== "refusal") throw new Error("expected a refusal result");
    expect(result.reason).toMatch(/zero successful "query" tool calls/);
    expect(result.envelope.verified).toBe(true);
  });

  it("rejects when the model's envelope response doesn't validate against output_schema", async () => {
    const bundle = loadBundle(readFixture("genbi-default.bundle.json"));

    // Missing the required "blocks" property entirely.
    const malformedEnvelopeJson = JSON.stringify({ summary: "no blocks here", verified: true });

    // Not a flat table shape (no JSON at all), so the direct fast path skips
    // it and the render-LLM path actually runs, hitting the malformed JSON
    // below.
    const { binding } = buildBinding([
      toolCallResult("query", "call-1", { sql: "select * from customers" }),
      textResult("executed the query and got a row back, haven't structured it yet"),
      textResult(malformedEnvelopeJson),
    ]);

    await expect(
      runAgent(bundle, "answer_query", "who is our top customer?", buildRunAgentContext(binding)),
    ).rejects.toThrow();
  });

  it("explain_change earns verified:true from a real successful query call, even when the render LLM doesn't self-attest it", async () => {
    const bundle = loadBundle(readFixture("genbi-default.bundle.json"));

    // explain_change's output_schema is narrative-only ({blocks: [{type: "narrative", ...}]}),
    // so the toolTable seed (which is table-shaped) never validates against it and the run
    // falls through to the render LLM — which, unlike the toolTable seed, does not reliably
    // self-attest verified: true. Here it explicitly says false.
    const narrativeEnvelopeJson = JSON.stringify({
      blocks: [{ type: "narrative", text: "Revenue dropped 10%, driven mainly by the EU region." }],
      summary: "EU region drove the revenue drop.",
      verified: false,
    });

    const { binding } = buildBinding([
      textResult("Plan: compare this quarter vs last quarter, decompose by region."), // plan_decomposition — no tool call
      toolCallResult("query", "call-1", { sql: "select region, revenue from sales" }), // synthesize_drivers — real data access
      textResult("EU region revenue dropped the most, driving the overall decline."), // synthesize_drivers — finishing prose (not JSON)
      textResult(narrativeEnvelopeJson), // render-LLM envelope stage
    ]);

    const result = await runAgent(
      bundle,
      "explain_change",
      "why did revenue drop this quarter?",
      buildRunAgentContext(binding),
    );

    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") throw new Error("expected an answer result");
    // Earned from the real successful query call, overriding the render LLM's verified: false.
    expect(result.envelope.verified).toBe(true);
    expect(result.envelope.blocks).toEqual([
      { type: "narrative", text: "Revenue dropped 10%, driven mainly by the EU region." },
    ]);
  });

  it("explain_change still refuses when the run has zero successful query tool calls, even if the render LLM fabricates verified:true", async () => {
    const bundle = loadBundle(readFixture("genbi-default.bundle.json"));

    const fabricatedEnvelopeJson = JSON.stringify({
      blocks: [{ type: "narrative", text: "Revenue dropped due to seasonality." }],
      verified: true,
    });

    const { binding } = buildBinding([
      textResult("Plan: compare this quarter vs last quarter."), // plan_decomposition
      textResult("I already know the drivers without querying."), // synthesize_drivers — no tool call at all
      textResult(fabricatedEnvelopeJson), // render-LLM envelope stage, fraudulently self-attests verified:true
    ]);

    const result = await runAgent(
      bundle,
      "explain_change",
      "why did revenue drop this quarter?",
      buildRunAgentContext(binding),
    );

    expect(result.kind).toBe("refusal");
    if (result.kind !== "refusal") throw new Error("expected a refusal result");
    expect(result.reason).toMatch(/zero successful "query" tool calls/);
    expect(result.envelope.verified).toBe(true);
  });

  it("generate_dashboard refuses (instead of a fabricated verified:true) when every panel query fails and build_dashboard is never called", async () => {
    // generate_dashboard has no locked gated_check guardrail (only
    // scoped_write/read_only), so previously this shape forced
    // verified:true from "any successful query in the run" — but here there
    // is no successful query at all, and build_dashboard (the only source of
    // a real dashboard answer) is never called, so the render LLM's plain
    // prose finish falls through to a fabricated, ungrounded envelope. The
    // fix must catch this with a soft-failure refusal instead of presenting
    // an empty/fabricated "verified" dashboard.
    //
    // The fixture's `compose_layout` step used to declare
    // `consumes: ["dashboard_plan", "panel_results"]` even though no step in
    // the bundle ever `produces` an artifact named "panel_results" ("panel
    // results" is prose describing what the step does *internally*, not a
    // real dataflow artifact) — per the executor's dataflow-readiness check
    // (`isConsumesSatisfied` in `harness/loop/executor.ts`), that made
    // `compose_layout` unreachable for any `generate_dashboard` invocation.
    // The profile component (`generate_dashboard`'s `compose_layout` step)
    // and both fixtures have since been fixed to drop the phantom
    // "panel_results" entry, so the fixture now loads directly with no
    // in-memory patch and the scenario this test targets (a real query
    // failure, `build_dashboard` never called) is reachable as-is.
    const bundle = loadBundle(readFixture("genbi-default.bundle.json"));

    let strongIndex = 0;
    const strongTurns: LanguageModelV4GenerateResult[] = [
      textResult("Plan: KPI card for total revenue, chart for revenue by month, table of top customers."),
    ];

    // `compose_layout` runs on the `cheap` tier — its last independent
    // step's tier, which is also `renderEnvelope`'s default render tier — so
    // this scripts both tiers directly rather than reusing `buildBinding`
    // (which fixes the `cheap` tier to a single canned intent string for
    // `answer_query`'s `resolve_intent` step). The tool loop keeps stepping
    // after ANY tool call (success or error) until a turn with no tool
    // calls, so `compose_layout` takes two "cheap" turns (the failed `query`
    // call, then a plain prose finish that never calls `build_dashboard`)
    // before `renderEnvelope`'s own render-LLM stage consumes a third.
    let cheapIndex = 0;
    const cheapTurns: LanguageModelV4GenerateResult[] = [
      toolCallResult("query", "call-1", { sql: "select sum(revenue) as revenue from orders" }), // fails (failQueryCount)
      textResult("I couldn't complete the dashboard because the data query failed."), // compose_layout's finish — no build_dashboard call
      textResult(
        JSON.stringify({ blocks: [], summary: "Unable to build the dashboard.", verified: false }),
      ), // render-LLM envelope stage (cheap tier, since compose_layout is the last independent step)
    ];

    const binding: TierBinding = {
      tiers: {
        cheap: {
          adapter: MOCK_ADAPTER_ID,
          config: {
            doGenerate: async () => {
              const result = cheapTurns[cheapIndex]!;
              cheapIndex += 1;
              return result;
            },
          },
        },
        strong: {
          adapter: MOCK_ADAPTER_ID,
          config: {
            doGenerate: async () => {
              const result = strongTurns[strongIndex]!;
              strongIndex += 1;
              return result;
            },
          },
        },
      },
    };

    const result = await runAgent(
      bundle,
      "generate_dashboard",
      "build me a revenue dashboard",
      buildRunAgentContext(binding, 1), // failQueryCount: 1 — the single query attempt fails
    );

    expect(result.kind).toBe("refusal");
    if (result.kind !== "refusal") throw new Error("expected a refusal result");
    expect(result.reason).toMatch(/data query failed/);
    expect(result.envelope.verified).not.toBe(true);
  });
});
