/**
 * Folds the harness's `AgentEvent`/`StepTrace` runtime types down
 * into the UI's `ToolStep[]` work-log shape and its terminal `SessionEvent`.
 *
 * Two paths:
 *  - Floor (always available): `RunAgentResult.trace` is populated
 *    unconditionally by `runAgent` regardless of whether `onEvent` is wired,
 *    so `foldTrace` alone is enough to produce one work-log snapshot even
 *    with no live event stream.
 *  - Live (best-effort): if the caller wires `onEvent`, `LiveWorkLog`
 *    accumulates an incrementally-growing `ToolStep[]` as `step.*`/`tool.*`
 *    events arrive, for a richer in-flight work log. Mode A never populates
 *    `parent`/`depth` today, so this never invents fake nesting — it only
 *    forwards whatever the runtime actually reports.
 */
import type { AgentEvent, RouteResult, StepTrace } from "../harness/index.js";
import { BUILD_DASHBOARD_TOOL_NAME, extractEnvelopeFromText, WREN_QUERY_TOOL_NAME } from "../harness/index.js";
import type { AnswerEvent, ArtifactEvent, ArtifactKind, RefusalEvent, ToolStep } from "./wire-types.js";

/**
 * Canned remediation text for a refusal. `RefusalAgentEvent`/`RefusalResult`
 * carry no remediation hint from the agent runtime — the UI's `fix` field is
 * synthesized here as a fixed, hand-written string.
 */
export const REFUSAL_FIX_HINT =
  "Ask a workspace admin to grant access, or rephrase the question to use an aggregate that does not expose restricted values.";

/** Floor path: one work-log snapshot from a resolved run's final `StepTrace`. */
export function foldTrace(trace: StepTrace): ToolStep[] {
  return trace.steps.map((step) => ({
    id: step.id,
    label: step.tool,
    state: step.outcome === "success" ? "done" : "error",
    kind: "tool" as const,
    // Carry the TraceStep's input/detail straight onto the ToolStep
    // so the UI can expand a step (e.g. a SQL-repair retry's errored `query`
    // step) to see what it ran and why it failed.
    ...(step.input !== undefined ? { input: step.input } : {}),
    ...(step.detail !== undefined ? { detail: step.detail } : {}),
  }));
}

/** Extracts the floor `StepTrace` from a route() result, if the backend produced one (Mode A only). */
export function extractTrace(result: RouteResult): StepTrace | undefined {
  return result.backend === "agent" ? result.trace : undefined;
}

/**
 * Maps a resolved route() result to the UI's terminal answer/refusal event
 * (id assigned by the caller).
 *
 * Mode B (`backend: "agent-sdk"`) has no structured `RenderEnvelope` of its
 * own — `runModeBDefault` only returns the dispatcher's final stdout text
 * (`finalText`) — but the dispatched agent still emits its final structured
 * answer as a (possibly fenced) JSON envelope inside that text (this was the
 * root cause of the bug this handles: that envelope was previously dropped
 * on the floor and the raw text always went out as `form: "text"`,
 * `verified: false`). `extractEnvelopeFromText` recovers it — including
 * `answer_query`'s flat `{columns, rows}` tool-contract shape, normalized
 * into a `table` block — and `verified` is whatever the recovered envelope
 * actually carries, never hardcoded. Only when no envelope can be recovered
 * at all does the raw text fall back to `form: "text"`.
 *
 * That `form: "text"` fallback is the one case where "verified: false" is
 * ambiguous between two very different situations: a pure conversational
 * reply (no data claim at all — the UI should hide the badge) and a data
 * task that ran but whose result the model chose not to render as an
 * envelope (the UI should still show "Unverified" — that's meaningful).
 * `worklog` (the turn's already-folded `ToolStep[]`, live or floor) is
 * inspected for a data-access tool call to disambiguate the two; schema
 * introspection and artifact-saving tool calls don't count as a data claim.
 */
export function toAnswerOrRefusalEvent(
  id: string,
  result: RouteResult,
  worklog: readonly ToolStep[] = [],
): AnswerEvent | RefusalEvent {
  if (result.backend === "agent-sdk") {
    const envelope = extractEnvelopeFromText(result.finalText);
    if (envelope !== undefined) {
      return { id, kind: "answer", answer: { form: "rich", envelope } };
    }
    return {
      id,
      kind: "answer",
      answer: { form: "text", text: result.finalText, verified: false, dataAnswer: attemptedDataAccess(worklog) },
    };
  }
  if (result.kind === "answer") {
    return { id, kind: "answer", answer: { form: "rich", envelope: result.envelope } };
  }
  return { id, kind: "refusal", reason: result.reason, fix: REFUSAL_FIX_HINT };
}

/** Mode A's native in-process tool names that constitute an actual data claim — schema browsing / artifact saving don't count. */
const DATA_ACCESS_TOOL_NAMES = new Set<string>([WREN_QUERY_TOOL_NAME, BUILD_DASHBOARD_TOOL_NAME]);

/**
 * Mode B never produces those native tool names — the dispatched agent's `answer_query`/
 * `generate_dashboard` components are only granted the SDK's built-in `Bash` tool and run all
 * data access through the `wren` CLI's read-path, always shaped `wren -q -o json -s '<SQL>'` (see
 * the warble hub components' `generate_sql.md`/`repair_sql.md`/`compose_layout.md` steps). Schema
 * introspection (`wren context show`, `wren cube list`, `wren cube describe <cube>`) is also a
 * bare `wren` Bash call but never carries the `-q`/`-s` flags, so it's excluded here.
 */
const WREN_QUERY_FLAG = /(?:^|\s)-q(?:\s|$)/;
const WREN_SQL_FLAG = /(?:^|\s)-s(?:\s|$)/;

function isWrenQueryCommand(command: string): boolean {
  return /^\s*wren\b/.test(command) && WREN_QUERY_FLAG.test(command) && WREN_SQL_FLAG.test(command);
}

/** The Bash tool's input carries the shell command under `command` (confirmed by warble's own `canUseTool` guardrail). */
function bashCommandOf(step: ToolStep): string | undefined {
  const input = step.input;
  if (typeof input !== "object" || input === null) return undefined;
  const command = (input as Record<string, unknown>)["command"];
  return typeof command === "string" ? command : undefined;
}

/**
 * Whether the turn's work log shows a real data-access attempt, success or failure alike — either
 * a Mode A native query/dashboard tool call, or a Mode B `Bash` call that actually ran a query
 * through the `wren` CLI (as opposed to schema introspection, which doesn't count as a data claim).
 */
function attemptedDataAccess(worklog: readonly ToolStep[]): boolean {
  return worklog.some((step) => {
    if (step.kind !== "tool") return false;
    if (DATA_ACCESS_TOOL_NAMES.has(step.label)) return true;
    if (step.label !== "Bash") return false;
    const command = bashCommandOf(step);
    return command !== undefined && isWrenQueryCommand(command);
  });
}

/** Maps a `RunFinishEvent`'s companion `ArtifactAgentEvent` straight through — no BFF-side transformation needed. */
export function toArtifactEvent(id: string, name: string, artifactKind: ArtifactKind, location: string, artifactId: string): ArtifactEvent {
  return { id, kind: "artifact", name, artifactKind, location, artifactId };
}

// ---------------------------------------------------------------------------
// Deterministic control-flow DECISIONS as display-only work-log
// entries. These do NOT come from the agent runtime and never affect the
// deterministic gate/result — they only make the BFF's own routing/clarify/
// verify-gate choices visible in the session. Stable ids let re-emitted live
// frames dedupe them by id like any other step.
// ---------------------------------------------------------------------------

export const DECISION_ROUTE_ID = "decision-route";
export const DECISION_CLARIFY_ID = "decision-clarify";
export const DECISION_GATE_ID = "decision-gate";

/** The intent-routing decision — always prepended to a turn's work log. */
export function routeDecisionStep(agentId: string, reason: string): ToolStep {
  return { id: DECISION_ROUTE_ID, kind: "decision", label: "Route", state: "done", detail: `→ ${agentId}: ${reason}` };
}

/** The clarify decision — only present when the turn short-circuits to a clarify prompt. */
export function clarifyDecisionStep(detail: string): ToolStep {
  return { id: DECISION_CLARIFY_ID, kind: "decision", label: "Clarify", state: "done", detail };
}

/**
 * The trailing verify-gate verdict, derived from the resolved `route()` result:
 *  - a verified ANSWER (`envelope.verified === true`) -> a "done" verdict;
 *  - a REFUSAL -> an "error" verdict carrying the refusal reason;
 *  - a non-verified answer (or Mode B, which has no envelope/verify signal)
 *    -> `undefined`, so no gate entry is appended.
 */
export function gateDecisionStep(result: RouteResult): ToolStep | undefined {
  if (result.backend === "agent-sdk") return undefined;
  if (result.kind === "refusal") {
    return { id: DECISION_GATE_ID, kind: "decision", label: "Verify gate", state: "error", detail: result.reason };
  }
  if (result.envelope.verified === true) {
    return { id: DECISION_GATE_ID, kind: "decision", label: "Verify gate", state: "done", detail: "verified — grounded in a successful data-access" };
  }
  return undefined;
}

/**
 * A failure verdict for a turn whose execution THREW (the error path) — appended
 * to the partial work log so a failed turn's persisted trace ends with why it
 * failed. Detail is the bounded error message.
 */
export function gateFailureStep(errorMessage: string): ToolStep {
  return { id: DECISION_GATE_ID, kind: "decision", label: "Verify gate", state: "error", detail: truncate(errorMessage, SUMMARY_MAX_LENGTH) };
}

const SUMMARY_MAX_LENGTH = 240;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Short text used for `turns.answer_summary` — feeds `server/compose.ts`'s D3 context composition. Never the full envelope. */
export function summarizeResult(result: RouteResult): string {
  if (result.backend === "agent-sdk") return truncate(result.finalText, SUMMARY_MAX_LENGTH);
  if (result.kind === "answer") {
    const summary = result.envelope.summary;
    return truncate(typeof summary === "string" && summary.length > 0 ? summary : JSON.stringify(result.envelope.blocks), SUMMARY_MAX_LENGTH);
  }
  return truncate(`Refused: ${result.reason}`, SUMMARY_MAX_LENGTH);
}

type LiveStepKind = ToolStep["kind"];

/**
 * Live path accumulator: call `ingest` for each `AgentEvent` as it arrives
 * from `onEvent`; each call returns a fresh immutable snapshot of the
 * work log so far, or `undefined` for event kinds that don't affect it
 * (`run.start`, `token`, `answer`, `refusal`, `artifact`, `run.finish`,
 * `error` — those are terminal/non-worklog events handled elsewhere).
 */
export class LiveWorkLog {
  private readonly order: string[] = [];
  private readonly steps = new Map<string, ToolStep>();

  ingest(event: AgentEvent): ToolStep[] | undefined {
    switch (event.kind) {
      case "step.start":
        // Mode A has no sub-agent/Task mechanism (see this module's
        // doc comment) — its bundle-declared LLM steps are plain steps, kind
        // "step", not "subagent" (that kind stays reserved for a real nested
        // sub-agent turn, which only Mode B could ever produce).
        this.upsert(event.stepId, event.name, "running", "step", event.parent, event.depth);
        return this.snapshot();
      case "step.finish":
        // Detail is the step's own reasoning/output — the text it
        // produced (on success) or the best available error description —
        // already bounded at the emission site (`harness/loop/executor.ts`).
        this.setState(event.stepId, event.status === "ok" ? "done" : "error", event.detail);
        return this.snapshot();
      case "tool.call":
        // Capture the tool call's input at start time — `tool.result`
        // carries no input of its own, only a `summary`/`error`.
        this.upsert(event.callId, event.tool, "running", "tool", event.parent, event.depth, event.input);
        return this.snapshot();
      case "tool.result": {
        // Detail is the success summary, or the error message on
        // failure — both already bounded/compact at the emission site
        // (`summarizeToolOutput` / `describeError` in `harness/loop/executor.ts`).
        const detail = event.status === "success" ? event.summary : event.error;
        this.setState(event.callId, event.status === "success" ? "done" : "error", detail);
        return this.snapshot();
      }
      default:
        return undefined;
    }
  }

  snapshot(): ToolStep[] {
    return this.order.map((id) => {
      const step = this.steps.get(id);
      if (!step) throw new Error(`LiveWorkLog: missing step for id "${id}"`);
      return step;
    });
  }

  private upsert(
    id: string,
    label: string,
    state: ToolStep["state"],
    kind: LiveStepKind,
    parent: string | undefined,
    depth: number | undefined,
    input?: unknown,
  ): void {
    if (!this.steps.has(id)) this.order.push(id);
    const step: ToolStep = {
      id,
      label,
      state,
      kind,
      ...(parent !== undefined ? { parent } : {}),
      ...(depth !== undefined ? { depth } : {}),
      ...(input !== undefined ? { input } : {}),
    };
    this.steps.set(id, step);
  }

  private setState(id: string, state: ToolStep["state"], detail?: string): void {
    const existing = this.steps.get(id);
    if (!existing) return; // event for a step we never saw start — ignore rather than fabricate
    this.steps.set(id, { ...existing, state, ...(detail !== undefined ? { detail } : {}) });
  }
}
