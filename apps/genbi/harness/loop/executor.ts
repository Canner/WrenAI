import { generateText, isStepCount, ToolLoopAgent, type LanguageModel, type StepResult, type ToolSet } from "ai";
import type { Agent, Step } from "../bundle/schema.js";
import type { AgentEventInput } from "../events/index.js";
import { resolveStepModel } from "../providers/index.js";
import type { ProviderRegistry, TierBinding } from "../providers/index.js";
import { WRITE_ARTIFACT_TOOL_NAME } from "../tools/index.js";
import { AgentScopeError, InvalidRepairFoldError, RepairExhaustedError, StepBudgetExhaustedError } from "./errors.js";
import { passthroughGuardEvaluator, type GuardEvaluator } from "./guard.js";

const SUPPORTED_COMPONENT_TYPE = "analytical";
const SUPPORTED_TRIGGER = "one_shot";
const SUPPORTED_OUTCOME = "none";

/** Dataflow artifact state: artifact name -> the value its producing step returned. */
export type DataflowArtifacts = ReadonlyMap<string, unknown>;

/**
 * This tool-call-outcome observer seam, widened for the live-event layer: fired for every tool call that
 * completes inside a `ToolLoopAgent` turn (`runToolLoopStep`/
 * `runToolLoopStepWithRepair`), once per `tool-result` (`"success"`) or
 * `tool-error` (`"error"`) content part across every step of the turn.
 * `input`/`callId` are sourced straight off that content part (both AI SDK
 * v7 `tool-result` and `tool-error` parts already carry `input` themselves
 * — no cross-referencing a separate `tool-call` part is needed).
 * `runAgent`'s deterministic `gated_check` gate (`harness/session/run.ts`)
 * consumes `tool`/`outcome` to track whether a data-access tool call ever
 * genuinely succeeded, independent of the model's own self-attested
 * `verified` claim; the same firings also feed the FLOOR `StepTrace`.
 */
export interface ToolCallOutcome {
  readonly tool: string;
  readonly outcome: "success" | "error";
  readonly callId?: string;
  readonly input?: unknown;
  /**
   * The tool's structured return value (AI SDK v7 `tool-result` part's
   * `output`), present only on `"success"`. Carried so a consumer can build
   * a deterministic render envelope straight from a data-access tool's real
   * result (e.g. the `query` tool's `{columns, rows}`) instead of relying on
   * the step model to re-emit that structure as text — see `runAgent`.
   */
  readonly output?: unknown;
  /**
   * The tool-error part's derived human message ({@link describeError}),
   * present only on `"error"`. Carried so a consumer (e.g. `runAgent`'s
   * `TraceStep` enrichment) can surface *why* a failed tool call failed —
   * e.g. the SQL-repair retry's `query` steps — without re-deriving it from
   * a raw `unknown` error value itself.
   */
  readonly error?: string;
}
export type ToolCallOutcomeListener = (outcome: ToolCallOutcome) => void;

export interface ExecuteAgentContext {
  /** Tier -> adapter binding; resolves each step's model. */
  readonly binding: TierBinding;
  readonly registry: ProviderRegistry;
  /**
   * Tool set injected by the caller. This executor does not resolve `agent.tools[]`
   * from the bundle itself (that native + `mcp:wren/*` resolution happens earlier) — the caller
   * hands the executor an already-realized AI SDK tool set (or `{}` for a
   * no-tools run).
   */
  readonly tools: ToolSet;
  /** The user's question, threaded into every step's rendered prompt. */
  readonly userInput: string;
  /** Guard-eval seam for step-level repair/guard behavior. Defaults to an always-true pass-through. */
  readonly evaluateGuard?: GuardEvaluator;
  /**
   * Per-step `ToolLoopAgent` step budget (an `isStepCount(maxSteps)` stop
   * condition). Optional and unset by default, in which case every
   * tools-bearing step falls back to `ToolLoopAgent`'s own SDK default of 20
   * steps (`ai`'s `ToolLoopAgent.prepareCall()`: `stopWhen: this.settings.stopWhen
   * ?? isStepCount(20)`) — that default applied silently to every caller of
   * this executor even before this field existed; it just had no name. Only
   * `InProcessSetupRunner` sets this today (to `DEFAULT_SETUP_MAX_TURNS`,
   * `harness/setup/runner.ts`) — `runAgent`'s Ask-turn path
   * (`harness/session/run.ts`) never sets it, so its behavior (the SDK's own
   * 20-step default) is unchanged by this field's existence. When a
   * tools-bearing step's turn is cut off by this budget before the model
   * finished on its own, `executeAgent` throws {@link StepBudgetExhaustedError}
   * instead of silently storing the turn's partial text as if it had
   * completed normally — see that error's own doc comment.
   */
  readonly maxSteps?: number;
  /** Optional observer for every tool call's success/error outcome. See {@link ToolCallOutcomeListener}. */
  readonly onToolCallOutcome?: ToolCallOutcomeListener;
  /**
   * Live-event layer: optional sink for `step.*`/`tool.*`/`artifact`
   * events as `executeAgent` produces them. Typed as `AgentEventInput`
   * (no `runId`/`seq`) rather than the contract's literal `(e: AgentEvent)
   * => void` — `runAgent` is the natural single owner of that run-level
   * bookkeeping (via `createAgentEventEmitter`); `executeAgent`'s job is
   * only to describe *what happened* at step/tool granularity. `runAgent`
   * passes its emitter's `emit` method down as this field's value. Emitted
   * events always carry `depth: 0` and no `parent` — in-process (this
   * executor) has no sub-agent/Task mechanism, so nesting is structurally
   * unavailable here.
   */
  readonly onEvent?: (event: AgentEventInput) => void;
}

/**
 * Runs an agent's `steps[]` over a dataflow artifact state (option (b)):
 * a step becomes runnable once every artifact it `consumes` is present, and
 * on completion it stores its `produces` artifact. Step order is *derived*
 * from consumes/produces satisfaction, not from the array's emergent index.
 *
 * Tool granularity is agent-level in the bundle, not per-step: if the agent
 * declares `tools`, every (non-repair_fold) step runs as a `ToolLoopAgent`
 * turn with the injected tool set (tool calls are emergent — a given step
 * may make zero); otherwise every step is a single `generateText` call.
 * A future milestone may refine this to scope tools per step.
 *
 * `realization.kind: "repair_fold"` steps are recognized but never run as
 * independent top-level steps — instead each one folds into its
 * `fold_into` target's tool-loop as a bounded error-recovery turn: when the
 * target step's most recent turn surfaces a tool-execution error, the next
 * turn's model and instructions swap to the repair step's, bounded by
 * `max_attempts`. The DAG stays acyclic — this is a loop-internal retry, not
 * a dataflow back-edge — and exhaustion is a loud failure
 * ({@link RepairExhaustedError}), never a silent swallow or infinite retry.
 *
 * Returns the final dataflow artifact state — not a render envelope
 * (the two-stage structured-output envelope is built in `harness/render/`).
 */
export async function executeAgent(
  agent: Agent,
  ctx: ExecuteAgentContext,
): Promise<DataflowArtifacts> {
  assertV1Scope(agent);

  const artifacts = new Map<string, unknown>();
  const evaluateGuard = ctx.evaluateGuard ?? passthroughGuardEvaluator;
  // Tool granularity is agent-level in the bundle (`agent.tools[]`), not
  // per-step — so gate the ToolLoopAgent-vs-generateText choice on the
  // bundle's declaration, not on whatever happens to be in the injected
  // tool set (which the caller may size differently today, since real
  // `agent.tools[]` -> AI SDK tool resolution happens elsewhere).
  const hasTools = agent.tools.length > 0;

  // repair_fold steps never run as independent top-level steps — they're
  // consumed by the fold-into-loop logic below, keyed by their fold_into
  // target's step name.
  const repairByTarget = buildRepairFoldMap(agent, hasTools);

  const pending = agent.steps.filter((step) => step.realization.kind !== "repair_fold");

  while (pending.length > 0) {
    const readyIndex = pending.findIndex((step) => isConsumesSatisfied(step, artifacts));
    if (readyIndex === -1) {
      // No remaining step's consumes can ever be satisfied — e.g. its sole
      // producer is a repair_fold step, which never runs as a top-level step.
      break;
    }
    const [step] = pending.splice(readyIndex, 1);
    if (!step) break;

    if (!evaluateGuard({ step, artifacts })) {
      // A real guard would skip this step's execution and leave
      // its `produces` artifact absent. The default guard used here never does this.
      continue;
    }

    const prompt = renderStepPrompt(step, ctx.userInput, artifacts);
    const model = resolveStepModel(step, ctx.binding, ctx.registry);
    const repairStep = repairByTarget.get(step.name);
    const stepId = step.name;

    // `step.start`/`step.finish` bracket each bundle step.
    // In-process has no sub-agent/Task mechanism, so `depth` is always 0 and
    // `parent` is never set here (see `ExecuteAgentContext.onEvent`'s doc
    // comment).
    ctx.onEvent?.({ kind: "step.start", stepId, name: step.name, tier: step.tier, depth: 0 });

    let text: string;
    let repaired = false;
    try {
      if (repairStep) {
        // Validated up front in buildRepairFoldMap: a repair_fold target is
        // always a tools-bearing step, so hasTools is guaranteed true here.
        const result = await runToolLoopStepWithRepair(
          model,
          ctx.tools,
          prompt,
          repairStep,
          ctx.binding,
          ctx.registry,
          stepId,
          ctx.onToolCallOutcome,
          ctx.onEvent,
          ctx.maxSteps,
        );
        if (result.exhausted) {
          throw new StepBudgetExhaustedError(stepId, ctx.maxSteps!, artifacts.size);
        }
        text = result.text;
        repaired = result.repaired;
      } else if (hasTools) {
        const result = await runToolLoopStep(
          model,
          ctx.tools,
          prompt,
          stepId,
          ctx.onToolCallOutcome,
          ctx.onEvent,
          ctx.maxSteps,
        );
        if (result.exhausted) {
          throw new StepBudgetExhaustedError(stepId, ctx.maxSteps!, artifacts.size);
        }
        text = result.text;
      } else {
        text = await runSingleGenerateStep(model, prompt);
      }
    } catch (error) {
      ctx.onEvent?.({ kind: "step.finish", stepId, name: step.name, status: "error", detail: describeError(error) });
      throw error;
    }

    artifacts.set(step.produces, text);
    // Surface the step's own reasoning/output — the text it just
    // produced (already about to be stored as `step.produces`'s artifact) —
    // bounded via the same `summarizeToolOutput` truncation a tool result
    // uses, so a long LLM step's output doesn't blow up the work-log frame.
    const detail = summarizeToolOutput(text);
    ctx.onEvent?.({
      kind: "step.finish",
      stepId,
      name: step.name,
      status: "ok",
      ...(detail !== undefined ? { detail } : {}),
    });
    // The repair step's own `produces` artifact only appears when a repair
    // turn actually ran — never on the ordinary success path (see the
    // `repaired_result` absence assertion).
    if (repairStep && repaired) {
      artifacts.set(repairStep.produces, text);
    }
  }

  return artifacts;
}

/**
 * Validates and indexes every `repair_fold` step by its `fold_into` target
 * step name. The fold-into-loop contract is closed: `when` must be exactly
 * `{ guard: "on_failure", target: <fold_into> }`, the target must exist
 * among the agent's steps, at most one repair may bind to a given target,
 * and — since this mechanism only ever detects failure via a tool-error content part on
 * the target's tool-loop turn — the target must be a tools-bearing step.
 * Any violation is a loud `InvalidRepairFoldError` at agent-start, not a
 * silent fall-back to skipping the repair step.
 */
function buildRepairFoldMap(agent: Agent, hasTools: boolean): ReadonlyMap<string, Step> {
  const map = new Map<string, Step>();
  const stepNames = new Set(agent.steps.map((step) => step.name));

  for (const step of agent.steps) {
    if (step.realization.kind !== "repair_fold") continue;

    const foldInto = step.realization.fold_into;
    if (!foldInto) {
      throw new InvalidRepairFoldError(step.name, "realization.fold_into is required");
    }
    if (!stepNames.has(foldInto)) {
      throw new InvalidRepairFoldError(step.name, `fold_into target "${foldInto}" is not a step on this agent`);
    }
    if (!step.when || step.when.guard !== "on_failure" || step.when.target !== foldInto) {
      throw new InvalidRepairFoldError(
        step.name,
        `expected when = { guard: "on_failure", target: "${foldInto}" }`,
      );
    }
    if (map.has(foldInto)) {
      throw new InvalidRepairFoldError(step.name, `step "${foldInto}" already has a repair_fold bound to it`);
    }
    if (!hasTools) {
      throw new InvalidRepairFoldError(
        step.name,
        `fold_into target "${foldInto}" must be a tools-bearing step (the fold-into-loop mechanism detects failure via a tool-error)`,
      );
    }
    map.set(foldInto, step);
  }

  return map;
}

function assertV1Scope(agent: Agent): void {
  if (
    agent.component_type !== SUPPORTED_COMPONENT_TYPE ||
    agent.trigger !== SUPPORTED_TRIGGER ||
    agent.outcome !== SUPPORTED_OUTCOME
  ) {
    throw new AgentScopeError(agent.id, agent.component_type, agent.trigger, agent.outcome);
  }
}

function isConsumesSatisfied(step: Step, artifacts: DataflowArtifacts): boolean {
  return step.consumes.every((artifactName) => artifacts.has(artifactName));
}

async function runSingleGenerateStep(model: LanguageModel, prompt: string): Promise<string> {
  const result = await generateText({ model, prompt });
  return result.text;
}

async function runToolLoopStep(
  model: LanguageModel,
  tools: ToolSet,
  prompt: string,
  stepId: string,
  onToolCallOutcome?: ToolCallOutcomeListener,
  onEvent?: (event: AgentEventInput) => void,
  maxSteps?: number,
): Promise<{ readonly text: string; readonly exhausted: boolean }> {
  const agentRunner = new ToolLoopAgent({
    model,
    tools,
    ...(maxSteps !== undefined ? { stopWhen: isStepCount(maxSteps) } : {}),
  });
  const result = await agentRunner.generate({ prompt });
  reportToolCallOutcomes(result.steps, stepId, onToolCallOutcome, onEvent);
  return { text: result.text, exhausted: isBudgetExhausted(result, maxSteps) };
}

/**
 * The fold-into-loop mechanism: runs `prompt` as a `ToolLoopAgent` turn
 * exactly like {@link runToolLoopStep}, except `prepareStep` inspects the
 * immediately-preceding turn for a tool-execution error (a `type:
 * "tool-error"` content part — the shape the AI SDK gives a caught tool
 * `execute` rejection, confirmed against `@ai-sdk/mcp`'s JSON-RPC error
 * path). On error, the *next* turn's model and instructions are swapped to
 * the repair step's (its `tier` resolved the same way any step's tier is),
 * folding the repair in as a bounded error-recovery turn rather than a
 * separate top-level step. Bounded by `repairStep.realization.max_attempts`
 * (default 1); once exhausted, a further tool-error throws
 * {@link RepairExhaustedError} instead of retrying again.
 */
async function runToolLoopStepWithRepair(
  model: LanguageModel,
  tools: ToolSet,
  prompt: string,
  repairStep: Step,
  binding: TierBinding,
  registry: ProviderRegistry,
  stepId: string,
  onToolCallOutcome?: ToolCallOutcomeListener,
  onEvent?: (event: AgentEventInput) => void,
  maxSteps?: number,
): Promise<{ readonly text: string; readonly repaired: boolean; readonly exhausted: boolean }> {
  const maxAttempts = repairStep.realization.max_attempts ?? 1;
  const repairModel = resolveStepModel(repairStep, binding, registry);
  const foldTarget = repairStep.realization.fold_into ?? repairStep.name;

  let attemptsUsed = 0;
  let repaired = false;

  const agentRunner = new ToolLoopAgent({
    model,
    tools,
    ...(maxSteps !== undefined ? { stopWhen: isStepCount(maxSteps) } : {}),
    prepareStep: ({ steps }) => {
      const lastStep = steps[steps.length - 1];
      if (!lastStep || !stepHasToolError(lastStep)) {
        return {};
      }
      if (attemptsUsed >= maxAttempts) {
        throw new RepairExhaustedError(foldTarget, repairStep.name, maxAttempts);
      }
      attemptsUsed += 1;
      repaired = true;
      return { model: repairModel, instructions: repairStep.prompt };
    },
  });

  const result = await agentRunner.generate({ prompt });
  reportToolCallOutcomes(result.steps, stepId, onToolCallOutcome, onEvent);
  return { text: result.text, repaired, exhausted: isBudgetExhausted(result, maxSteps) };
}

/**
 * Detects whether a completed `ToolLoopAgent` turn was cut off by its
 * configured step budget rather than finishing on its own. `isStepCount`'s
 * own stop condition is an exact-equality check (`steps.length ===
 * stepCount`, `ai`'s `stop-condition.ts`) — indistinguishable, by step count
 * alone, from a model that happens to finish naturally on exactly the
 * budget's last step. `finishReason` disambiguates: a clean finish sets it to
 * `"stop"` (`generate-text.ts`'s main loop only resolves output when
 * `lastStep.finishReason === "stop"`); a turn cut off mid-flight — the model
 * still had a tool call queued when the budget's step count was hit — never
 * reaches that state, so its last step's `finishReason` is something else
 * (typically `"tool-calls"`). Always `false` when no budget was configured
 * (`maxSteps === undefined`), so a caller that never opts in (the Ask path)
 * can never see this heuristic fire.
 */
function isBudgetExhausted(result: { readonly finishReason: string; readonly steps: readonly unknown[] }, maxSteps: number | undefined): boolean {
  if (maxSteps === undefined) return false;
  return result.steps.length >= maxSteps && result.finishReason !== "stop";
}

function stepHasToolError(step: StepResult<ToolSet>): boolean {
  return step.content.some((part) => part.type === "tool-error");
}

/**
 * This function, widened for the live-event layer: walks every step's content parts from a
 * completed `ToolLoopAgent` turn and reports each outcome to
 * `onToolCallOutcome` ({@link ToolCallOutcome}) — this is the sole place
 * tool-call outcomes are observed, so the deterministic gate and the
 * FLOOR `StepTrace` both see outcomes from ordinary steps and from
 * repair-folded turns alike. A no-op for a given concern when neither
 * `onToolCallOutcome` nor `onEvent` is registered.
 *
 * Also emits, when `onEvent` is set: a `tool.call` for every `tool-call`
 * part (before its outcome is known — `status: "running"`), a `tool.result`
 * for every `tool-result`/`tool-error` part, and — best-effort, since the
 * bundle's native `write_artifact` tool has no `artifactKind` field of its
 * own (input is just `{path, content}`) — an `artifact` event defaulting
 * `artifactKind` to `"report"` whenever that tool call succeeds. This is a
 * documented limitation, not a real classification signal.
 */
function reportToolCallOutcomes(
  steps: readonly StepResult<ToolSet>[],
  stepId: string,
  onToolCallOutcome: ToolCallOutcomeListener | undefined,
  onEvent: ((event: AgentEventInput) => void) | undefined,
): void {
  if (!onToolCallOutcome && !onEvent) return;
  for (const step of steps) {
    for (const part of step.content) {
      if (part.type === "tool-call") {
        onEvent?.({
          kind: "tool.call",
          stepId,
          callId: part.toolCallId,
          tool: part.toolName,
          ...(part.input !== undefined ? { input: part.input } : {}),
          depth: 0,
          status: "running",
        });
      } else if (part.type === "tool-result") {
        onToolCallOutcome?.({
          tool: part.toolName,
          outcome: "success",
          callId: part.toolCallId,
          ...(part.input !== undefined ? { input: part.input } : {}),
          ...(part.output !== undefined ? { output: part.output } : {}),
        });
        const summary = summarizeToolOutput(part.output);
        onEvent?.({
          kind: "tool.result",
          stepId,
          callId: part.toolCallId,
          tool: part.toolName,
          status: "success",
          ...(summary !== undefined ? { summary } : {}),
        });
        if (part.toolName === WRITE_ARTIFACT_TOOL_NAME) {
          const location = extractArtifactPath(part.input);
          if (location !== undefined) {
            onEvent?.({
              kind: "artifact",
              // Best-effort default — the native `write_artifact` tool has
              // no `artifactKind` concept in its input/output schema (see
              // this function's doc comment).
              name: basenameOf(location),
              artifactKind: "report",
              location,
            });
          }
        }
      } else if (part.type === "tool-error") {
        const error = describeError(part.error);
        onToolCallOutcome?.({
          tool: part.toolName,
          outcome: "error",
          callId: part.toolCallId,
          ...(part.input !== undefined ? { input: part.input } : {}),
          error,
        });
        onEvent?.({
          kind: "tool.result",
          stepId,
          callId: part.toolCallId,
          tool: part.toolName,
          status: "error",
          error,
        });
      }
    }
  }
}

/**
 * Best-effort, bounded-length human summary of a tool's `output`, for
 * `ToolResultEvent.summary`. Exported so `harness/session/run.ts` can build a
 * `TraceStep.detail` for a successful outcome from the same seam, without
 * duplicating the truncation logic.
 */
export function summarizeToolOutput(output: unknown): string | undefined {
  if (output === undefined) return undefined;
  const text = typeof output === "string" ? output : JSON.stringify(output);
  const MAX_LENGTH = 200;
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH)}…` : text;
}

function describeError(error: unknown): string {
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : JSON.stringify(error);
  // Bounded like summarizeToolOutput: this string is now persisted into the
  // display worklog's `detail` (via the tool.result/step.finish events), so a
  // pathological huge error message must not bloat trace_json.
  const MAX_LENGTH = 200;
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH)}…` : text;
}

function extractArtifactPath(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const path = (input as Record<string, unknown>).path;
  return typeof path === "string" ? path : undefined;
}

function basenameOf(filePath: string): string {
  const segments = filePath.split(/[/\\]/);
  return segments[segments.length - 1] || filePath;
}

/**
 * Builds the message sent for a step: the user's question (always present,
 * so steps with `consumes: []` like `resolve_intent` can still see it),
 * the step's own prompt, and the resolved values of every artifact it
 * consumes.
 */
function renderStepPrompt(step: Step, userInput: string, artifacts: DataflowArtifacts): string {
  const sections = [`User's question: ${userInput}`, step.prompt];

  if (step.consumes.length > 0) {
    const consumedSection = step.consumes
      .map((name) => `${name}: ${formatArtifactValue(artifacts.get(name))}`)
      .join("\n");
    sections.push(`Consumed artifacts:\n${consumedSection}`);
  }

  return sections.join("\n\n");
}

function formatArtifactValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
