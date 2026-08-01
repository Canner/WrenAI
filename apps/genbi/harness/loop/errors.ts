/**
 * Thrown when an agent falls outside the v1 execution scope. v1 only
 * executes `analytical` / `one_shot` / `none` agents — anything else
 * (mutating components, scheduled/event triggers, assertion/mutation
 * outcomes) is a later milestone's concern, not this executor's.
 */
export class AgentScopeError extends Error {
  constructor(agentId: string, componentType: string, trigger: string, outcome: string) {
    super(
      `agent "${agentId}" is out of v1 scope for executeAgent: ` +
        `component_type="${componentType}", trigger="${trigger}", outcome="${outcome}" ` +
        `(v1 only supports component_type="analytical", trigger="one_shot", outcome="none")`,
    );
    this.name = "AgentScopeError";
  }
}

/**
 * Thrown when a `repair_fold` step's shape doesn't match the fold-into-loop
 * error-recovery mechanism's closed contract: its `when` guard must be
 * `on_failure` targeting the same step named by `realization.fold_into`,
 * that target must exist among the agent's other steps, at most one
 * repair_fold may bind to a given target, and the target must itself be a
 * tools-bearing step (this mechanism only ever detects failure via a tool-error content
 * part, so a fold onto a no-tools step can never fire).
 */
export class InvalidRepairFoldError extends Error {
  constructor(stepName: string, reason: string) {
    super(`repair_fold step "${stepName}" is not a valid repair fold: ${reason}`);
    this.name = "InvalidRepairFoldError";
  }
}

/**
 * Thrown when a repair_fold's `max_attempts` budget is exhausted and the
 * folded-into step's tool loop is still seeing a tool-execution error. The
 * fold-into-loop mechanism never retries silently or infinitely (it is bounded,
 * with a hard exhaustion guarantee) — exhaustion is a loud failure, since the golden
 * `answer_query` shape declares no `fallback`.
 */
export class RepairExhaustedError extends Error {
  constructor(targetStep: string, repairStep: string, maxAttempts: number) {
    super(
      `step "${targetStep}" exhausted its repair budget: repair_fold step "${repairStep}" ` +
        `allows at most ${maxAttempts} attempt(s), but a tool call still failed after that many repair turns`,
    );
    this.name = "RepairExhaustedError";
  }
}

/**
 * Thrown when a step's `ToolLoopAgent` turn is cut off by its configured step
 * budget (`ExecuteAgentContext.maxSteps`) before the model finished on its
 * own. `ToolLoopAgent` itself does not throw in this case — hitting its
 * `stopWhen` condition (`isStepCount(maxSteps)`) makes `generate()` return
 * normally with whatever partial text/tool results happened to exist at that
 * point, indistinguishable at the SDK layer from a clean finish unless the
 * caller checks `finishReason` itself. This executor treats that silent
 * cutoff as a loud, distinguishable failure instead of quietly storing the
 * partial text as if the step had completed normally — mirroring
 * {@link RepairExhaustedError}'s "exhaustion is never a silent swallow" stance.
 *
 * Only ever thrown when `maxSteps` was explicitly configured (never for a
 * caller that leaves it unset, e.g. the Ask path) — see
 * `ExecuteAgentContext.maxSteps`'s own doc comment.
 */
export class StepBudgetExhaustedError extends Error {
  constructor(
    readonly stepId: string,
    readonly maxSteps: number,
    readonly stepsCompleted: number,
  ) {
    super(
      `step "${stepId}" exhausted its step budget (${maxSteps} tool-loop steps) before finishing — ` +
        `${stepsCompleted} other step(s) had already produced their artifact`,
    );
    this.name = "StepBudgetExhaustedError";
  }
}
