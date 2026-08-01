import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { loadBundle } from "../harness/bundle/loader.js";
import { createDefaultProviderRegistry, MOCK_ADAPTER_ID } from "../harness/providers/index.js";
import type { TierBinding } from "../harness/providers/index.js";
import { getAllowedBlockTypes, isTableOnlySchema, renderEnvelope } from "../harness/render/index.js";
import { readFixture } from "./fixtures.js";

/**
 * Blocker 2: the `toolTable` seed (table-only) used to fire
 * unconditionally, ahead of everything else, which meant an incidental
 * `query` call inside `generate_dashboard`'s multi-panel flow could seed a
 * lone table block instead of letting the dashboard's real
 * `build_dashboard` result (or the render LLM) produce the full
 * kpi_card/chart/table/definition envelope. These tests cover:
 *  - `getAllowedBlockTypes`/`isTableOnlySchema`, the schema-inspection
 *    helper that gates the `toolTable` seed.
 *  - The corrected seed precedence in `renderEnvelope`: dashboard seed ->
 *    (gated) toolTable seed -> tryDirectEnvelope -> render LLM.
 */

function bindingForText(responses: readonly string[]): { binding: TierBinding; calls: LanguageModelV4CallOptions[] } {
  let index = 0;
  const calls: LanguageModelV4CallOptions[] = [];
  const binding: TierBinding = {
    tiers: {
      strong: {
        adapter: MOCK_ADAPTER_ID,
        config: {
          doGenerate: async (options: LanguageModelV4CallOptions) => {
            calls.push(options);
            const text = responses[index]!;
            index += 1;
            return {
              content: [{ type: "text", text }],
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: undefined, text: undefined, reasoning: undefined },
              },
              warnings: [],
            };
          },
        },
      },
    },
  };
  return { binding, calls };
}

const bundle = loadBundle(readFixture("genbi-default.native.bundle.json"));
function agentOf(id: string) {
  const agent = bundle.agents.find((candidate) => candidate.id === id);
  if (!agent) throw new Error(`fixture missing "${id}" agent`);
  return agent;
}

describe("getAllowedBlockTypes / isTableOnlySchema", () => {
  it("answer_query's schema allows exactly {table, definition} -> table-only", () => {
    const schema = agentOf("answer_query").output_schema as Record<string, unknown>;
    expect(getAllowedBlockTypes(schema)).toEqual(new Set(["table", "definition"]));
    expect(isTableOnlySchema(schema)).toBe(true);
  });

  it("generate_dashboard's schema allows {kpi_card, table, chart, definition} -> NOT table-only", () => {
    const schema = agentOf("generate_dashboard").output_schema as Record<string, unknown>;
    expect(getAllowedBlockTypes(schema)).toEqual(new Set(["kpi_card", "table", "chart", "definition"]));
    expect(isTableOnlySchema(schema)).toBe(false);
  });

  it("explain_change's schema allows only {narrative} (single item schema, not anyOf) -> NOT table-only", () => {
    const schema = agentOf("explain_change").output_schema as Record<string, unknown>;
    expect(getAllowedBlockTypes(schema)).toEqual(new Set(["narrative"]));
    expect(isTableOnlySchema(schema)).toBe(false);
  });

  it("explore_model's unconstrained {type: object} item schema yields no allowed-types set -> NOT table-only", () => {
    const schema = agentOf("explore_model").output_schema as Record<string, unknown>;
    expect(getAllowedBlockTypes(schema)).toBeUndefined();
    expect(isTableOnlySchema(schema)).toBe(false);
  });
});

describe("renderEnvelope seed precedence (dashboard seed > gated toolTable seed > direct envelope > render LLM)", () => {
  it("a table-only toolTable seed does NOT satisfy/clobber generate_dashboard's schema — falls through to the render LLM", async () => {
    const dashboardEnvelope = {
      blocks: [
        { type: "kpi_card", label: "Revenue", value: 100 },
        { type: "chart", chart_type: "bar", x: "month", series: ["revenue"], rows: [{ month: "Jan", revenue: 100 }] },
      ],
      verified: true,
    };
    const { binding, calls } = bindingForText([JSON.stringify(dashboardEnvelope)]);

    const envelope = await renderEnvelope(agentOf("generate_dashboard"), new Map(), {
      binding,
      registry: createDefaultProviderRegistry(),
      userInput: "build a dashboard of revenue",
      tier: "strong",
      toolTable: { columns: ["revenue"], rows: [[100]], sql: "SELECT SUM(revenue) AS revenue FROM orders" },
    });

    // The toolTable seed was gated off (generate_dashboard isn't table-only), so the
    // render LLM had to run — proving the seed didn't short-circuit and collapse the
    // dashboard down to a lone table block.
    expect(calls).toHaveLength(1);
    expect(envelope).toEqual(dashboardEnvelope);
  });

  it("a build_dashboard {blocks} seed is preferred for generate_dashboard, with no render LLM call at all", async () => {
    const { binding, calls } = bindingForText([]);

    const envelope = await renderEnvelope(agentOf("generate_dashboard"), new Map(), {
      binding,
      registry: createDefaultProviderRegistry(),
      userInput: "build a dashboard of revenue",
      tier: "strong",
      dashboardSeed: {
        blocks: [
          { type: "kpi_card", label: "Revenue", value: 100 },
          { type: "table", columns: ["month", "revenue"], rows: [{ month: "Jan", revenue: 100 }] },
        ],
        summary: "Revenue is steady.",
        verified: true,
      },
    });

    expect(calls).toHaveLength(0);
    expect(envelope.verified).toBe(true);
    expect(envelope.summary).toBe("Revenue is steady.");
    expect(envelope.blocks).toEqual([
      { type: "kpi_card", label: "Revenue", value: 100 },
      { type: "table", columns: ["month", "revenue"], rows: [{ month: "Jan", revenue: 100 }] },
    ]);
  });

  it("dashboardSeed takes priority over a toolTable seed when both are present (no render LLM call)", async () => {
    const { binding, calls } = bindingForText([]);

    const envelope = await renderEnvelope(agentOf("generate_dashboard"), new Map(), {
      binding,
      registry: createDefaultProviderRegistry(),
      userInput: "build a dashboard of revenue",
      tier: "strong",
      toolTable: { columns: ["revenue"], rows: [[100]] },
      dashboardSeed: { blocks: [{ type: "kpi_card", label: "Revenue", value: 100 }], verified: true },
    });

    expect(calls).toHaveLength(0);
    expect(envelope.blocks).toEqual([{ type: "kpi_card", label: "Revenue", value: 100 }]);
  });

  it("the toolTable seed still short-circuits for answer_query's table-only schema (no regression)", async () => {
    const { binding, calls } = bindingForText([]);

    const envelope = await renderEnvelope(agentOf("answer_query"), new Map(), {
      binding,
      registry: createDefaultProviderRegistry(),
      userInput: "how many customers are there?",
      tier: "strong",
      toolTable: { columns: ["customer_count"], rows: [[8000]] },
    });

    expect(calls).toHaveLength(0);
    expect(envelope.verified).toBe(true);
    expect(envelope.blocks).toEqual([{ type: "table", columns: ["customer_count"], rows: [[8000]] }]);
  });
});
