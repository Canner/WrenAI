import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult, LanguageModelV4Usage } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { loadBundle } from "../harness/bundle/loader.js";
import { MOCK_ADAPTER_ID } from "../harness/providers/index.js";
import { collectJsonSchemaErrors } from "../harness/render/index.js";
import { route } from "../harness/route/index.js";
import type { AuthChoice } from "../harness/auth/index.js";
import { GOLDEN_ENVELOPE, matchesGolden, PARITY_QUESTION } from "./golden-envelope.js";
import { mockWrenServerConfig } from "./mock-mcp-server.js";
import { readFixture } from "./fixtures.js";

/**
 * Hermetic cross-back-end OUTPUT parity (item B): both in-process and
 * Dispatched are compiled from the *same* profile and must satisfy the *same*
 * contract — `answer_query`'s `output_schema` — because `route()` never
 * branches the contract itself, only which executor runs it (see
 * `harness/route/route.ts`). This asserts that hermetically, on in-process, using
 * the mock adapter to script a deterministic golden-shaped final envelope
 * exactly as `test/in-process.test.ts` does for its own fixtures.
 *
 * This closes the "no output-level conformance check" gap: `renderEnvelope`
 * uses `generateText` (not `generateObject`), so `output_schema` has no
 * enforcement unless something calls `collectJsonSchemaErrors` against the
 * result — nothing in the hermetic suite does, until now.
 *
 * Dispatched's live output is asserted against the same golden fixture in the
 * opt-in `test/e2e-cross-backend-parity.test.ts` (item D) — dispatched has no
 * mock adapter seam (it shells out to a real CLI), so it cannot be driven
 * hermetically the way in-process can here.
 */

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

describe("cross-back-end OUTPUT parity — hermetic contract check (item B)", () => {
  it("in-process's rendered envelope both satisfies answer_query.output_schema and matchesGolden", async () => {
    const bundle = loadBundle(readFixture("genbi-default.bundle.json"));
    const agent = bundle.agents.find((candidate) => candidate.id === "answer_query");
    if (!agent) throw new Error("fixture missing answer_query agent");

    // The final render-stage JSON must satisfy BOTH the schema's required
    // `blocks` field AND the golden fixture's `columns`/`rows`/`verified`/
    // `definition` fields simultaneously — the schema has no
    // `additionalProperties: false`, so these are not mutually exclusive
    // (see the module doc comment on `golden-envelope.ts` for why the
    // golden shape differs from the literal schema shape).
    const envelopeJson = JSON.stringify({
      blocks: [{ type: "table" }],
      summary: "Howard R. is our highest-value customer by lifetime value.",
      ...GOLDEN_ENVELOPE,
    });

    // Deliberately not a flat table shape (no JSON) so the deterministic
    // direct-render fast path (`renderEnvelope`'s `tryDirectEnvelope`) skips
    // it and the render-LLM path actually runs, synthesizing `envelopeJson`
    // above — which is what carries both the schema-satisfying `blocks` and
    // the golden-matching top-level fields.
    const { calls, doGenerate } = scriptedTurns([
      textResult("intent: highest lifetime value customer"),
      toolCallResult("query", "call-1", { sql: "select * from customers" }),
      textResult("executed the query, got one row back, haven't structured it yet"),
      textResult(envelopeJson),
    ]);

    const authChoice: AuthChoice = { mode: "api-key", adapter: MOCK_ADAPTER_ID, config: { doGenerate } };

    const result = await route({
      authChoice,
      profileSource: "/unused/profile",
      userProject: "/unused/project",
      question: PARITY_QUESTION,
      bundle,
      mcpServers: { sample: mockWrenServerConfig() },
    });

    if (result.backend !== "agent") throw new Error("expected the agent backend (in-process)");
    if (result.kind !== "answer") throw new Error("expected an answer result");
    expect(calls).toHaveLength(4);

    const schemaErrors = collectJsonSchemaErrors(agent.output_schema, result.envelope);
    expect(schemaErrors).toEqual([]);
    expect(matchesGolden(result.envelope)).toBe(true);
  });
});
