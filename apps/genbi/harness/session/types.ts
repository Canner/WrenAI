import type { StepTrace } from "../events/index.js";
import type { RenderEnvelope } from "../render/index.js";

/** A normal answer: the envelope satisfied every `gated_check` guardrail (or the agent has none). */
export interface AnswerResult {
  readonly kind: "answer";
  readonly envelope: RenderEnvelope;
  /**
   * The FLOOR. Always present for a Mode A run (`runAgent`
   * always accumulates one, even with no `onEvent` sink attached). Mode B
   * carries no trace at all — it isn't a `RunAgentResult`, so this field
   * doesn't apply there (see `route/mode-b.ts`'s doc comment for the gap).
   */
  readonly trace?: StepTrace;
}

/**
 * A refusal: the agent has a `locked` `gated_check` guardrail and the
 * rendered envelope's `verified` field was not `true`. The envelope is
 * still attached (it's often useful for diagnostics), but callers must
 * branch on `kind` before treating it as a deliverable answer.
 */
export interface RefusalResult {
  readonly kind: "refusal";
  readonly reason: string;
  readonly envelope: RenderEnvelope;
  /** See {@link AnswerResult.trace}. */
  readonly trace?: StepTrace;
}

/** `runAgent`'s result: model refusal vs. answer as an explicit, exhaustive union. */
export type RunAgentResult = AnswerResult | RefusalResult;
