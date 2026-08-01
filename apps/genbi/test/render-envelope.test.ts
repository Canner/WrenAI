import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { loadBundle } from "../harness/bundle/loader.js";
import { createDefaultProviderRegistry, MOCK_ADAPTER_ID } from "../harness/providers/index.js";
import type { TierBinding } from "../harness/providers/index.js";
import { EnvelopeParseError, EnvelopeSchemaError, renderEnvelope } from "../harness/render/index.js";
import { readFixture } from "./fixtures.js";

/**
 * `renderEnvelope` now synthesizes via `generateText` (provider-agnostic,
 * no `responseFormat: json_schema`) and extracts + validates the JSON by
 * hand — see `harness/render/envelope.ts`. `renderEnvelope` also has a
 * deterministic fast path (`tryDirectEnvelope`) that skips the render LLM
 * entirely when a dataflow artifact is ALREADY a renderable payload (a flat
 * `{columns,rows,verified?,definition?}` table, or a `{blocks}` envelope).
 *
 * The two describe blocks below deliberately use a NON-renderable artifact
 * (a plain prose string, not a flat table or `{blocks}` shape) so
 * `tryDirectEnvelope` returns `undefined` and every scripted `generateText`
 * call actually runs — they cover the extraction paths a real model can
 * produce (fenced, prose-wrapped, bare) plus the malformed-JSON retry
 * behavior and the flat-shape normalization shim, independent of the fast
 * path. The final describe block covers the fast path itself.
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

const VALID_ENVELOPE = { blocks: [{ type: "table" }], summary: "ok", verified: true };

/** Not a flat table (`columns`/`rows`) and not a `{blocks}` envelope — `tryDirectEnvelope` must skip it. */
const NON_RENDERABLE_ARTIFACTS = new Map<string, unknown>([
  ["query_result", "raw notes: ran the query, got one row back, haven't structured it yet"],
]);

describe("renderEnvelope (generateText + robust JSON extraction)", () => {
  const bundle = loadBundle(readFixture("genbi-default.bundle.json"));
  const agent = bundle.agents.find((candidate) => candidate.id === "answer_query");
  if (!agent) throw new Error("fixture missing answer_query agent");

  const artifacts = NON_RENDERABLE_ARTIFACTS;

  it("extracts a bare JSON object with no surrounding text", async () => {
    const { binding } = bindingForText([JSON.stringify(VALID_ENVELOPE)]);
    const envelope = await renderEnvelope(agent, artifacts, {
      binding,
      registry: createDefaultProviderRegistry(),
      userInput: "who is our top customer?",
      tier: "strong",
    });
    expect(envelope).toEqual(VALID_ENVELOPE);
  });

  it("extracts JSON wrapped in a ```json fenced code block", async () => {
    const fenced = "```json\n" + JSON.stringify(VALID_ENVELOPE) + "\n```";
    const { binding } = bindingForText([fenced]);
    const envelope = await renderEnvelope(agent, artifacts, {
      binding,
      registry: createDefaultProviderRegistry(),
      userInput: "who is our top customer?",
      tier: "strong",
    });
    expect(envelope).toEqual(VALID_ENVELOPE);
  });

  it("extracts JSON wrapped in a bare ``` fenced code block (no language tag)", async () => {
    const fenced = "```\n" + JSON.stringify(VALID_ENVELOPE) + "\n```";
    const { binding } = bindingForText([fenced]);
    const envelope = await renderEnvelope(agent, artifacts, {
      binding,
      registry: createDefaultProviderRegistry(),
      userInput: "who is our top customer?",
      tier: "strong",
    });
    expect(envelope).toEqual(VALID_ENVELOPE);
  });

  it("extracts JSON wrapped in explanatory prose before and after it", async () => {
    const prosed =
      `Sure, here is the answer:\n\n${JSON.stringify(VALID_ENVELOPE)}\n\nLet me know if you need anything else.`;
    const { binding } = bindingForText([prosed]);
    const envelope = await renderEnvelope(agent, artifacts, {
      binding,
      registry: createDefaultProviderRegistry(),
      userInput: "who is our top customer?",
      tier: "strong",
    });
    expect(envelope).toEqual(VALID_ENVELOPE);
  });

  it("retries once on a malformed first response, then succeeds on a valid reformat", async () => {
    const { binding } = bindingForText(["not json at all, sorry", JSON.stringify(VALID_ENVELOPE)]);
    const envelope = await renderEnvelope(agent, artifacts, {
      binding,
      registry: createDefaultProviderRegistry(),
      userInput: "who is our top customer?",
      tier: "strong",
    });
    expect(envelope).toEqual(VALID_ENVELOPE);
  });

  it("throws EnvelopeParseError when both attempts fail to produce parseable JSON", async () => {
    const { binding } = bindingForText(["not json", "still not json"]);
    await expect(
      renderEnvelope(agent, artifacts, {
        binding,
        registry: createDefaultProviderRegistry(),
        userInput: "who is our top customer?",
        tier: "strong",
      }),
    ).rejects.toThrow(EnvelopeParseError);
  });

  it("throws EnvelopeSchemaError when the parsed JSON doesn't match output_schema", async () => {
    const { binding } = bindingForText([JSON.stringify({ summary: "missing required blocks" })]);
    await expect(
      renderEnvelope(agent, artifacts, {
        binding,
        registry: createDefaultProviderRegistry(),
        userInput: "who is our top customer?",
        tier: "strong",
      }),
    ).rejects.toThrow(EnvelopeSchemaError);
  });
});

/**
 * `answer_query`'s ACTUAL output contract is the FLAT
 * `{columns, rows, verified, definition}` shape (see `harness/render/envelope.ts`
 * doc comment on `normalizeToEnvelopeShape`) — not the `{blocks}`
 * RenderEnvelope this module otherwise validates against. These tests cover
 * the normalization shim that reconciles the two, driven through the
 * render-LLM path (a non-renderable artifact keeps `tryDirectEnvelope` from
 * short-circuiting, so the scripted model response below is what actually
 * gets normalized) — so a flat `answer_query` response renders as a
 * verified table instead of degrading to unverified raw-JSON text (the bug
 * this shim fixes). The fast path's own direct handling of this same flat
 * shape (no LLM call at all) is covered separately below.
 */
describe("renderEnvelope (flat answer_query shape -> {blocks} normalization)", () => {
  const bundle = loadBundle(readFixture("genbi-default.bundle.json"));
  const agent = bundle.agents.find((candidate) => candidate.id === "answer_query");
  if (!agent) throw new Error("fixture missing answer_query agent");

  const artifacts = NON_RENDERABLE_ARTIFACTS;

  const FLAT_PAYLOAD = {
    columns: ["customer_count"],
    rows: [[7508]],
    verified: true,
    definition: {
      sql: "SELECT COUNT(*) FROM customers WHERE is_test = false AND deleted_at IS NULL",
      source_tables: ["customers"],
      filters: ["is_test = false", "deleted_at IS NULL"],
    },
  };

  it("normalizes an unfenced flat payload into a table + definition block, verified: true", async () => {
    const { binding } = bindingForText([JSON.stringify(FLAT_PAYLOAD)]);
    const envelope = await renderEnvelope(agent, artifacts, {
      binding,
      registry: createDefaultProviderRegistry(),
      userInput: "how many customers are there?",
      tier: "strong",
    });

    expect(envelope.verified).toBe(true);
    expect(envelope.blocks).toEqual([
      { type: "table", columns: FLAT_PAYLOAD.columns, rows: FLAT_PAYLOAD.rows },
      {
        type: "definition",
        sql: FLAT_PAYLOAD.definition.sql,
        source_tables: FLAT_PAYLOAD.definition.source_tables,
        filters: FLAT_PAYLOAD.definition.filters,
      },
    ]);
  });

  it("normalizes a fenced flat payload (```json ... ```) the same way", async () => {
    const fenced = "```json\n" + JSON.stringify(FLAT_PAYLOAD) + "\n```";
    const { binding } = bindingForText([fenced]);
    const envelope = await renderEnvelope(agent, artifacts, {
      binding,
      registry: createDefaultProviderRegistry(),
      userInput: "how many customers are there?",
      tier: "strong",
    });

    expect(envelope.verified).toBe(true);
    expect(envelope.blocks).toEqual([
      { type: "table", columns: FLAT_PAYLOAD.columns, rows: FLAT_PAYLOAD.rows },
      {
        type: "definition",
        sql: FLAT_PAYLOAD.definition.sql,
        source_tables: FLAT_PAYLOAD.definition.source_tables,
        filters: FLAT_PAYLOAD.definition.filters,
      },
    ]);
  });

  it("leaves an already-{blocks} envelope unchanged (generate_dashboard and friends unaffected)", async () => {
    const { binding } = bindingForText([JSON.stringify(VALID_ENVELOPE)]);
    const envelope = await renderEnvelope(agent, artifacts, {
      binding,
      registry: createDefaultProviderRegistry(),
      userInput: "how many customers are there?",
      tier: "strong",
    });

    expect(envelope).toEqual(VALID_ENVELOPE);
  });

  it("normalizes a flat payload with verified: false into a table block that stays unverified", async () => {
    const unverifiedFlat = {
      columns: ["customer_count"],
      rows: [[7508]],
      verified: false,
    };
    const { binding } = bindingForText([JSON.stringify(unverifiedFlat)]);
    const envelope = await renderEnvelope(agent, artifacts, {
      binding,
      registry: createDefaultProviderRegistry(),
      userInput: "how many customers are there?",
      tier: "strong",
    });

    expect(envelope.verified).toBe(false);
    expect(envelope.blocks).toEqual([{ type: "table", columns: unverifiedFlat.columns, rows: unverifiedFlat.rows }]);
  });
});

/**
 * The deterministic fast path itself (`tryDirectEnvelope` in
 * `harness/render/envelope.ts`): when a dataflow artifact is ALREADY a
 * renderable payload, `renderEnvelope` builds the envelope straight from it
 * and never calls the render LLM at all — asserted here via the mock's own
 * call log (`calls`), not just via output shape, since the whole point of
 * the fast path is to skip that call.
 */
describe("renderEnvelope (deterministic direct-render fast path)", () => {
  const bundle = loadBundle(readFixture("genbi-default.bundle.json"));
  const agent = bundle.agents.find((candidate) => candidate.id === "answer_query");
  if (!agent) throw new Error("fixture missing answer_query agent");

  const FLAT_PAYLOAD = {
    columns: ["customer_count"],
    rows: [[8000]],
    verified: true,
    definition: {
      sql: "select count(*) from customers",
      source_tables: ["customers"],
      filters: [],
    },
  };

  it("builds the envelope directly from a flat {columns,rows,verified,definition} artifact, with no generateText call", async () => {
    const artifacts = new Map<string, unknown>([["query_result", JSON.stringify(FLAT_PAYLOAD)]]);
    const { binding, calls } = bindingForText([]);

    const envelope = await renderEnvelope(agent, artifacts, {
      binding,
      registry: createDefaultProviderRegistry(),
      userInput: "how many customers do we have?",
      tier: "strong",
    });

    expect(calls).toHaveLength(0);
    expect(envelope.verified).toBe(true);
    expect(envelope.blocks).toEqual([
      { type: "table", columns: FLAT_PAYLOAD.columns, rows: FLAT_PAYLOAD.rows },
      {
        type: "definition",
        sql: FLAT_PAYLOAD.definition.sql,
        source_tables: FLAT_PAYLOAD.definition.source_tables,
        filters: FLAT_PAYLOAD.definition.filters,
      },
    ]);
  });

  it("passes an artifact already shaped {blocks:[...]} straight through, with no generateText call", async () => {
    const artifacts = new Map<string, unknown>([["render_result", JSON.stringify(VALID_ENVELOPE)]]);
    const { binding, calls } = bindingForText([]);

    const envelope = await renderEnvelope(agent, artifacts, {
      binding,
      registry: createDefaultProviderRegistry(),
      userInput: "who is our top customer?",
      tier: "strong",
    });

    expect(calls).toHaveLength(0);
    expect(envelope).toEqual(VALID_ENVELOPE);
  });

  it("prefers the terminal (last-inserted) renderable artifact over an earlier intermediate one", async () => {
    const intermediate = { columns: ["stale_column"], rows: [[1]], verified: false };
    const terminal = FLAT_PAYLOAD;
    const artifacts = new Map<string, unknown>([
      ["intermediate_result", JSON.stringify(intermediate)],
      ["query_result", JSON.stringify(terminal)],
    ]);
    const { binding, calls } = bindingForText([]);

    const envelope = await renderEnvelope(agent, artifacts, {
      binding,
      registry: createDefaultProviderRegistry(),
      userInput: "how many customers do we have?",
      tier: "strong",
    });

    expect(calls).toHaveLength(0);
    expect(envelope.verified).toBe(true);
    expect(envelope.blocks).toEqual([
      { type: "table", columns: terminal.columns, rows: terminal.rows },
      {
        type: "definition",
        sql: terminal.definition.sql,
        source_tables: terminal.definition.source_tables,
        filters: terminal.definition.filters,
      },
    ]);
  });
});

/**
 * The deterministic *render seed* (`ctx.toolTable` in `harness/render/envelope.ts`):
 * the strongest path, taken before the artifact scan. It exists for the real
 * live case where a data-access tool returned structured rows but the step
 * model summarized them to prose in its `produces` artifact — so nothing in
 * `artifacts` is directly renderable, yet the caller (`runAgent`) captured the
 * `query` tool's actual `{columns, rows}` and hands it in here. When present
 * and it validates against `output_schema`, the envelope is built straight
 * from it, `verified: true` (the seed IS a successful execution result), and
 * the render LLM is never called — asserted via the mock's call log.
 */
describe("renderEnvelope (deterministic tool-result render seed)", () => {
  const bundle = loadBundle(readFixture("genbi-default.bundle.json"));
  const agent = bundle.agents.find((candidate) => candidate.id === "answer_query");
  if (!agent) throw new Error("fixture missing answer_query agent");

  it("builds the envelope from ctx.toolTable even when every artifact is non-renderable prose, with no generateText call", async () => {
    // Exactly the live shape: the step model wrote prose, not structure.
    const artifacts = new Map<string, unknown>([
      ["query_result", "The query ran and returned 8,000 customers. Validation passed."],
    ]);
    const { binding, calls } = bindingForText([]);

    const envelope = await renderEnvelope(agent, artifacts, {
      binding,
      registry: createDefaultProviderRegistry(),
      userInput: "how many customers are there?",
      tier: "strong",
      toolTable: {
        columns: ["customer_count"],
        rows: [[8000]],
        sql: "SELECT COUNT(*) AS customer_count FROM customers",
      },
    });

    expect(calls).toHaveLength(0);
    expect(envelope.verified).toBe(true);
    expect(envelope.blocks).toEqual([
      { type: "table", columns: ["customer_count"], rows: [[8000]] },
      {
        type: "definition",
        sql: "SELECT COUNT(*) AS customer_count FROM customers",
        source_tables: [],
        filters: [],
      },
    ]);
  });

  it("omits the definition block when the seed carries no sql", async () => {
    const { binding, calls } = bindingForText([]);

    const envelope = await renderEnvelope(agent, new Map(), {
      binding,
      registry: createDefaultProviderRegistry(),
      userInput: "how many customers are there?",
      tier: "strong",
      toolTable: { columns: ["customer_count"], rows: [[8000]] },
    });

    expect(calls).toHaveLength(0);
    expect(envelope.blocks).toEqual([{ type: "table", columns: ["customer_count"], rows: [[8000]] }]);
  });
});
