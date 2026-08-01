import type { Step } from "../bundle/schema.js";

/** Snapshot handed to a guard evaluator immediately before a step would run. */
export interface StepGuardContext {
  readonly step: Step;
  readonly artifacts: ReadonlyMap<string, unknown>;
}

/**
 * Decides whether a runnable step should actually execute. This is the seam
 * reserved for `when` guard semantics (`on_failure` folds into the repair-fold
 * retry turn; `on_flag` / `on_missing` drive a guarded-skip) — both are not
 * yet implemented. The executor always calls this hook before
 * running a step; the default implementation here is a pass-through no-op so
 * the seam exists without any guard behavior attached to it yet.
 */
export type GuardEvaluator = (ctx: StepGuardContext) => boolean;

export const passthroughGuardEvaluator: GuardEvaluator = () => true;
