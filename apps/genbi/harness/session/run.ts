import type { Bundle } from "../bundle/schema.js";
import { assertCapabilities } from "../capability/gate.js";
import type { CapabilityRegistry } from "../capability/registry.js";
import { createAgentEventEmitter } from "../events/index.js";
import type { AgentEvent, StepTrace, TraceStep } from "../events/index.js";
import { createLocalExecutionEnv, type ExecutionEnv } from "../exec/index.js";
import { deriveEnforcement } from "../guardrails/index.js";
import { executeAgent, summarizeToolOutput } from "../loop/index.js";
import type { GuardEvaluator } from "../loop/index.js";
import { getAllowedBlockTypes, renderEnvelope } from "../render/index.js";
import type { DashboardSeed, ToolTableSeed } from "../render/index.js";
import type { ProviderRegistry, TierBinding } from "../providers/index.js";
import type { McpServerConfigMap, NativeToolRegistry } from "../tools/index.js";
import { BUILD_DASHBOARD_TOOL_NAME, WREN_QUERY_TOOL_NAME, withResolvedTools } from "../tools/index.js";
import { UnknownAgentError } from "./errors.js";
import { findLockedGatedCheck } from "./gate.js";
import type { RunAgentResult } from "./types.js";

export interface RunAgentContext {
  readonly binding: TierBinding;
  readonly registry: ProviderRegistry;
  readonly capabilityRegistry: CapabilityRegistry;
  /** Runtime-injected MCP server connection config, keyed by server id. Defaults to `{}`. */
  readonly mcpServers?: McpServerConfigMap;
  readonly nativeTools?: NativeToolRegistry;
  /**
   * Backend native tools (e.g. `write_artifact`) execute side effects
   * through. Defaults to `createLocalExecutionEnv()` — the only backend
   * this milestone ships (no microVM/delegated/egress-proxy backend).
   */
  readonly executionEnv?: ExecutionEnv;
  /**
   * Egress allowlist merged into the guardrail-derived `EnforcementPolicy`
   * before it reaches `executionEnv`. The bundle format has no egress
   * guardrail in v1, so this is the only way to grant `fetch` access.
   * Defaults to no hosts allowed.
   */
  readonly allowedHosts?: readonly string[];
  /** Guard-eval seam threaded through to `executeAgent`. */
  readonly evaluateGuard?: GuardEvaluator;
  /** Overrides the render envelope stage's default tier selection (see `renderEnvelope`). */
  readonly renderTier?: string;
  /**
   * Live-event layer: optional sink for the run's `AgentEvent`s
   * (`run.start`/`step.*`/`tool.*`/`artifact`/`answer`/`refusal`/
   * `run.finish`/`error`). `runAgent` is the sole owner of `runId`/`seq`
   * bookkeeping for the run (via `createAgentEventEmitter`) — this callback
   * always receives fully-stamped events, exactly the contract's literal
   * `(e: AgentEvent) => void` shape. Omit to opt out of live events
   * entirely; the FLOOR `StepTrace` (`AnswerResult.trace`/
   * `RefusalResult.trace`) is always accumulated regardless.
   */
  readonly onEvent?: (event: AgentEvent) => void;
}

/**
 * The full `answer_query` walking-skeleton entry point: capability gate
 * (whole-bundle) -> resolve `agentId`'s tools -> run its dataflow
 * steps with repair-fold -> synthesize the two-stage render
 * envelope -> enforce any locked `gated_check` guardrail -> an
 * explicit `AnswerResult | RefusalResult`.
 *
 * MCP clients opened while resolving `agentId`'s tools are always torn down
 * (`withResolvedTools`'s `finally`), whether the run succeeds, the loop
 * throws (e.g. `RepairExhaustedError`), or the render stage throws (e.g. a
 * malformed model response failing `output_schema` validation) — in every
 * failure case the error propagates out of `runAgent` rather than being
 * swallowed into a refusal; only a *rendered but unverified* envelope
 * becomes a `RefusalResult`.
 */
export async function runAgent(
  bundle: Bundle,
  agentId: string,
  userInput: string,
  ctx: RunAgentContext,
): Promise<RunAgentResult> {
  assertCapabilities(bundle, ctx.capabilityRegistry);

  const agent = bundle.agents.find((candidate) => candidate.id === agentId);
  if (!agent) {
    throw new UnknownAgentError(agentId);
  }

  const emitter = createAgentEventEmitter(ctx.onEvent);
  emitter.emit({ kind: "run.start", mode: "A", agentId });

  try {
    const enforcementPolicy = {
      ...deriveEnforcement(agent),
      ...(ctx.allowedHosts !== undefined ? { allowedHosts: ctx.allowedHosts } : {}),
    };
    const executionEnv = ctx.executionEnv ?? createLocalExecutionEnv();

    const result = await withResolvedTools(
      agent,
      {
        ...(ctx.mcpServers !== undefined ? { mcpServers: ctx.mcpServers } : {}),
        ...(ctx.nativeTools !== undefined ? { nativeTools: ctx.nativeTools } : {}),
        executionEnv,
        enforcementPolicy,
      },
      async (tools): Promise<RunAgentResult> => {
        // Track whether the run had at least one *successful*
        // data-access tool call, independent of anything the render LLM
        // claims about itself. `requiresDataAccess` is capability-aware — an
        // agent that never declares a `sql_execution:*` capability (a
        // pure-render/no-data component) never sets this, so it can never be
        // forced to a refusal by this check.
        let sawSuccessfulDataAccessCall = false;
        const requiresDataAccess = agent.capabilities.some((entry) => entry.capability.startsWith("sql_execution:"));

        // Deterministic table capture: the most recent *successful* `query`
        // tool result, kept as a flat table payload (columns + positional
        // rows + the SQL that produced it). This is the agent's real data —
        // `renderEnvelope` builds the table/definition blocks straight from
        // it instead of asking the render model to re-emit structure it tends
        // to summarize away (leaving a bare `{type:"table"}`). The last
        // success wins because, in the answer_query flow, it is the query
        // whose rows are the answer.
        let toolTable: ToolTableSeed | undefined;

        // Deterministic dashboard-envelope capture: the most recent
        // *successful* `build_dashboard` tool result, kept as-is (it's
        // already a complete, ordered `{blocks}` envelope — see
        // `assembleDashboardBlocks`). Mirrors `toolTable`'s capture above;
        // the last success wins for the same reason. `renderEnvelope` prefers
        // this over `toolTable` (a dashboard's `{blocks}` result is strictly
        // more complete than a single incidental `query` call's flat table).
        let dashboardSeed: DashboardSeed | undefined;

        // The most recent data-access tool error (`query` or
        // `build_dashboard`), kept as a bounded summary so a non-gated
        // data-block agent (e.g. `generate_dashboard`) that never grounded
        // its answer can surface WHY, instead of rendering an empty,
        // ungrounded "verified" envelope. Last error wins.
        let lastDataAccessError: string | undefined;

        // The FLOOR: accumulated straight from the same
        // `onToolCallOutcome` firings the deterministic gate already consumes, zero new
        // emission infrastructure. Terminal-only, flat, ordered by fire order.
        const traceSteps: TraceStep[] = [];
        let ordinal = 0;

        const artifacts = await executeAgent(agent, {
          binding: ctx.binding,
          registry: ctx.registry,
          tools,
          userInput,
          ...(ctx.evaluateGuard !== undefined ? { evaluateGuard: ctx.evaluateGuard } : {}),
          onToolCallOutcome: (outcome) => {
            // Carry the tool's input and a compact detail (success
            // summary, or the error message) so the UI's work-log can expand
            // a step — especially useful for the SQL-repair retries, where
            // an errored `query` step should show the SQL it tried and why
            // it failed.
            // Both success + error detail go through summarizeToolOutput so the
            // persisted trace_json detail is bounded (200 chars) either way — an
            // error string is returned as-is (no quoting) then truncated, matching
            // the success path's cap rather than persisting an unbounded message.
            const detail =
              outcome.outcome === "success"
                ? summarizeToolOutput(outcome.output)
                : summarizeToolOutput(outcome.error);
            traceSteps.push({
              id: outcome.callId ?? `${outcome.tool}-${ordinal}`,
              tool: outcome.tool,
              outcome: outcome.outcome,
              ordinal,
              ...(outcome.input !== undefined ? { input: outcome.input } : {}),
              ...(detail !== undefined ? { detail } : {}),
            });
            ordinal += 1;
            if (outcome.tool === WREN_QUERY_TOOL_NAME && outcome.outcome === "success") {
              sawSuccessfulDataAccessCall = true;
              const seed = toToolTableSeed(outcome.output, outcome.input);
              if (seed !== undefined) toolTable = seed;
            }
            if (outcome.tool === BUILD_DASHBOARD_TOOL_NAME && outcome.outcome === "success") {
              const seed = toDashboardSeed(outcome.output);
              if (seed !== undefined) dashboardSeed = seed;
            }
            if (
              outcome.outcome === "error" &&
              (outcome.tool === WREN_QUERY_TOOL_NAME || outcome.tool === BUILD_DASHBOARD_TOOL_NAME)
            ) {
              lastDataAccessError = detail;
            }
          },
          onEvent: emitter.emit,
        });

        const envelope = await renderEnvelope(agent, artifacts, {
          binding: ctx.binding,
          registry: ctx.registry,
          userInput,
          ...(ctx.renderTier !== undefined ? { tier: ctx.renderTier } : {}),
          ...(toolTable !== undefined ? { toolTable } : {}),
          ...(dashboardSeed !== undefined ? { dashboardSeed } : {}),
        });

        const trace: StepTrace = { steps: traceSteps };
        const gatedCheck = findLockedGatedCheck(agent);

        // Earn `verified` from a real
        // successful data-access instead of relying solely on the render LLM's
        // self-attestation. A successful, non-erroring `query` (or, for a
        // dashboard, `build_dashboard`) execution IS the evidence the
        // deterministic gate requires; the render LLM (used for narrative-only
        // agents like `explain_change`) does not reliably self-attest
        // `verified: true`, so without this, a genuine successful query still
        // produced a spurious refusal. Agents with no successful data-access
        // call are unaffected — they still depend on (and can still fail) the
        // render LLM's self-attestation below.
        //
        // CAVEAT (accepted trade-off, single-query agents only, see
        // `isDashboardShaped` below): this is scoped to "the run had ANY
        // successful `query` call", so it overrides a render LLM's
        // `verified: false` regardless of WHY the model set it — including a
        // legitimate self-doubt that the answer doesn't match the data, not
        // only fabrication. The product meaning of `verified` here is
        // therefore "grounded in a real, successful data-access", not "the
        // model certifies its own interpretation".
        //
        // A DASHBOARD-SHAPED agent (`kpi_card`/`chart` permitted by
        // `output_schema` — i.e. `generate_dashboard`'s multi-panel,
        // `build_dashboard`-mediated assembly) is different in kind from a
        // single-query agent: it fans out to several independent panel
        // queries, so "any successful query somewhere in the run" says
        // nothing about whether the OTHER panels — or the dashboard assembly
        // itself — actually succeeded. A run where every panel query failed
        // but one incidental prior query succeeded must not be marked
        // verified with an empty/fabricated dashboard. Grounding for a
        // dashboard-shaped answer therefore requires the seed that actually
        // IS the answer: `dashboardSeed` (paired with a real successful
        // query, so a `build_dashboard` call carrying only fabricated panel
        // data doesn't count).
        //
        // Every other shape (table-only `answer_query`, narrative
        // `explain_change`, unconstrained `explore_model`) has exactly one
        // data-producing step, not several independent ones a dashboard fans
        // out to — so for those, "any real successful data-access call" is
        // sufficient evidence and keeps the original grounding rule.
        //
        // NOTE (deviation from the literal spec): the spec's literal
        // `seedBackedVerified` formula additionally credited "table-only
        // schema AND a captured `toolTable` seed". `toolTable` is populated
        // from `query`'s raw tool-result `output`, but `query` is resolved as
        // an MCP tool, whose tool-result `output` is the full MCP
        // `CallToolResult` (`{content, structuredContent, isError}`) — not the
        // flat `{columns, rows}` shape `toToolTableSeed` expects — so
        // `toolTable` is always `undefined` in practice for any real
        // MCP-backed `query` call, making that clause dead code today. Fixing
        // the unwrap was tried, but `toolTable` is *also* fed straight into
        // `renderEnvelope`'s own seed precedence (ranked above the
        // direct-artifact scan), so making it populate changed `answer_query`'s
        // rendered *content* (the raw, un-curated query dump winning over
        // `generate_sql`'s actual curated answer) — a regression outside this
        // fix's scope. The `isDashboardShaped` split below achieves the
        // same fix intent (stop trusting an incidental query for a
        // multi-panel dashboard) without that side effect.
        const outputSchema = agent.output_schema as Record<string, unknown>;
        const DATA_BLOCK_TYPES = new Set(["table", "kpi_card", "chart"]);
        const DASHBOARD_ONLY_BLOCK_TYPES = new Set(["kpi_card", "chart"]);
        const allowedBlockTypes = getAllowedBlockTypes(outputSchema);
        const producesDataBlocks =
          allowedBlockTypes !== undefined && [...allowedBlockTypes].some((t) => DATA_BLOCK_TYPES.has(t));
        const isDashboardShaped =
          allowedBlockTypes !== undefined && [...allowedBlockTypes].some((t) => DASHBOARD_ONLY_BLOCK_TYPES.has(t));

        const seedBackedVerified = isDashboardShaped
          ? dashboardSeed !== undefined && sawSuccessfulDataAccessCall
          : requiresDataAccess && sawSuccessfulDataAccessCall;

        const earnedVerified = seedBackedVerified;

        // Only ever ADD verified:true when earned — never force verified:false
        // onto an unearned envelope. The deterministic gates below (both the
        // pre-existing `gatedCheck` checks and the dashboard-grounding branch) decide
        // solely from `seedBackedVerified`/`sawSuccessfulDataAccessCall`, not
        // from `effectiveEnvelope.verified` — so forcing it false here would
        // only rob a refusal's returned envelope of the model's own (possibly
        // fabricated) self-attestation, which the test explicitly wants
        // preserved as evidence the gate doesn't trust it.
        const effectiveEnvelope = earnedVerified ? { ...envelope, verified: true } : envelope;

        if (gatedCheck && effectiveEnvelope.verified !== true) {
          return {
            kind: "refusal",
            reason:
              `agent "${agentId}" has a locked gated_check guardrail, but the rendered envelope's ` +
              `"verified" field was ${JSON.stringify(effectiveEnvelope.verified)} (must be exactly true)`,
            envelope: effectiveEnvelope,
            trace,
          };
        }

        // Deterministic gate invariant: a locked `gated_check`
        // guardrail must never be satisfied by the render LLM's self-attested
        // `verified: true` alone when the agent declares a data-access
        // capability (`sql_execution:*`, i.e. it needs the `query` tool to
        // answer honestly). A fabricating or confused model can assert
        // `verified: true` on a run where the `query` tool was never called,
        // or was called and only ever errored (including a
        // missing `wren` binary — every call throws, so zero successes are
        // recorded and this branch correctly forces a refusal instead of
        // trusting a possibly-fabricated `verified: true`). This check is
        // purely additive to the one above: honest runs that have a real
        // successful `query` call keep behaving exactly as before.
        if (gatedCheck && requiresDataAccess && !sawSuccessfulDataAccessCall) {
          return {
            kind: "refusal",
            reason:
              `agent "${agentId}" has a locked gated_check guardrail and declares a data-access ` +
              `capability ("sql_execution:*"), but the run had zero successful "${WREN_QUERY_TOOL_NAME}" ` +
              `tool calls — a self-attested "verified: true" cannot stand without at least one real, ` +
              `non-erroring data-access call (deterministic gate)`,
            envelope: effectiveEnvelope,
            trace,
          };
        }

        // A NON-gated data-block agent (e.g. generate_dashboard)
        // that requires data access but produced no real answer-data seed
        // never actually grounded its answer (build_dashboard was never
        // assembled, or every panel query failed). Rather than present an
        // empty, ungrounded envelope as an "answer", surface WHY — the last
        // data-access error — as a refusal. Gated agents (answer_query,
        // explain_change) are unaffected: their two refusal blocks above
        // already handle the unverified case.
        if (!gatedCheck && producesDataBlocks && requiresDataAccess && !seedBackedVerified) {
          return {
            kind: "refusal",
            reason: lastDataAccessError
              ? `Couldn't build a grounded result — the data query failed: ${lastDataAccessError}`
              : `Couldn't build a grounded result — the queried data was not assembled into an answer`,
            envelope: effectiveEnvelope,
            trace,
          };
        }

        return { kind: "answer", envelope: effectiveEnvelope, trace };
      },
    );

    if (result.kind === "answer") {
      emitter.emit({ kind: "answer", envelope: result.envelope });
      emitter.emit({ kind: "run.finish", status: "answer" });
    } else {
      emitter.emit({ kind: "refusal", reason: result.reason, envelope: result.envelope });
      emitter.emit({ kind: "run.finish", status: "refusal" });
    }
    return result;
  } catch (error) {
    emitter.emit({ kind: "error", message: describeRunError(error) });
    emitter.emit({ kind: "run.finish", status: "error" });
    throw error;
  }
}

function describeRunError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : JSON.stringify(error);
}

/**
 * Reshapes a successful `query` tool call into a {@link ToolTableSeed}: the
 * tool returns `{columns, rows}` with rows as column-keyed objects, but the
 * render table block wants positional rows aligned to `columns`. Returns
 * `undefined` for any output that isn't that shape (so a non-table tool, or a
 * malformed result, simply falls back to the normal render path). The SQL, if
 * the tool call's input carried it, becomes the definition block's `sql`.
 */
function toToolTableSeed(output: unknown, input: unknown): ToolTableSeed | undefined {
  if (typeof output !== "object" || output === null) return undefined;
  const { columns, rows } = output as Record<string, unknown>;
  if (!Array.isArray(columns) || !Array.isArray(rows)) return undefined;
  if (!columns.every((c) => typeof c === "string")) return undefined;

  const positionalRows = rows.map((row) =>
    row !== null && typeof row === "object"
      ? (columns as string[]).map((col) => (row as Record<string, unknown>)[col])
      : [row],
  );

  const sql =
    typeof input === "object" && input !== null && typeof (input as Record<string, unknown>).sql === "string"
      ? ((input as Record<string, unknown>).sql as string)
      : undefined;

  return {
    columns: columns as string[],
    rows: positionalRows,
    ...(sql !== undefined ? { sql } : {}),
  };
}

/**
 * Reshapes a successful `build_dashboard` tool call into a
 * {@link DashboardSeed}: the tool already returns `{blocks, summary?,
 * verified}` (see `assembleDashboardBlocks`), so this just narrows/validates
 * that shape defensively. Returns `undefined` for any output that isn't at
 * least `{blocks: array}` (so a malformed result simply falls back to the
 * normal render path instead of seeding garbage).
 */
function toDashboardSeed(output: unknown): DashboardSeed | undefined {
  if (typeof output !== "object" || output === null) return undefined;
  const { blocks, summary, verified } = output as Record<string, unknown>;
  if (!Array.isArray(blocks)) return undefined;

  return {
    blocks,
    ...(typeof summary === "string" ? { summary } : {}),
    ...(typeof verified === "boolean" ? { verified } : {}),
  };
}
