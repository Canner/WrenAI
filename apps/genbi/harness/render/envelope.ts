import { generateText } from "ai";
import type { Agent } from "../bundle/schema.js";
import type { DataflowArtifacts } from "../loop/index.js";
import { resolveTierModel } from "../providers/index.js";
import type { ProviderRegistry, TierBinding } from "../providers/index.js";
import { EnvelopeParseError, EnvelopeSchemaError, NoRenderTierError } from "./errors.js";
import { collectJsonSchemaErrors } from "./validate.js";

/**
 * The structured answer synthesized from an agent's finished dataflow
 * artifacts, shaped by `agent.output_schema`. The golden `answer_query`
 * schema requires `blocks` and allows `summary`/`verified` to be present —
 * this type only pins down the fields the harness itself inspects
 * (`verified`, for `gated_check` enforcement); everything else the schema
 * defines flows through as-is.
 */
export interface RenderEnvelope {
  readonly blocks: unknown;
  readonly summary?: string | null;
  readonly verified?: boolean | null;
  readonly [key: string]: unknown;
}

/**
 * A flat table payload captured from a data-access tool's real, successful
 * result (the `query` tool's `{columns, rows}` reshaped to positional rows,
 * plus the SQL that produced it). When present, `renderEnvelope` builds the
 * envelope's table/definition blocks directly from this — deterministic, and
 * carrying the agent's actual rows — instead of routing through the render
 * model, which is lossy for structured data.
 */
export interface ToolTableSeed {
  readonly columns: readonly string[];
  readonly rows: readonly unknown[][];
  readonly sql?: string;
  readonly summary?: string;
}

/**
 * A full `{blocks}` payload captured from a `build_dashboard` tool's real,
 * successful result (see `harness/tools/native.ts`'s `assembleDashboardBlocks`).
 * Unlike {@link ToolTableSeed} (a flat table reshaped into table/definition
 * blocks), this is already a complete, ordered dashboard envelope — the
 * deterministic assembly tool did all the reshaping. When present and it
 * validates against `output_schema`, `renderEnvelope` returns it directly,
 * ahead of every other path (see `renderEnvelope`'s seed-precedence order).
 */
export interface DashboardSeed {
  readonly blocks: readonly unknown[];
  readonly summary?: string;
  readonly verified?: boolean;
}

export interface RenderEnvelopeContext {
  readonly binding: TierBinding;
  readonly registry: ProviderRegistry;
  /** The user's original question, threaded into the synthesis prompt. */
  readonly userInput: string;
  /**
   * Deterministic render seed: a data-access tool's real result. When set
   * and it validates against `output_schema`, the envelope is built straight
   * from it and the render model is skipped entirely. See {@link ToolTableSeed}.
   */
  readonly toolTable?: ToolTableSeed;
  /**
   * Deterministic render seed: a `build_dashboard` tool's real, already-
   * assembled `{blocks}` result (see {@link DashboardSeed}). Takes priority
   * over every other seed/path — see `renderEnvelope`'s seed-precedence order.
   */
  readonly dashboardSeed?: DashboardSeed;
  /**
   * Tier to run the envelope-synthesis `generateText` call on. Defaults
   * to the tier of the agent's *last* `independent` step (in `steps[]`
   * array order) — the reasoning behind this default: the last independent
   * step is the one that did the heaviest lifting toward the final answer
   * (e.g. `generate_sql` in the golden `answer_query` shape), so synthesis
   * warrants at least that much model strength. Callers with a dedicated
   * "render" tier in their bundle can override this explicitly.
   */
  readonly tier?: string;
}

/** Bounded: at most one reformat attempt if the model's first response doesn't parse. */
const MAX_PARSE_ATTEMPTS = 2;

/**
 * The two-stage structured-output envelope. Deliberately kept OUT of the
 * `ToolLoopAgent` construction in `executeAgent` — attaching `Output.object`
 * to a tool-bearing loop constrains every turn's output to the final
 * schema, including turns that are just making tool calls. Instead, this
 * runs as its own separate call, once, after the loop's dataflow artifacts
 * have all been produced.
 *
 * This deliberately uses `generateText`, not `generateObject` — the schema
 * is enforced in prompt text plus `collectJsonSchemaErrors` below, not via
 * an SDK-level `responseFormat: json_schema`/structured-output request.
 * `generateObject`'s `json_schema` response format isn't supported by every
 * OpenAI-compatible endpoint (e.g. Ollama's `/v1` endpoint 400s on it), so a
 * provider-agnostic envelope stage can't rely on it; `generateText` has no
 * such requirement and works identically against mock, cloud, and local
 * providers. Enforcement doesn't get any weaker: `jsonSchema()`'s own
 * `validate` callback was already the only thing giving `output_schema`
 * real teeth (it performs no runtime validation on its own without one), so
 * running `collectJsonSchemaErrors` directly against the parsed JSON here
 * is the same enforcement, just invoked by hand instead of through the SDK.
 */
export async function renderEnvelope(
  agent: Agent,
  artifacts: DataflowArtifacts,
  ctx: RenderEnvelopeContext,
): Promise<RenderEnvelope> {
  const outputSchema = agent.output_schema as Record<string, unknown>;

  // Deterministic render seed (STRONGEST path, checked first): a
  // `build_dashboard` tool's real, already-assembled `{blocks}` result
  // (`ctx.dashboardSeed`). This is a complete dashboard envelope built
  // deterministically by the native tool (see `assembleDashboardBlocks`), so
  // there is nothing left to reconcile — it wins over the table-only
  // `toolTable` seed below (whose gate below would skip a dashboard schema
  // anyway) and over the artifact scan / render LLM. Only taken when it
  // validates against `output_schema`; otherwise fall through (e.g.
  // `build_dashboard` was never called for this run).
  if (ctx.dashboardSeed !== undefined) {
    const seeded = {
      blocks: ctx.dashboardSeed.blocks,
      ...(ctx.dashboardSeed.summary !== undefined ? { summary: ctx.dashboardSeed.summary } : {}),
      ...(ctx.dashboardSeed.verified !== undefined ? { verified: ctx.dashboardSeed.verified } : {}),
    };
    if (collectJsonSchemaErrors(outputSchema, seeded).length === 0) {
      return seeded as RenderEnvelope;
    }
  }

  // Deterministic render seed: if the caller captured a data-access tool's
  // real result (`ctx.toolTable` — e.g. the `query` tool's rows), build the
  // envelope straight from it. This preserves the agent's actual data
  // regardless of whether the step model chose to re-emit that structure as
  // text (many models summarize it to prose, which the artifact scan below
  // then can't recover). `verified: true` is warranted here specifically
  // because the payload IS a successful, non-erroring execution result — the
  // exact evidence `runAgent`'s deterministic `gated_check` requires.
  //
  // Gated on `isTableOnlySchema`: this seed only ever produces `table`/
  // `definition` blocks, so it must only be applied when `output_schema`
  // permits *just* those block types (the `answer_query` shape). Without
  // this gate, a table-only seed captured from an incidental `query` call
  // (e.g. inside `generate_dashboard`'s multi-panel flow) would fire FIRST
  // and collapse a whole dashboard down to a single table — the schema
  // validation below would eventually reject it (a dashboard schema also
  // permits `kpi_card`/`chart`, so a table-only payload can actually still
  // validate against it, since every block in the array only needs to match
  // ONE `anyOf` branch), silently losing every other panel. Gating on the
  // schema's allowed types catches this before validation, not after.
  // Only taken when it also validates against `output_schema`; otherwise
  // fall through.
  if (ctx.toolTable !== undefined && isTableOnlySchema(outputSchema)) {
    const seeded = normalizeToEnvelopeShape({
      columns: ctx.toolTable.columns,
      rows: ctx.toolTable.rows,
      verified: true,
      ...(ctx.toolTable.summary !== undefined ? { summary: ctx.toolTable.summary } : {}),
      ...(ctx.toolTable.sql !== undefined
        ? { definition: { sql: ctx.toolTable.sql, source_tables: [], filters: [] } }
        : {}),
    });
    if (collectJsonSchemaErrors(outputSchema, seeded).length === 0) {
      return seeded as RenderEnvelope;
    }
  }

  // Deterministic fast-path: if a terminal artifact is ALREADY a renderable
  // payload (answer_query emits the flat {columns,rows,verified,definition};
  // other agents may already emit a {blocks} envelope), build the envelope
  // straight from it — no render LLM. This preserves the agent's real data
  // (the table rows) instead of asking a render model to re-synthesize it,
  // which is lossy (it tends to summarize the table away, leaving a bare
  // `{type:"table"}`) and an extra call. Only taken when the result validates;
  // otherwise fall through to the render-LLM path below.
  const direct = tryDirectEnvelope(artifacts);
  if (direct !== undefined && collectJsonSchemaErrors(outputSchema, direct).length === 0) {
    return direct as RenderEnvelope;
  }

  const tier = ctx.tier ?? defaultRenderTier(agent);
  const model = resolveTierModel(ctx.binding, tier, ctx.registry);
  const prompt = buildEnvelopePrompt(agent, artifacts, ctx.userInput, outputSchema);

  let lastParseError: unknown;
  for (let attempt = 1; attempt <= MAX_PARSE_ATTEMPTS; attempt += 1) {
    const { text } = await generateText({ model, prompt: attempt === 1 ? prompt : reformatPrompt(prompt) });

    let value: unknown;
    try {
      value = JSON.parse(extractJsonObjectText(text));
    } catch (error) {
      lastParseError = error;
      continue;
    }

    const normalized = normalizeToEnvelopeShape(value);

    const errors = collectJsonSchemaErrors(outputSchema, normalized);
    if (errors.length > 0) {
      throw new EnvelopeSchemaError(agent.id, errors);
    }
    return normalized as RenderEnvelope;
  }

  throw new EnvelopeParseError(agent.id, lastParseError);
}

/**
 * `answer_query`'s ACTUAL tool contract (see `answer_tool.ts`/warble's own
 * eval, which this must never change) is a FLAT table shape —
 * `{columns, rows, verified, definition}` — not the `{blocks}`
 * RenderEnvelope this module otherwise expects. Left unreconciled, that flat
 * shape fails `output_schema` validation below and the run degrades to an
 * unverified raw-JSON text blob (see `runAgent`'s `gated_check`, which only
 * trusts `envelope.verified === true`).
 *
 * This is a compatibility/normalization shim, applied to every parsed
 * candidate before schema validation:
 *  - Already has a `blocks` array (e.g. `generate_dashboard`, or any future
 *    agent that already speaks the block contract) → returned unchanged.
 *  - Otherwise, if it structurally matches the flat table shape (`columns`
 *    and `rows` are both arrays — a shape a real `{blocks: [...]}` envelope
 *    never has at its top level, so this can't misfire against one) →
 *    synthesize `blocks = [{type: "table", columns, rows}, ...(definition
 *    block, if present)]` and carry `verified`/`summary` onto the result,
 *    so the flat payload renders as a verified table instead of failing
 *    validation.
 *  - Anything else (unrecognized shape) → returned unchanged, so it still
 *    fails `output_schema` validation below with a useful error rather than
 *    being silently coerced into something misleading.
 */
/**
 * Scans the loop's dataflow artifacts for one that is ALREADY a renderable
 * payload and builds the envelope from it deterministically (via
 * `normalizeToEnvelopeShape`), skipping the render LLM. Artifacts are checked
 * in reverse insertion order so the agent's terminal output (the last step's
 * result) wins over any intermediate one. String artifacts are parsed the same
 * way a model response would be. Returns `undefined` when nothing is directly
 * renderable, so the caller falls back to the render-LLM path.
 */
function tryDirectEnvelope(artifacts: DataflowArtifacts): unknown | undefined {
  for (const raw of [...artifacts.values()].reverse()) {
    const candidate = coerceToObject(raw);
    if (candidate === undefined) continue;
    if (hasBlocksArray(candidate) || isFlatTablePayload(candidate)) {
      return normalizeToEnvelopeShape(candidate);
    }
  }
  return undefined;
}

/** An artifact value as a parsed object: objects pass through; strings are
 * parsed like a model response (fence-stripped); anything else is skipped. */
function coerceToObject(raw: unknown): unknown | undefined {
  if (typeof raw === "object" && raw !== null) return raw;
  if (typeof raw === "string") {
    try {
      return JSON.parse(extractJsonObjectText(raw));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function normalizeToEnvelopeShape(value: unknown): unknown {
  if (hasBlocksArray(value)) return value;
  if (!isFlatTablePayload(value)) return value;

  const { columns, rows, verified, summary, definition } = value;
  const blocks: Record<string, unknown>[] = [{ type: "table", columns, rows }];
  if (definition && typeof definition === "object") {
    const { sql, source_tables, filters } = definition as Record<string, unknown>;
    blocks.push({ type: "definition", sql, source_tables, filters });
  }

  return {
    blocks,
    ...(summary !== undefined ? { summary } : {}),
    ...(verified !== undefined ? { verified } : {}),
  };
}

const TABLE_ONLY_BLOCK_TYPES = new Set(["table", "definition"]);

/**
 * Extracts the set of block `type` consts an `output_schema` permits, by
 * walking `properties.blocks.items` — either a single item schema (e.g.
 * `explain_change`'s narrative-only shape) or an `anyOf` of several (e.g.
 * `answer_query`'s table/definition shape, or `generate_dashboard`'s
 * kpi_card/table/chart/definition shape). Each variant contributes its
 * `properties.type.const`, if it declares one.
 *
 * Returns `undefined` when the schema declares no `type` consts at all (e.g.
 * `explore_model`'s bare `{type: "object"}` item schema, which places no
 * constraint on block shape) — an unconstrained schema is deliberately never
 * treated as "table-only" by {@link isTableOnlySchema}, since there's no
 * actual evidence it only permits table/definition blocks.
 */
export function getAllowedBlockTypes(outputSchema: Record<string, unknown>): Set<string> | undefined {
  const items = extractBlocksItemsSchema(outputSchema);
  if (items === undefined) return undefined;

  const variants = Array.isArray(items.anyOf) ? (items.anyOf as unknown[]) : [items];
  const types = new Set<string>();
  for (const variant of variants) {
    if (!isPlainRecord(variant)) continue;
    const properties = variant.properties;
    if (!isPlainRecord(properties)) continue;
    const typeSchema = properties.type;
    if (isPlainRecord(typeSchema) && typeof typeSchema.const === "string") {
      types.add(typeSchema.const);
    }
  }
  return types.size > 0 ? types : undefined;
}

/**
 * True when `output_schema`'s `blocks.items` permits ONLY `table`/
 * `definition` block types — the `answer_query` shape, and the exact
 * precondition for applying `ToolTableSeed` (see `renderEnvelope`). An
 * unconstrained schema (`getAllowedBlockTypes` returns `undefined`) is never
 * table-only.
 */
export function isTableOnlySchema(outputSchema: Record<string, unknown>): boolean {
  const allowed = getAllowedBlockTypes(outputSchema);
  if (allowed === undefined) return false;
  for (const type of allowed) {
    if (!TABLE_ONLY_BLOCK_TYPES.has(type)) return false;
  }
  return true;
}

function extractBlocksItemsSchema(outputSchema: Record<string, unknown>): Record<string, unknown> | undefined {
  const properties = outputSchema.properties;
  if (!isPlainRecord(properties)) return undefined;
  const blocks = properties.blocks;
  if (!isPlainRecord(blocks)) return undefined;
  const items = blocks.items;
  return isPlainRecord(items) ? items : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasBlocksArray(value: unknown): value is { blocks: unknown[] } {
  return typeof value === "object" && value !== null && Array.isArray((value as Record<string, unknown>).blocks);
}

interface FlatTablePayload {
  readonly columns: unknown[];
  readonly rows: unknown[];
  readonly verified?: boolean | null;
  readonly summary?: string | null;
  readonly definition?: Record<string, unknown> | null;
}

function isFlatTablePayload(value: unknown): value is FlatTablePayload {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.columns) && Array.isArray(record.rows);
}

/**
 * Extracts a JSON object from a model's raw text response: strips
 * ```json …``` / ``` fences, trims surrounding prose, and locates the outer
 * `{ … }` object by its first `{` and matching last `}`. Throws (falls
 * through to `JSON.parse`'s own error) if no object-shaped substring is
 * found, so callers can treat "couldn't extract" and "extracted but invalid
 * JSON" the same way.
 */
function extractJsonObjectText(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new SyntaxError(`no JSON object found in model response: ${JSON.stringify(text.slice(0, 200))}`);
  }
  return candidate.slice(start, end + 1);
}

/**
 * Best-effort extraction of a {@link RenderEnvelope} from Mode B's raw
 * `finalText` — a CLI stdout string (`ModeBResult.finalText`), not a
 * structured artifact map the way Mode A's `executeAgent` output is. Mode B
 * has no dataflow-artifact scan or tool-outcome capture of its own (see
 * `runModeBDefault` — it only reads the dispatcher's terminal stdout line),
 * so this is the only signal available to build a `form: "rich"` answer from.
 *
 * The agent is expected to emit its final structured answer as a JSON
 * object, plain or ```json-fenced (the same contract the render model
 * itself follows — see `extractJsonObjectText`), in one of the shapes
 * {@link normalizeToEnvelopeShape} already reconciles:
 *  - already `{blocks: [...]}` (e.g. `generate_dashboard`) -> used as-is.
 *  - flat `{columns, rows, verified?, summary?, definition?}` (`answer_query`'s
 *    actual tool contract) -> reshaped into a `table` (+ `definition`) block.
 *  - an MCP `CallToolResult` (`{content: [{type:"text", text}], ...}` or
 *    `{structuredContent}`) -> unwrapped one level and the same rules
 *    re-applied to what's inside. This is a known trap (see the
 *    harness-tooltable-seed-dead follow-up): the real `query` MCP tool's raw
 *    result is this wrapper shape, not the flat one above, so an extractor
 *    that only checked for `{columns, rows}` would silently miss it.
 *
 * Returns `undefined` when nothing recognizable is found (not JSON at all,
 * or JSON that matches none of the above), so the caller can fall back to
 * `form: "text"` instead of fabricating an envelope.
 */
export function extractEnvelopeFromText(text: string): RenderEnvelope | undefined {
  let candidate: unknown;
  try {
    candidate = JSON.parse(extractJsonObjectText(text));
  } catch {
    return undefined;
  }
  return normalizeExtractedCandidate(candidate);
}

/** Bounded: at most one MCP `CallToolResult` unwrap, so a pathological/self-referential payload can't recurse forever. */
const MAX_UNWRAP_DEPTH = 2;

function normalizeExtractedCandidate(value: unknown, depth = 0): RenderEnvelope | undefined {
  if (hasBlocksArray(value)) return value as RenderEnvelope;
  if (isFlatTablePayload(value)) return normalizeToEnvelopeShape(value) as RenderEnvelope;
  if (depth >= MAX_UNWRAP_DEPTH) return undefined;

  const unwrapped = unwrapCallToolResult(value);
  return unwrapped === undefined ? undefined : normalizeExtractedCandidate(unwrapped, depth + 1);
}

/**
 * Unwraps one layer of an MCP `CallToolResult` (`{content, structuredContent,
 * isError}`) to the value inside — `structuredContent` when present,
 * otherwise the first `type: "text"` content item's own JSON (fence-stripped
 * the same way a model response is). Returns `undefined` for anything that
 * isn't recognizably this shape.
 */
function unwrapCallToolResult(value: unknown): unknown | undefined {
  if (!isPlainRecord(value)) return undefined;
  if (value.structuredContent !== undefined) return value.structuredContent;
  if (!Array.isArray(value.content)) return undefined;

  const textItem = value.content.find(
    (item): item is { type: "text"; text: string } =>
      isPlainRecord(item) && item.type === "text" && typeof item.text === "string",
  );
  if (textItem === undefined) return undefined;

  try {
    return JSON.parse(extractJsonObjectText(textItem.text));
  } catch {
    return undefined;
  }
}

/** Wraps the original prompt with a stricter instruction for the one bounded retry. */
function reformatPrompt(prompt: string): string {
  return (
    `${prompt}\n\nYour previous response could not be parsed as a single JSON object. ` +
    `Respond again with ONLY the JSON object — no prose, no markdown code fences.`
  );
}

function defaultRenderTier(agent: Agent): string {
  const independentSteps = agent.steps.filter((step) => step.realization.kind === "independent");
  const lastIndependent = independentSteps[independentSteps.length - 1];
  if (!lastIndependent) {
    throw new NoRenderTierError(agent.id);
  }
  return lastIndependent.tier;
}

/**
 * Renders every accumulated dataflow artifact plus `output_schema` into the
 * synthesis prompt. Since there's no SDK-level `responseFormat` doing the
 * asking for us (see `renderEnvelope`), the instruction to emit bare JSON
 * matching the schema — and nothing else — has to live in the prompt text.
 */
function buildEnvelopePrompt(
  agent: Agent,
  artifacts: DataflowArtifacts,
  userInput: string,
  outputSchema: Record<string, unknown>,
): string {
  const sections = [
    `User's question: ${userInput}`,
    `Synthesize the final structured answer for agent "${agent.id}" from the artifacts below.`,
  ];

  for (const [name, value] of artifacts) {
    sections.push(`${name}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
  }

  sections.push(
    `Respond with ONLY a single JSON object conforming to this JSON Schema — no prose, ` +
      `no markdown code fences, no explanation before or after it:\n${JSON.stringify(outputSchema)}`,
  );

  return sections.join("\n\n");
}
