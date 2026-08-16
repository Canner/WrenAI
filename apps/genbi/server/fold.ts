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
  if (result.backend === "agent-sdk" || result.backend === "codex-local") {
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
const DATA_ACCESS_TOOL_NAMES = new Set<string>([
  WREN_QUERY_TOOL_NAME,
  BUILD_DASHBOARD_TOOL_NAME,
  "wren.run_sql",
]);

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
  if (result.backend === "agent-sdk" || result.backend === "codex-local") return undefined;
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

/**
 * A BFF-owned setup-contract rejection. This deliberately reuses the
 * established `ToolStep.kind: "decision"` wire shape, so the frontend can
 * render recovery evidence without an SSE schema addition.
 */
export function hostContractRecoveryStep(detail: string): ToolStep {
  return {
    id: "decision-host-contract-recovery",
    kind: "decision",
    label: "Host contract",
    state: "error",
    detail: truncate(detail, SUMMARY_MAX_LENGTH),
  };
}

const SETUP_INTERNAL_DIAGNOSTIC = /["']?(?:resume[_-]?session(?:[_-]?id)?|sdk[_-]?session(?:[_-]?id)?|session[_-]?id|anchor|runner(?:[_-]?path)?|dispatcher|provider(?:[_-]?name)?)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}\]]+)/gi;
const SETUP_PROVIDER_NAME = /\b(?:openai|anthropic|gemini|claude|codex)\b/gi;
const SETUP_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`<>()\[\]{}]+/gi;
const SETUP_ABSOLUTE_PATH = /(^|[\s"'`=:(\[,])(?:(?:~|\/)\/?|[A-Za-z]:\\)[^\s"'`;,)}\]]*/g;
// JSON is frequently echoed after one or more serialization passes. Limit
// escaped-quote depth so hostile traces cannot trigger unbounded regex work.
const SETUP_ESCAPED_CREDENTIAL = /\b([a-z0-9_.-]*(?:password|pass|secret|token|api[-_]?key|credential)[a-z0-9_.-]*)(?:\\{1,4})?["']?\s*(?::|=)\s*(?:\[REDACTED(?:_URL|_PATH)?\]|(?:\\{1,4})?["']?[^\s,;)}\]]+)/gi;
const SETUP_ANSI = /\u001b(?:\][\s\S]*?(?:\u0007|\u001b\\)|[PX^_][\s\S]*?\u001b\\|\[[0-?]*[ -/]*[@-~]|[@-_])/g;
const SETUP_C1_ANSI = /\u009b[0-?]*[ -/]*[@-~]/g;
const SETUP_CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const SETUP_FIELD_MAX_LENGTH = 160;
const SETUP_INSPECTION_MAX_LENGTH = 512;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Removes terminal escapes and other controls before any setup text crosses a public boundary. */
function stripSetupControls(text: string): string {
  return text.replace(SETUP_ANSI, "").replace(SETUP_C1_ANSI, "").replace(SETUP_CONTROL, " ");
}

/** Redacts URLs, credentials, and arbitrary local absolute paths from setup text. */
export function redactSetupText(text: string): string {
  return stripSetupControls(text)
    // A URL can contain credentials, local paths, query strings, or opaque
    // provider identifiers. Preserve none of it in a setup work log.
    .replace(SETUP_URL, "[REDACTED_URL]")
    .replace(/((?:--user|-u)\s+)(?:\[REDACTED(?:_URL|_PATH)?\]|'[^']*'|\"[^\"]*\"|\S+)/gi, "$1[REDACTED]")
    .replace(SETUP_ESCAPED_CREDENTIAL, "$1=[REDACTED]")
    .replace(/\b([a-z0-9_.-]*(?:password|pass|secret|token|api[-_]?key|credential)[a-z0-9_.-]*["']?)\s*(?:=|:)\s*(?:\[REDACTED(?:_URL|_PATH)?\]|'[^']*'|\"[^\"]*\"|[^\s,;)}\]]+)/gi, "$1=[REDACTED]")
    .replace(/\b((?:proxy-)?authorization\s*:\s*(?:bearer|basic)\s+)(?:\[REDACTED(?:_URL|_PATH)?\]|'[^']*'|\"[^\"]*\"|[^\s,;]+)/gi, "$1[REDACTED]")
    .replace(/\b((?:x[-_])?api[-_]?key\s*:\s*)(?:\[REDACTED(?:_URL|_PATH)?\]|'[^']*'|\"[^\"]*\"|[^\s,;]+)/gi, "$1[REDACTED]")
    .replace(/(--?(?:password|pass|secret|token|api[-_]?key|credential)(?:=|\s+))(?:\[REDACTED(?:_URL|_PATH)?\]|'[^']*'|\"[^\"]*\"|\S+)/gi, "$1[REDACTED]")
    .replace(/(^|\s)((?:export\s+)?(?:[A-Z][A-Z0-9_]*(?:PASSWORD|PASS|SECRET|TOKEN|API_KEY|CREDENTIAL)[A-Z0-9_]*|PASSWORD|PASS|SECRET|TOKEN|API_KEY|CREDENTIAL))\s+(?:\[REDACTED(?:_URL|_PATH)?\]|'[^']*'|\"[^\"]*\"|\S+)/gim, "$1$2=[REDACTED]")
    .replace(/((?:--user|-u)\s+)(?:'[^']*'|\"[^\"]*\"|\S+)/gi, "$1[REDACTED]")
    .replace(SETUP_ABSOLUTE_PATH, "$1[REDACTED_PATH]");
}

/** Strict public setup diagnostic redaction shared by SSE, SQLite, and recovery. */
export function redactPublicSetupText(text: string, internalValues: readonly string[] = []): string {
  let publicText = redactSetupText(text)
    .replace(SETUP_INTERNAL_DIAGNOSTIC, "internal setup detail [REDACTED]")
    .replace(SETUP_PROVIDER_NAME, "[REDACTED]");
  for (const value of internalValues) {
    if (value.length > 0) publicText = publicText.replace(new RegExp(escapeRegExp(value), "gi"), "[REDACTED]");
  }
  return publicText;
}

/** Truncates by Unicode code point, never leaving a dangling UTF-16 surrogate. */
function truncateCodePoints(text: string, max: number): string {
  const codePoints = Array.from(text);
  return codePoints.length > max ? `${codePoints.slice(0, Math.max(0, max - 1)).join("")}…` : text;
}

/** Strict formatter for every runtime-controlled Setup work-log string field. */
function formatSetupField(value: string, internalValues: readonly string[], max = SETUP_FIELD_MAX_LENGTH): string {
  return truncateCodePoints(redactPublicSetupText(value, internalValues), max);
}

function boundedInspectionText(value: string, internalValues: readonly string[]): string {
  return formatSetupField(value, internalValues, SETUP_INSPECTION_MAX_LENGTH);
}

function setupActionSummary(input: unknown, internalValues: readonly string[]): string | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
  const action = (input as Record<string, unknown>).command ?? (input as Record<string, unknown>).action;
  return typeof action === "string" && action.length > 0 ? boundedInspectionText(action, internalValues) : undefined;
}

function setupDuration(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 86_400_000 ? value : undefined;
}

function setupInspection(row: Record<string, unknown>, state: ToolStep["state"], internalValues: readonly string[]): ToolStep["inspection"] | undefined {
  const prior = typeof row.inspection === "object" && row.inspection !== null && !Array.isArray(row.inspection)
    ? row.inspection as Record<string, unknown>
    : {};
  const action = setupActionSummary(row.input, internalValues)
    ?? (typeof prior.action === "string" ? boundedInspectionText(prior.action, internalValues) : undefined);
  const detail = typeof row.detail === "string"
    ? boundedInspectionText(row.detail, internalValues)
    : state === "error"
      ? typeof prior.error === "string" ? boundedInspectionText(prior.error, internalValues) : undefined
      : typeof prior.output === "string" ? boundedInspectionText(prior.output, internalValues) : undefined;
  const durationMs = setupDuration(row.durationMs) ?? setupDuration(prior.durationMs);
  const inspection = {
    ...(action !== undefined ? { action } : {}),
    ...(detail !== undefined && state === "error" ? { error: detail } : {}),
    ...(detail !== undefined && state !== "error" ? { output: detail } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
  return Object.keys(inspection).length > 0 ? inspection : undefined;
}

/**
 * Explicit, strict public worklog allowlist shared by all Setup boundaries.
 * Raw agent `input` and `detail` never cross this boundary: the BFF derives a
 * bounded inspection projection instead, so reload/recovery cannot revive a
 * broader historical trace.
 */
export function sanitizePublicSetupWorklog(value: unknown, internalValues: readonly string[] = []): ToolStep[] {
  if (!Array.isArray(value)) return [];
  const states = new Set<ToolStep["state"]>(["running", "done", "error"]);
  const kinds = new Set<ToolStep["kind"]>(["tool", "subagent", "step", "decision"]);
  return value.flatMap((entry): ToolStep[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.label !== "string" || !states.has(row.state as ToolStep["state"]) || !kinds.has(row.kind as ToolStep["kind"])) return [];
    const inspection = setupInspection(row, row.state as ToolStep["state"], internalValues);
    return [{
      id: formatSetupField(row.id, internalValues),
      label: formatSetupField(row.label, internalValues),
      state: row.state as ToolStep["state"],
      kind: row.kind as ToolStep["kind"],
      ...(typeof row.parent === "string" ? { parent: formatSetupField(row.parent, internalValues) } : {}),
      ...(typeof row.depth === "number" && Number.isSafeInteger(row.depth) && row.depth >= 0 && row.depth <= 16 ? { depth: row.depth } : {}),
      ...(inspection !== undefined ? { inspection } : {}),
    }];
  });
}

/**
 * Live-frame variant of `sanitizePublicSetupWorklog`, for a subscription-mode
 * setup turn's in-flight progress stream (see `server/turn.ts`'s
 * `executeSetupTurn`). The end-of-turn snapshot can redact by KNOWN VALUE —
 * `sanitizePublicSetupWorklog(..., knownInternalValues)` — once an attempt has
 * actually returned its session anchor. A live frame can't: the anchor a
 * rotating subscription attempt will settle on isn't known until it resolves
 * or throws, so falling back to by-SHAPE redaction (this module's
 * `SETUP_INTERNAL_DIAGNOSTIC`/`SETUP_PROVIDER_NAME`
 * patterns) is the only option that can run before then.
 *
 * That fallback is a genuine, accepted weakening: a pattern only catches an
 * anchor that looks the way these patterns anticipate, not any anchor shape a
 * future provider might introduce. To bound that risk, this also drops raw
 * `input`/`detail` and the derived `inspection` outright rather than merely
 * redacting them — a step's raw tool input or diagnostic text is exactly where
 * an unanticipated anchor shape would hide, and a field never sent cannot
 * leak. `WorkLog.tsx` only needs `label`/`state`/`kind`/`parent`/`depth` to
 * render progress; a step becomes expandable with its safe inspection
 * projection once the end-of-turn snapshot replaces this live one.
 */
export function sanitizeLiveSetupWorklog(worklog: readonly ToolStep[]): ToolStep[] {
  return sanitizePublicSetupWorklog(worklog).map(({ input, detail, inspection, ...rest }) => rest);
}

const SUMMARY_MAX_LENGTH = 240;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Short text used for `turns.answer_summary` — feeds `server/compose.ts`'s D3 context composition. Never the full envelope. */
export function summarizeResult(result: RouteResult): string {
  if (result.backend === "agent-sdk" || result.backend === "codex-local") {
    return truncate(result.finalText, SUMMARY_MAX_LENGTH);
  }
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
        if (event.input !== undefined) this.setInput(event.callId, event.input);
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

  private setInput(id: string, input: unknown): void {
    const existing = this.steps.get(id);
    if (!existing) return;
    this.steps.set(id, { ...existing, input });
  }
}
