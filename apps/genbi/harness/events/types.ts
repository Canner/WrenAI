import type { RenderEnvelope } from "../render/index.js";

/**
 * The mode-agnostic, back-end-emitted event union. Both in-process (the
 * Vercel AI SDK) and dispatched (shelled `warble-agent-sdk chat`) emit this same
 * shape; the BFF (out of scope here) folds it into the UI's own SSE wire
 * frames.
 *
 * `parent`/`depth` (on `step.*`/`tool.*`) model sub-agent nesting. In-process has
 * no Task mechanism — `executeAgent` runs a flat in-process DAG — so its
 * events always carry `depth: 0` and never set `parent`. Only dispatched can
 * populate them (this harness does not currently parse dispatched's own nesting;
 * see `route/dispatched.ts`'s doc comment for the gap).
 */
export type AgentEventKind =
  | "run.start"
  | "step.start"
  | "step.finish"
  | "tool.call"
  | "tool.result"
  | "token"
  | "answer"
  | "refusal"
  | "artifact"
  | "run.finish"
  | "error";

/** Every `AgentEvent` carries these — stamped by `createAgentEventEmitter`, never by an emission site itself. */
export interface AgentEventBase {
  readonly runId: string;
  readonly seq: number;
}

export interface RunStartEvent extends AgentEventBase {
  readonly kind: "run.start";
  readonly mode: "A" | "B";
  readonly agentId: string;
}

export interface StepStartEvent extends AgentEventBase {
  readonly kind: "step.start";
  readonly stepId: string;
  readonly name: string;
  readonly tier: string;
  readonly parent?: string;
  readonly depth: number;
}

export interface StepFinishEvent extends AgentEventBase {
  readonly kind: "step.finish";
  readonly stepId: string;
  readonly name: string;
  readonly status: "ok" | "error";
  /**
   * The step's own reasoning/output: on `"ok"` this is
   * `summarizeToolOutput(text)` (the step's produced artifact text, bounded);
   * on `"error"` it's the best available description of what went wrong.
   * Optional/additive — a step.finish with no `detail` behaves exactly as it
   * did before this field existed.
   */
  readonly detail?: string;
}

export interface ToolCallEvent extends AgentEventBase {
  readonly kind: "tool.call";
  readonly stepId: string;
  readonly callId: string;
  readonly tool: string;
  readonly input?: unknown;
  readonly parent?: string;
  readonly depth: number;
  readonly status: "running";
}

export interface ToolResultEvent extends AgentEventBase {
  readonly kind: "tool.result";
  readonly stepId: string;
  readonly callId: string;
  readonly tool: string;
  readonly status: "success" | "error";
  /**
   * Optional late-bound input for back-ends that only receive a safe tool
   * payload when the call completes. LiveWorkLog merges this onto the
   * matching tool.call entry before persisting the result.
   */
  readonly input?: unknown;
  readonly summary?: string;
  readonly error?: string;
}

export interface TokenEvent extends AgentEventBase {
  readonly kind: "token";
  readonly text: string;
}

/** `envelope` is in-process's shape (`RenderEnvelope`); `text` is dispatched's (`finalText`). Never both. */
export interface AnswerAgentEvent extends AgentEventBase {
  readonly kind: "answer";
  readonly envelope?: RenderEnvelope;
  readonly text?: string;
}

export interface RefusalAgentEvent extends AgentEventBase {
  readonly kind: "refusal";
  readonly reason: string;
  readonly envelope?: RenderEnvelope;
}

export type ArtifactKind = "dashboard" | "report" | "chart";

export interface ArtifactAgentEvent extends AgentEventBase {
  readonly kind: "artifact";
  readonly name: string;
  readonly artifactKind: ArtifactKind;
  readonly location: string;
}

export interface RunFinishEvent extends AgentEventBase {
  readonly kind: "run.finish";
  readonly status: "answer" | "refusal" | "error";
}

export interface ErrorAgentEvent extends AgentEventBase {
  readonly kind: "error";
  readonly message: string;
}

export type AgentEvent =
  | RunStartEvent
  | StepStartEvent
  | StepFinishEvent
  | ToolCallEvent
  | ToolResultEvent
  | TokenEvent
  | AnswerAgentEvent
  | RefusalAgentEvent
  | ArtifactAgentEvent
  | RunFinishEvent
  | ErrorAgentEvent;

/**
 * The minimal, deliberately-scoped trace floor. Built from the existing
 * `onToolCallOutcome` seam with zero new emission infrastructure:
 * terminal-only (no `running` state), flat (no `parent`/`depth`), ordered by
 * fire order. See `runAgent`'s doc comment.
 */
export interface TraceStep {
  readonly id: string;
  readonly tool: string;
  readonly outcome: "success" | "error";
  readonly ordinal: number;
  /**
   * The tool call's input (e.g. the `query` tool's `{sql}`), so the UI's
   * work-log can expand a step to show what it ran. Sourced straight from
   * `ToolCallOutcome.input`; `unknown` because tool inputs are arbitrary
   * per-tool shapes.
   */
  readonly input?: unknown;
  /**
   * A compact, bounded human summary of what happened: on `"success"` this
   * is `summarizeToolOutput(outcome.output)`; on `"error"` it's
   * `outcome.error`. Never the full result payload — always short enough to
   * render inline in a collapsed work-log row.
   */
  readonly detail?: string;
}

export interface StepTrace {
  readonly steps: readonly TraceStep[];
}
