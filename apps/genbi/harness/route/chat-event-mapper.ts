/**
 * Mode B's own mapping FROM warble's `chat --stream-json` NDJSON stream TO this harness's
 * mode-agnostic `AgentEvent` union (`harness/events/types.ts`). Two things live here:
 *
 *  - `WarbleChatEventLike` — a LOCAL structural mirror of warble's own `WarbleChatEvent` vocabulary
 *    (`dispatcher/claude-agent-sdk/src/events.ts` in the warble repo). It is intentionally NOT
 *    imported from warble: warble is a separate process/package this harness only ever talks to
 *    over a subprocess's stdout, never a library dependency, so the wire contract is re-declared
 *    here by hand rather than crossing that boundary with a type import. Keep it in sync with
 *    warble's vocabulary if that ever changes.
 *  - `mapChatEventToAgentEvent` — a PURE function turning one parsed `WarbleChatEventLike` plus a
 *    small piece of running state (the current enclosing step id, and callId/stepId -> name
 *    memory) into zero or one `AgentEventInput`. Pure so it's unit-testable with plain data, no
 *    process/stream involved.
 *
 * Step/tool id mapping: warble's own mapper emits ONE enclosing `step_start` per turn (id = the
 * dispatched component's verb) and groups every `tool_call`/`tool_result` under it — see that
 * module's doc comment for why. This function carries that same single `stepId` forward onto
 * every `tool.call`/`tool.result` it produces (`ToolCallEvent`/`ToolResultEvent` both require a
 * `stepId`), tracked in `state.currentStepId` as `step_start` events arrive.
 *
 * `answer` is deliberately mapped to `undefined` — the turn's final answer text is handled by the
 * caller (`runModeBDefault`'s existing `answer`/`run.finish` emission), not duplicated here. `session`
 * is likewise mapped to `undefined` for the same reason: it is session-resume metadata (the SDK's
 * `session_id`, forwarded on both a successful AND a failed/`error_max_turns` turn), not a work-log
 * event, and `spawnChat` intercepts it directly rather than routing it through this mapper.
 */
import type { AgentEventInput } from "../events/index.js";

export type WarbleChatEventLike =
  | {
      readonly t: "step_start";
      readonly id: string;
      readonly name: string;
      readonly parent: string | null;
      readonly depth: number;
    }
  | {
      readonly t: "step_finish";
      readonly id: string;
      readonly ok: boolean;
      readonly detail?: string;
    }
  | {
      readonly t: "tool_call";
      readonly id: string;
      readonly name: string;
      readonly input?: unknown;
      readonly parent: string | null;
      readonly depth: number;
    }
  | {
      readonly t: "tool_result";
      readonly id: string;
      readonly ok: boolean;
      readonly summary?: string;
      readonly error?: string;
    }
  | {
      readonly t: "answer";
      readonly text: string;
    }
  | {
      /**
       * The turn's SDK session id (multi-turn resume anchor), emitted once per turn by
       * `warble-agent-sdk chat --stream-json` on success AND on a failed turn (e.g.
       * `error_max_turns`) — mirrors warble's own `WarbleChatEvent`'s `session` variant
       * (`dispatcher/claude-agent-sdk/src/events.ts`). `id` is null only if the SDK never
       * produced a session id at all.
       */
      readonly t: "session";
      readonly id: string | null;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

/**
 * Parse + structurally validate one NDJSON line from `warble-agent-sdk chat --stream-json`.
 * Returns `undefined` for a blank line, invalid JSON, or a shape that doesn't match any known
 * `WarbleChatEventLike` variant — the caller drops such lines rather than failing the whole turn
 * over one malformed/forward-incompatible line.
 */
export function parseWarbleChatEventLine(line: string): WarbleChatEventLike | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) return undefined;

  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (!isRecord(raw) || typeof raw["t"] !== "string") return undefined;

  switch (raw["t"]) {
    case "step_start":
      if (
        typeof raw["id"] === "string" &&
        typeof raw["name"] === "string" &&
        isStringOrNull(raw["parent"]) &&
        typeof raw["depth"] === "number"
      ) {
        return { t: "step_start", id: raw["id"], name: raw["name"], parent: raw["parent"], depth: raw["depth"] };
      }
      return undefined;
    case "step_finish":
      if (typeof raw["id"] === "string" && typeof raw["ok"] === "boolean") {
        return {
          t: "step_finish",
          id: raw["id"],
          ok: raw["ok"],
          ...(typeof raw["detail"] === "string" ? { detail: raw["detail"] } : {}),
        };
      }
      return undefined;
    case "tool_call":
      if (
        typeof raw["id"] === "string" &&
        typeof raw["name"] === "string" &&
        isStringOrNull(raw["parent"]) &&
        typeof raw["depth"] === "number"
      ) {
        return {
          t: "tool_call",
          id: raw["id"],
          name: raw["name"],
          ...(raw["input"] !== undefined ? { input: raw["input"] } : {}),
          parent: raw["parent"],
          depth: raw["depth"],
        };
      }
      return undefined;
    case "tool_result":
      if (typeof raw["id"] === "string" && typeof raw["ok"] === "boolean") {
        return {
          t: "tool_result",
          id: raw["id"],
          ok: raw["ok"],
          ...(typeof raw["summary"] === "string" ? { summary: raw["summary"] } : {}),
          ...(typeof raw["error"] === "string" ? { error: raw["error"] } : {}),
        };
      }
      return undefined;
    case "answer":
      if (typeof raw["text"] === "string") return { t: "answer", text: raw["text"] };
      return undefined;
    case "session":
      if (isStringOrNull(raw["id"])) return { t: "session", id: raw["id"] };
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Running state threaded across a turn's whole NDJSON stream. `currentStepId` is warble's single
 * enclosing step for the turn (set on `step_start`); `stepNames`/`toolNames` remember the
 * human-readable name for a given step/call id so a later `step_finish`/`tool_result` — which
 * carry no name of their own in warble's vocabulary — can still populate `StepFinishEvent.name` /
 * `ToolResultEvent.tool`.
 */
export interface ChatEventMapperState {
  currentStepId: string | undefined;
  readonly stepNames: Map<string, string>;
  readonly toolNames: Map<string, string>;
}

export function createChatEventMapperState(): ChatEventMapperState {
  return { currentStepId: undefined, stepNames: new Map(), toolNames: new Map() };
}

/** `AgentEvent.parent` is `string | undefined`; warble's own `parent` field is `string | null`. */
function toOptionalParent(parent: string | null): { parent?: string } {
  return parent !== null ? { parent } : {};
}

/**
 * Maps one parsed warble chat event to the harness's `AgentEvent` vocabulary, mutating `state` as
 * it goes (remembering step/tool names, tracking the current enclosing step). Returns `undefined`
 * for `answer` (handled by the caller) and for a `tool_call`/`tool_result` this mapper cannot
 * place under any known step — that should never happen given warble always opens its enclosing
 * step before emitting a tool event, but falling back to the raw id rather than throwing keeps a
 * single malformed/reordered line from crashing an otherwise-healthy live stream.
 */
export function mapChatEventToAgentEvent(
  raw: WarbleChatEventLike,
  state: ChatEventMapperState,
): AgentEventInput | undefined {
  switch (raw.t) {
    case "step_start": {
      state.currentStepId = raw.id;
      state.stepNames.set(raw.id, raw.name);
      return {
        kind: "step.start",
        stepId: raw.id,
        name: raw.name,
        // Mode B's NDJSON stream carries no per-step tier info (warble doesn't expose it in
        // `WarbleChatEvent`); `LiveWorkLog.ingest` never reads `tier` when folding to `ToolStep`,
        // so this placeholder has no observable effect on the UI's work log.
        tier: "unknown",
        ...toOptionalParent(raw.parent),
        depth: raw.depth,
      };
    }
    case "step_finish": {
      const name = state.stepNames.get(raw.id) ?? raw.id;
      // Clear the current step once it closes so any stray tool event arriving after it falls back
      // to its own id rather than being attributed to the already-finished step.
      if (state.currentStepId === raw.id) state.currentStepId = undefined;
      return {
        kind: "step.finish",
        stepId: raw.id,
        name,
        status: raw.ok ? "ok" : "error",
        ...(raw.detail !== undefined ? { detail: raw.detail } : {}),
      };
    }
    case "tool_call": {
      state.toolNames.set(raw.id, raw.name);
      const stepId = state.currentStepId ?? raw.id;
      return {
        kind: "tool.call",
        stepId,
        callId: raw.id,
        tool: raw.name,
        ...(raw.input !== undefined ? { input: raw.input } : {}),
        ...toOptionalParent(raw.parent),
        depth: raw.depth,
        status: "running",
      };
    }
    case "tool_result": {
      const tool = state.toolNames.get(raw.id) ?? raw.id;
      const stepId = state.currentStepId ?? raw.id;
      return {
        kind: "tool.result",
        stepId,
        callId: raw.id,
        tool,
        status: raw.ok ? "success" : "error",
        ...(raw.ok ? (raw.summary !== undefined ? { summary: raw.summary } : {}) : {}),
        ...(!raw.ok && raw.error !== undefined ? { error: raw.error } : {}),
      };
    }
    case "answer":
      return undefined;
    case "session":
      // Session metadata, not a work-log event — the caller (`spawnChat`) intercepts this line
      // directly (mirroring its existing `t === "answer"` interception) rather than routing it
      // through here.
      return undefined;
  }
}
