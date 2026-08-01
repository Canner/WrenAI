/**
 * Agentic setup/connect flow — BFF wiring.
 *
 * The Setup wizard's CONNECT step onboards a NEW wren project by dispatching
 * warble's `connect_source` component via a Mode B (claude-agent-sdk)
 * subprocess. Design decisions this file encodes (see the ticket for full
 * rationale):
 *
 *  - Setup state lives on disk (the scaffolded project + its `.env`), not
 *    only in the agent conversation: each setup turn is independently
 *    re-verifiable via `parseSetupTerminal`'s on-disk artifact checks below,
 *    regardless of which mechanism served the turn. Historically every setup
 *    turn was ALSO a fresh Mode B dispatch with no SDK-level continuity
 *    across turns (a disk-state-only "Plan B" re-composition — see
 *    `server/compose.ts`'s `composeSetupPrompt`'s `resumeFromDisk` option).
 *    `SetupStepRunOptions.resumeSessionId`/`SetupStepRunResult.sessionId`
 *    below add the alternative "Plan A": resuming the SAME underlying
 *    agent-sdk conversation (`ModeBOptions.resumeSessionId` /
 *    `ModeBResult.sessionId`, `../route/mode-b.js`) when a caller has one to
 *    resume from, so a `max_turns_continue` decision (`server/turn.ts`) can
 *    give the agent a fresh turn budget without making it re-orient from
 *    scratch (re-`ls`, re-`Read`, re-fetch skills). Both remain available:
 *    a caller with no session id to resume gets the original disk-state
 *    behavior unchanged.
 *  - The terminal contract (`SETUP_STATUS: ok|needs_input|error`) lives in
 *    the composed prompt, not in warble — `parseSetupTerminal` below parses
 *    it back out of the turn's finalText, and independently verifies
 *    `<root>/<name>/wren_project.yml` on disk before trusting an `ok`.
 *  - `SetupStepRunner` is a backend-abstract seam: `ModeBSetupRunner`
 *    (claude-agent-sdk subprocess, subscription auth) and `ModeASetupRunner`
 *    (in-process vercel loop, api-key/local/gateway auth) both implement it,
 *    and a caller picks between them purely on `authChoice.mode` without
 *    otherwise caring which one served a given turn.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthChoice } from "../auth/index.js";
import { loadBundle } from "../bundle/loader.js";
import { runWarble } from "../compile/pipeline.js";
import { resolveWarbleBinary } from "../compile/resolve-binary.js";
import { createAgentEventEmitter, type AgentEvent } from "../events/index.js";
import { createLocalExecutionEnv, type ExecutionPolicy } from "../exec/index.js";
import { executeAgent, StepBudgetExhaustedError } from "../loop/index.js";

// Re-exported: `ModeASetupRunner.run()` throws this (with an enriched,
// Mode-A-specific `.message` — see its `catch` block below) whenever the
// dispatched agent's step budget is what ended the turn, not the model
// finishing on its own. Callers that want to distinguish that from any
// other setup-dispatch failure (e.g. via `instanceof`) can import it from
// here without also reaching into `harness/loop/index.js`.
export { StepBudgetExhaustedError };
import { createDefaultProviderRegistry } from "../providers/index.js";
import { deriveAdapterSpec } from "../route/adapter-spec.js";
import { runModeBDefault } from "../route/mode-b.js";
import { buildUniformTierBinding } from "../route/tier-binding.js";
import { createNativeToolRegistry, createSetupExecutionTool, SETUP_EXECUTION_TOOL_NAME } from "../tools/index.js";
import { withResolvedTools } from "../tools/wiring.js";

/** The warble component the setup wizard's connect step dispatches. */
export const CONNECT_SOURCE_AGENT_ID = "connect_source";

/** The warble component the setup wizard's context step dispatches (`warble/genbi-setup/components/build_context`). */
export const BUILD_CONTEXT_AGENT_ID = "build_context";

/**
 * Default agent-loop budget for setup turns, forwarded as `warble-agent-sdk
 * chat --max-turns`. Well above the dispatcher's own default (40) because
 * `build_context` agentically generates an MDL — many read/introspect/write/
 * build/validate tool calls — and routinely blows past 40, failing the turn
 * with `error_max_turns`. Overridable via `ModeBSetupRunnerOptions.maxTurns`
 * (wired to `WREN_HARNESS_SETUP_MAX_TURNS` in `server/bin.ts`).
 */
export const DEFAULT_SETUP_MAX_TURNS = 120;

export interface SetupStepRunOptions {
  /** The composed single-line prompt (see `composeSetupPrompt`). */
  readonly prompt: string;
  /** The workspace root the agent scaffolds `<name>/` into — Mode B's `userProject`/cwd. */
  readonly workspaceRoot: string;
  readonly authChoice: AuthChoice;
  /**
   * Which warble component to dispatch — `CONNECT_SOURCE_AGENT_ID` for the
   * `connect`/`connect_resume` steps, `BUILD_CONTEXT_AGENT_ID` for the
   * `context` step. Optional and defaults to `CONNECT_SOURCE_AGENT_ID` so
   * every pre-existing caller/test (all predating the `context` step) keeps
   * dispatching exactly what it always has without passing this explicitly.
   */
  readonly agentId?: string;
  /** Forwarded to the Mode B executor so the turn's worklog streams identically to an Ask turn. */
  readonly onEvent?: (event: AgentEvent) => void;
  /**
   * Plan A session resume: an SDK session id captured from an earlier turn's `SetupStepRunResult`
   * (success) or its thrown error (failure — see `ModeBSessionError`, `../route/mode-b.js`). When
   * set, forwarded to `ModeBOptions.resumeSessionId` so this turn resumes the SAME agent-sdk
   * conversation instead of starting a fresh one. Omitted (or a runner that doesn't support it)
   * falls back to the pre-existing fresh-dispatch behavior.
   */
  readonly resumeSessionId?: string;
}

export interface SetupStepRunResult {
  /** The dispatched turn's final answer text — callers parse this via `parseSetupTerminal`. */
  readonly finalText: string;
  /**
   * The SDK session id this turn ran under, for resuming a LATER turn via
   * `SetupStepRunOptions.resumeSessionId`. Optional so pre-existing stub runners in tests aren't
   * forced to return it (mirrors `SetupStepRunner.effectiveMaxTurns`'s optionality above);
   * callers that need it treat an absent field the same as `undefined` — no session captured.
   * `null` means the dispatcher itself reported no session id at all.
   */
  readonly sessionId?: string | null;
}

/**
 * Backend-abstract seam for dispatching one setup-wizard turn. Implementations
 * own how the `connect_source` component actually runs (Mode B subprocess
 * today; a future in-process Mode A variant could implement this same
 * interface) and are responsible for forwarding `onEvent` so the caller's SSE
 * worklog streaming is unaffected by which backend served the turn.
 */
export interface SetupStepRunner {
  run(options: SetupStepRunOptions): Promise<SetupStepRunResult>;
  /**
   * The `--max-turns` budget this runner will actually dispatch a given
   * `agentId` with — the same value `run()` computes internally. Callers that
   * need to *describe* a future dispatch (e.g. the `max_turns_continue`
   * decision's "Continue (+N turns)" label — see `server/turn.ts`) call this
   * instead of duplicating the resolution logic, so the label can never drift
   * from what `run()` actually applies. Optional so pre-existing stub runners
   * in tests aren't forced to implement it; callers fall back to
   * `DEFAULT_SETUP_MAX_TURNS` when it's absent.
   */
  effectiveMaxTurns?(agentId: string): number | undefined;
}

/**
 * Resolves the `--max-turns` budget for dispatching `agentId`, given an
 * optional explicit override (`ModeBSetupRunnerOptions.maxTurns`, wired from
 * `WREN_HARNESS_SETUP_MAX_TURNS` in `server/bin.ts`). Shared by
 * `ModeBSetupRunner.run()` and `ModeBSetupRunner.effectiveMaxTurns()` so the
 * two can never disagree.
 */
function resolveEffectiveMaxTurns(configuredMaxTurns: number | undefined, agentId: string): number | undefined {
  return configuredMaxTurns ?? (agentId === BUILD_CONTEXT_AGENT_ID ? DEFAULT_SETUP_MAX_TURNS : undefined);
}

export interface ModeBSetupRunnerOptions {
  /** Path to the committed genbi-setup IR (e.g. `warble/genbi-setup/ir.golden.json`) — see `resolveSetupIrPath`. */
  readonly irPath: string;
  readonly warbleBin?: string;
  readonly agentSdkBin?: string;
  readonly outDir?: string;
  readonly workDir?: string;
  /** Agent-loop budget forwarded as `--max-turns`; defaults to `DEFAULT_SETUP_MAX_TURNS` when unset. */
  readonly maxTurns?: number;
}

/**
 * Dispatches a setup-wizard turn over Mode B, bypassing `route()` entirely
 * (unlike the Ask turn path) so it can perform its own, setup-specific
 * subscription-mode check with a clear, actionable error message rather than
 * `route()`'s generic Mode A/B branch. Uses `ModeBOptions.irPath` to skip
 * `compileProfile` — there is no bound wren project yet during setup, so
 * there is nothing to compile a profile against; the setup dispatch always
 * runs the same fixed, warble-committed IR regardless of which project is
 * being onboarded.
 */
export class ModeBSetupRunner implements SetupStepRunner {
  constructor(private readonly options: ModeBSetupRunnerOptions) {}

  effectiveMaxTurns(agentId: string): number | undefined {
    return resolveEffectiveMaxTurns(this.options.maxTurns, agentId);
  }

  async run(runOptions: SetupStepRunOptions): Promise<SetupStepRunResult> {
    const { authChoice } = runOptions;
    const agentId = runOptions.agentId ?? CONNECT_SOURCE_AGENT_ID;
    // Only build_context needs the raised turn budget — generating an MDL is
    // many tool calls. connect/connect_resume stay on the dispatcher's default
    // (40) so a stuck connect (e.g. bad credentials retrying) still fails fast
    // rather than burning 3x the runway first. An explicit
    // ModeBSetupRunnerOptions.maxTurns override, when set, applies to any turn.
    // Kept in lockstep with `effectiveMaxTurns()` above via the shared
    // `resolveEffectiveMaxTurns` helper.
    const maxTurns = this.effectiveMaxTurns(agentId);
    if (authChoice.mode !== "subscription") {
      throw new Error(
        `Agentic setup requires subscription auth mode (Mode B) to dispatch "${agentId}" ` +
          `via the claude-agent-sdk dispatcher — got "${authChoice.mode}". Set WREN_HARNESS_MODE=subscription ` +
          "to enable the setup wizard's connect step.",
      );
    }

    const result = await runModeBDefault({
      authChoice,
      // Unused: `irPath` below makes `runModeBDefault` skip compileProfile
      // entirely (see its short-circuit), so this value is never read. It is
      // set to the same setup IR for clarity, not because it is consulted.
      profileSource: this.options.irPath,
      userProject: runOptions.workspaceRoot,
      question: runOptions.prompt,
      agentId,
      irPath: this.options.irPath,
      ...(this.options.warbleBin !== undefined ? { warbleBin: this.options.warbleBin } : {}),
      ...(this.options.agentSdkBin !== undefined ? { agentSdkBin: this.options.agentSdkBin } : {}),
      ...(this.options.outDir !== undefined ? { outDir: this.options.outDir } : {}),
      ...(this.options.workDir !== undefined ? { workDir: this.options.workDir } : {}),
      ...(maxTurns !== undefined ? { maxTurns } : {}),
      ...(runOptions.onEvent !== undefined ? { onEvent: runOptions.onEvent } : {}),
      ...(runOptions.resumeSessionId !== undefined ? { resumeSessionId: runOptions.resumeSessionId } : {}),
    });

    return { finalText: result.finalText, ...(result.sessionId !== undefined ? { sessionId: result.sessionId } : {}) };
  }
}

/**
 * This package's bundled setup capability-provider fragment
 * (`providers/setup.provider.yaml`) — the default `--provider` for
 * `ModeASetupRunner`'s dispatch, mirroring `compileProfile`'s own
 * `DEFAULT_WREN_PROVIDER_PATH` constant (`harness/compile/pipeline.ts`).
 */
export const DEFAULT_SETUP_PROVIDER_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "providers",
  "setup.provider.yaml",
);

export interface ModeASetupRunnerOptions {
  /** Path to the committed genbi-setup IR (e.g. `warble/genbi-setup/ir.golden.json`) — same contract as `ModeBSetupRunnerOptions.irPath`. */
  readonly irPath: string;
  readonly warbleBin?: string;
  /** Overrides the bundled `providers/setup.provider.yaml` fragment `warble dispatch --provider` uses. */
  readonly providerPath?: string;
  /** Scratch dir the dispatched vercel bundle is written into; a fresh `mkdtemp` per run when unset. */
  readonly outDir?: string;
  /** Forwarded to `deriveAdapterSpec` for `authChoice.mode === "local"` (see its own doc comment). */
  readonly model?: string;
  /**
   * Agent-loop step budget forwarded as `ExecuteAgentContext.maxSteps`;
   * resolved the same way as `ModeBSetupRunnerOptions.maxTurns` via the
   * shared `resolveEffectiveMaxTurns` (only `build_context` gets the raised
   * `DEFAULT_SETUP_MAX_TURNS` budget by default; `connect`/`connect_resume`
   * fall back to `ToolLoopAgent`'s own SDK default of 20 steps unless this
   * is set). Wired to the same `WREN_HARNESS_SETUP_MAX_TURNS` env var as
   * `ModeBSetupRunnerOptions.maxTurns` in `server/bin.ts`.
   */
  readonly maxTurns?: number;
}

/**
 * Dispatches a setup-wizard turn over Mode A: the in-process vercel loop
 * (`harness/loop/executor.ts`'s `executeAgent`), instead of shelling a
 * claude-agent-sdk subprocess. Mirrors `ModeBSetupRunner`'s own shape
 * (same `SetupStepRunner` interface, same "bypass the per-user compile
 * pipeline and dispatch the fixed, warble-committed setup IR directly"
 * design) but reuses the Mode A building blocks `harness/route/mode-a.ts`'s
 * `runModeADefault` wires together, minus the two pieces that don't apply to
 * setup:
 *
 *  - No `resolveWrenBinary()` preflight — the setup components' only tool
 *    (`setup_execution`, see `harness/tools/setup-native.ts`) never shells
 *    the `wren` CLI directly; it's a general scoped exec/write pair, not a
 *    wren-specific one.
 *  - No `deriveEnforcement(agent)` (`harness/guardrails/policy.ts`) — that
 *    function maps `read_only`/`scoped_write`/threshold guardrails onto an
 *    `EnforcementPolicy` and has no branch for the `setup_execution`
 *    guardrail shape (`{name: "setup_execution", locked: true, scope: "."}`)
 *    the two setup components declare. Rather than widen that shared module
 *    for a guardrail only this path uses, this runner builds its own fixed
 *    `ExecutionPolicy` below, matching what `setup_execution` actually grants
 *    on the Mode B (claude-agent-sdk) side: unrestricted exec (subject only
 *    to the native tool's own destructive/redirection denylist, never
 *    `readOnly`-gated) and a write scope of the whole workspace root.
 *
 * Unlike `ModeBSetupRunner`, which forwards its `--max-turns` budget to a
 * subprocess CLI flag, this runner's turn budget is an in-process
 * `ExecuteAgentContext.maxSteps` (an `isStepCount` stop condition on the
 * step's underlying `ToolLoopAgent`) — see `effectiveMaxTurns()` below for
 * how it's resolved, and `StepBudgetExhaustedError` (`harness/loop/errors.ts`)
 * for how a turn that runs out of steps before finishing is reported.
 *
 * Also calls `executeAgent` directly rather than the higher-level
 * `runAgent()` Mode A's Ask-turn path uses: `runAgent` asserts every
 * `agent.capabilities[]` entry against a `CapabilityRegistry`, but
 * `connect_source`/`build_context` declare `source_connect`/`context_build`
 * — capabilities outside the fixed `DEFAULT_CAPABILITIES` set a wren-project
 * Ask turn resolves. `executeAgent` (confirmed via `ExecuteAgentContext`'s
 * own shape) has no `capabilityRegistry` concept at all, so it runs the
 * bundle's dataflow with no capability assertion — exactly what dispatching
 * a setup-only capability needs, without inventing a parallel registry for
 * two names nothing else provides.
 */
export class ModeASetupRunner implements SetupStepRunner {
  constructor(private readonly options: ModeASetupRunnerOptions) {}

  /**
   * The `ExecuteAgentContext.maxSteps` budget this runner will actually pass
   * into `executeAgent` for a given `agentId` — the same value `run()`
   * computes internally. This was previously documented as always
   * `undefined` on the theory that "`executeAgent` has no turn-budget
   * concept at all" — that was already false when it was written: every
   * tools-bearing step ran as a `ToolLoopAgent` turn, and `ToolLoopAgent`
   * itself silently defaults to a 20-step budget (`ai`'s
   * `stopWhen: this.settings.stopWhen ?? isStepCount(20)`) whenever nothing
   * overrides it. There was a real, unconfigurable ceiling the whole time;
   * it just had no name and nothing here reported it. Now that `run()` below
   * threads an explicit `maxSteps` through, this reports the real value —
   * mirroring `ModeBSetupRunner.effectiveMaxTurns` — via the same
   * `resolveEffectiveMaxTurns` helper so the two can never disagree.
   */
  effectiveMaxTurns(agentId: string): number | undefined {
    return resolveEffectiveMaxTurns(this.options.maxTurns, agentId);
  }

  async run(runOptions: SetupStepRunOptions): Promise<SetupStepRunResult> {
    const { authChoice } = runOptions;
    const agentId = runOptions.agentId ?? CONNECT_SOURCE_AGENT_ID;

    if (authChoice.mode === "subscription") {
      throw new Error(
        `Mode A setup dispatch requires an api-key/local/gateway auth mode to dispatch "${agentId}" ` +
          `via the in-process vercel loop — got "subscription". Use ModeBSetupRunner ` +
          "(WREN_HARNESS_MODE=subscription) for a subscription auth choice instead.",
      );
    }

    const warbleBin = await resolveWarbleBinary(this.options.warbleBin);
    const providerPath = this.options.providerPath ?? DEFAULT_SETUP_PROVIDER_PATH;
    const callerSuppliedOutDir = this.options.outDir !== undefined;
    const outDir = this.options.outDir ?? (await mkdtemp(path.join(os.tmpdir(), "wren-harness-setup-mode-a-")));

    // `executeAgent` emits the UN-stamped `AgentEventInput` shape (no
    // `runId`/`seq` — it doesn't know either); `SetupStepRunOptions.onEvent`
    // is the caller-facing, fully-stamped `AgentEvent` shape. Wrapping via
    // `createAgentEventEmitter` (exactly how `runAgent` itself bridges the
    // same two shapes in `harness/session/run.ts`) is what stamps every
    // event from this turn with one shared `runId` and a monotonic `seq`
    // before it reaches `runOptions.onEvent`. The emitter itself no-ops when
    // `runOptions.onEvent` is undefined, so `emitter.emit` is always safe to
    // pass unconditionally.
    const emitter = createAgentEventEmitter(runOptions.onEvent);
    emitter.emit({ kind: "run.start", mode: "A", agentId });

    try {
      await runWarble(warbleBin, [
        "dispatch",
        "--target",
        "vercel",
        "--provider",
        providerPath,
        this.options.irPath,
        "--out",
        outDir,
      ]);

      const bundlePath = path.join(outDir, "bundle.json");
      const bundle = loadBundle(JSON.parse(await readFile(bundlePath, "utf-8")));

      const agent = bundle.agents.find((candidate) => candidate.id === agentId);
      if (!agent) {
        throw new Error(`compiled setup bundle has no "${agentId}" agent`);
      }

      const binding = buildUniformTierBinding(
        agent,
        deriveAdapterSpec(authChoice, this.options.model !== undefined ? { model: this.options.model } : {}),
      );
      const registry = createDefaultProviderRegistry();

      // Hardcoded, NOT `deriveEnforcement(agent)` — see this class's doc
      // comment above for why. `artifactWriteScope: "."` resolves against
      // `env`'s `rootDir` below, which IS `workspaceRoot` — so "." means
      // "anywhere under workspaceRoot", matching `setup_execution`'s
      // project-root write scope on the Mode B side.
      const policy: ExecutionPolicy = { readOnly: false, artifactWriteScope: "." };
      const env = createLocalExecutionEnv({ rootDir: runOptions.workspaceRoot });

      const nativeTools = createNativeToolRegistry();
      nativeTools.register(SETUP_EXECUTION_TOOL_NAME, () =>
        createSetupExecutionTool({ env, policy, workspaceRoot: runOptions.workspaceRoot }),
      );

      // Kept in lockstep with `effectiveMaxTurns()` above via the shared
      // `resolveEffectiveMaxTurns` helper, exactly like `ModeBSetupRunner.run()`
      // does for its own `--max-turns` flag.
      const maxSteps = this.effectiveMaxTurns(agentId);

      const artifacts = await withResolvedTools(
        agent,
        { nativeTools, enforcementPolicy: policy, executionEnv: env },
        (tools) =>
          executeAgent(agent, {
            binding,
            registry,
            tools,
            userInput: runOptions.prompt,
            onEvent: emitter.emit,
            ...(maxSteps !== undefined ? { maxSteps } : {}),
          }),
      );

      // Every setup component has exactly one step (`connect` / `build`), so
      // its `produces` artifact is the turn's final answer — mirroring
      // `ModeBSetupRunner`'s `result.finalText`, which is likewise "the last
      // thing the dispatched turn said."
      const producedName = agent.steps[0]?.produces;
      const finalText = producedName !== undefined ? String(artifacts.get(producedName) ?? "") : "";

      // `"answer"` is the closest of `RunFinishEvent.status`'s three literals
      // ("answer" | "refusal" | "error") to "a setup turn completed" — setup
      // has no envelope-gated refusal concept of its own (see this class's
      // doc comment), so a completed dispatch is reported the same way
      // `runAgent` reports a completed Ask turn that produced output.
      emitter.emit({ kind: "answer", text: finalText });
      emitter.emit({ kind: "run.finish", status: "answer" });

      // `sessionId: null`, not omitted: Mode A has no SDK subprocess
      // conversation to resume (`executeAgent` re-runs the bundle's dataflow
      // from scratch every call) — `null` is `SetupStepRunResult`'s
      // documented "the dispatcher itself reported no session id at all,"
      // which is exactly this case, distinct from a runner that simply never
      // set the field.
      return { finalText, sessionId: null };
    } catch (error) {
      // A `StepBudgetExhaustedError` is a distinguishable, honest failure
      // mode, not a generic one — surface that here rather than letting it
      // fall through as a bare "final message did not contain a
      // SETUP_STATUS line" once it reaches `parseSetupTerminal`'s caller
      // (which never even runs `parseSetupTerminal` on a thrown `run()`
      // error — see `executeSetupTurn`, `server/turn.ts` — it reports
      // `error.message` directly). No literal "Continue" checkpoint is
      // offered here (out of scope for this runner: Mode A has no SDK
      // session to resume — `sessionId: null` below, always) — just an
      // honest message pointing at where any partial work may have landed.
      if (error instanceof StepBudgetExhaustedError) {
        // Mutate `.message` in place (legal — only the constructor
        // parameters above are `readonly`, not the inherited `Error.message`)
        // rather than wrapping in a fresh `Error`: callers upstream (or
        // future ones) can still `instanceof StepBudgetExhaustedError` this
        // and read `.maxSteps`/`.stepId`/`.stepsCompleted`, while
        // `server/turn.ts`'s generic `failWithError(error.message, ...)`
        // path — which only ever reads `.message` — sees the enriched,
        // Mode-A-specific text instead of the generic one from
        // `harness/loop/errors.ts`.
        error.message =
          `setup step "${agentId}" ran out of steps (${error.maxSteps} max) before finishing — ` +
          `its partial work, if any, may still be on disk under ${runOptions.workspaceRoot}`;
      }
      const message = error instanceof Error ? error.message : String(error);
      // Mirrors `runAgent`'s own catch/emit/rethrow in `harness/session/run.ts`:
      // a thrown failure still gets a `run.finish` bookend (status "error")
      // rather than leaving the event stream hanging with a `run.start` and
      // nothing after it.
      emitter.emit({ kind: "error", message });
      emitter.emit({ kind: "run.finish", status: "error" });
      throw error;
    } finally {
      if (!callerSuppliedOutDir) {
        await rm(outDir, { recursive: true, force: true });
      }
    }
  }
}

export type SetupTerminalStatus = "ok" | "needs_input" | "error";

export interface SetupTerminalContext {
  /** The workspace root the project was scaffolded under. */
  readonly root: string;
  /** The project name (the scaffolded directory is `<root>/<name>`). */
  readonly name: string;
  /**
   * Which setup step this terminal check is verifying — a string, not
   * `SetupStepKey`, so this module (`harness/`) never has to import the BFF layer
   * (`server/compose.ts`); callers pass `turn.setupStepKey` straight through.
   * Undefined (or any value other than `"connect_resume"`/`"context"`) is
   * treated exactly like `"connect"`, matching every pre-existing caller/test
   * that never set this field.
   *
   * Three distinct `ok` verifications exist, one per step — a plain boolean
   * stopped being expressive enough once `context` joined `connect`/
   * `connect_resume`:
   *
   *  - `"connect"` (default): `<root>/<name>/wren_project.yml` must exist —
   *    the scaffold this step is supposed to have just written.
   *  - `"connect_resume"`: by the time this step runs, `wren_project.yml`
   *    already exists (written during `connect`), so re-checking it would be
   *    vacuous — it would let a resume's claimed "ok" pass on pure agent
   *    self-report, defeating the "don't trust the agent" design. Instead this
   *    checks for a distinct `.wren-validated` sentinel file, which
   *    `composeSetupPrompt`'s `connect_resume` branch instructs the agent to
   *    create ONLY after a successful `wren profile add`/validate call. A
   *    sentinel file is used (rather than inspecting wren's own profile
   *    registry, e.g. `~/.wren/profiles.yml`) because that registry's exact
   *    path/format is not something this BFF can reliably assume is stable
   *    across wren CLI versions/environments; the sentinel is fully within our
   *    own control and lives right next to `wren_project.yml`.
   *  - `"context"`: checks `<root>/<name>/target/mdl.json` — the artifact
   *    `wren context build` writes by default (confirmed via `wren context
   *    build --help`: "Build into target/mdl.json for the engine" — and by
   *    inspecting a real built fixture, whose top-level shape is
   *    `{ catalog, schema, models: [...], relationships, views, cubes,
   *    dataSource, layoutVersion }`). A missing file, invalid JSON, or a
   *    `models` array with zero entries, no nested cube measure, or (when a
   *    worklog is available) no successfully completed recognized schema
   *    discovery command all downgrade a claimed "ok" to "error" — an agent
   *    that ran `wren context build` against an empty/unfinished MDL project
   *    must not be trusted just because it self-reports success.
   *
   * `needs_input` gets an analogous check, but only for `"connect"`
   * (undefined/default): `needs_input` IS `connect`'s designed success
   * ending — its own prompt (`composeSetupPrompt`) promises a scaffolded
   * project directory, a `wren_project.yml`, and an empty `.env` template
   * before it stops to wait for the user. Without this check, an agent that
   * burned its whole turn on the skill's Preflight and produced none of
   * those files could still report `needs_input`, and the wizard would offer
   * the "I've filled in .env" affordance for a project that was never
   * created. `connect_resume` and `context` do NOT get this check: neither
   * step's prompt promises a NEW on-disk artifact as part of a `needs_input`
   * ending (e.g. `context`'s `needs_input` is "ambiguous relationship,
   * please confirm" — there is nothing new on disk to verify), so there is
   * no analogous claim to hold them to.
   */
  readonly stepKey?: string;
  /**
   * The data source the user actually selected for this project (e.g.
   * `"duckdb"`), as already known to the BFF from the setup form — never
   * re-derived from anything an agent turn wrote. Only consulted when
   * `stepKey === "connect_resume"`; every other step (and every
   * pre-existing caller/test that omits this field) is unaffected.
   *
   * This backs a SECOND, additive `ok` check for `connect_resume`, layered
   * on top of the `.wren-validated` sentinel check above: sentinel presence
   * only proves *some* profile validated successfully, not that it was the
   * *right* one. Two deliberately-NOT-taken approaches, for the record:
   *
   *  - Reading the onboarding skill's scratch file (`conn.profile.yml`)
   *    directly: rejected. The skill's own happy path deletes that file the
   *    moment validation succeeds (see `skills_content/onboarding/SKILL.md`
   *    step 3.5), so a post-turn check reading it would be a no-op on
   *    exactly the success case it exists to guard. It would also hardcode
   *    that scratch filename into this BFF layer, which a prior decision
   *    deliberately undid (this module is meant to stay agnostic of the
   *    skill's internal scratch-file naming).
   *  - Reading `~/.wren/profiles.yml`: already rejected above for the
   *    sentinel check, for the same environment/version-stability reason.
   *
   * Instead this reads `<root>/<name>/wren_project.yml` — an artifact this
   * module already reads elsewhere in this same function — and checks two
   * of its fields against ground truth the wren CLI itself is responsible
   * for keeping consistent:
   *
   *  1. `profile:` must be non-empty. The CLI's own
   *     `maybe_pin_new_profile_to_project` gate (in `core/wren/src/wren/
   *     context.py`) refuses to pin a profile whose datasource conflicts
   *     with an already-declared one, leaving `profile:` unset — so an
   *     empty `profile:` here means the CLI itself never committed to a
   *     pin, regardless of what the agent claims.
   *  2. `data_source:` must match this field (case-insensitive, trimmed).
   *     `pin_profile` always writes `profile:` and `data_source:` together
   *     from the SAME profile, so this catches the case the gate above
   *     can't: an agent that force-repins via `wren context set-profile
   *     <project>` (which has no mismatch gate — it's an explicit override)
   *     onto a profile for the wrong data source.
   *
   * A mismatch or missing pin downgrades a claimed "ok" to "error" with a
   * message that names the profile fields, not `.env` — the wrong-datasource
   * failure mode this exists to catch has nothing to do with `.env`'s
   * contents.
   */
  readonly expectedSourceType?: string;
  /**
   * The turn's tool-call worklog (a `ToolStep[]`, defined in
   * `server/wire-types.ts`), declared here as a narrow LOCAL structural type
   * rather than imported — for the same one-way-dependency reason `stepKey`
   * above is a bare `string`, not `SetupStepKey`: this module (`harness/`)
   * must never import from `server/`. Optional and additive: every existing
   * caller/test that omits it keeps the exact pre-existing behavior below.
   *
   * Consulted when `stepKey === "context"`: an `ok` must have successful
   * discovery evidence as well as the structural MDL gate, while an `error`
   * still uses it for the diagnostic attribution described by
   * {@link firstFailedExec}.
   */
  readonly worklog?: readonly SetupWorklogEntry[];
}

/**
 * The minimal structural shape of a `ToolStep` (`server/wire-types.ts`) that
 * {@link firstFailedExec} needs. Declared locally rather than imported — see
 * `SetupTerminalContext.worklog`'s doc comment.
 */
export interface SetupWorklogEntry {
  readonly label: string;
  readonly input?: unknown;
  readonly detail?: string;
}

/**
 * Reads a single top-level `field: value` line out of a YAML file using the
 * same lightweight line-scan convention already used elsewhere in this
 * codebase (e.g. `server/compose.ts`'s `countRelationships`/`listModelNames`)
 * rather than pulling in a YAML parser dependency. Matches only an unindented
 * `field:` key (so it can't be fooled by a same-named key nested under
 * another mapping), strips a single layer of surrounding quotes, and returns
 * `undefined` if the file is missing/unreadable or the field isn't present.
 */
function readProjectYamlField(yamlPath: string, field: string): string | undefined {
  let content: string;
  try {
    content = readFileSync(yamlPath, "utf-8");
  } catch {
    return undefined;
  }
  const pattern = new RegExp(`^${field}:\\s*(.+?)\\s*$`, "m");
  const match = pattern.exec(content);
  if (!match) {
    return undefined;
  }
  const raw = match[1]!;
  const unquoted = /^"(.*)"$/.exec(raw) ?? /^'(.*)'$/.exec(raw);
  return (unquoted ? unquoted[1]! : raw).trim();
}

export interface SetupTerminalResult {
  readonly status: SetupTerminalStatus;
  readonly message: string;
  /**
   * A deterministic workflow outcome, deliberately separate from the
   * human-facing message so callers never have to re-classify prose.
   * Present only when a context turn reached a terminal status without a
   * successfully recorded schema-discovery command.
   */
  readonly failureKind?: "no_successful_schema_discovery";
}

const SETUP_STATUS_LINE = /^SETUP_STATUS:\s*(ok|needs_input|error)\b\s*[-:]?\s*(.*)$/i;

function defaultMessageFor(status: SetupTerminalStatus): string {
  switch (status) {
    case "ok":
      return "setup completed successfully";
    case "needs_input":
      return "waiting for user input";
    case "error":
      return "setup failed";
  }
}

/** Counts the built MDL's models and declared cube measures; unreadable/malformed content is deliberately treated as empty rather than trusted. */
function countMdlContents(mdlPath: string): { readonly models: number; readonly measures: number } {
  try {
    const parsed = JSON.parse(readFileSync(mdlPath, "utf-8")) as { models?: unknown; cubes?: unknown };
    const models = Array.isArray(parsed.models) ? parsed.models.length : 0;
    const measures = Array.isArray(parsed.cubes)
      ? parsed.cubes.reduce((count, cube) => {
          if (typeof cube !== "object" || cube === null) return count;
          const candidateMeasures = (cube as { measures?: unknown }).measures;
          return count + (Array.isArray(candidateMeasures) ? candidateMeasures.length : 0);
        }, 0)
      : 0;
    return { models, measures };
  } catch {
    return { models: 0, measures: 0 };
  }
}

/**
 * Returns the path of the first artifact `connect`'s prompt promises but
 * that is missing from disk, or `undefined` if all three are present. Checked
 * in the order a real `connect` run would produce them, so the message names
 * the earliest failure (e.g. a missing project dir implies the other two are
 * also missing, but naming the dir is the most useful signal).
 */
function missingConnectArtifact(context: SetupTerminalContext): string | undefined {
  const projectDir = path.join(context.root, context.name);
  if (!existsSync(projectDir)) {
    return projectDir;
  }
  const projectYml = path.join(projectDir, "wren_project.yml");
  if (!existsSync(projectYml)) {
    return projectYml;
  }
  const envFile = path.join(projectDir, ".env");
  if (!existsSync(envFile)) {
    return envFile;
  }
  return undefined;
}

/**
 * Matches a `setup_execution` "exec" call's `ToolStep.detail` — a
 * `summarizeToolOutput`-bounded (200-char) `JSON.stringify` of
 * `{exitCode, stdout, stderr, ...}` (see `harness/tools/setup-native.ts`) or
 * a Mode-B Bash result's `Exit code: N` text, and extracts the exit code.
 * A regex, not `JSON.parse`: once `stdout`/`stderr` push a stringified object
 * past 200 characters (routine for a CLI usage/error message), the truncated
 * detail is no longer valid JSON, but Mode A serializes `exitCode` first.
 */
const SETUP_EXEC_EXIT_CODE = /^\{"exitCode":(-?\d+)/;
const MODE_B_BASH_EXIT_CODE = /\bexit\s+code\s*:?\s*(-?\d+)\b/i;

/**
 * Mode A registers the scoped execution capability under its policy name,
 * while Mode B's streamed SDK events retain the underlying `Bash` tool name.
 * Both names represent the same setup-only command boundary at this layer.
 */
const MODE_B_SETUP_EXECUTION_TOOL_NAME = "Bash";

function isSetupExecutionEntry(entry: SetupWorklogEntry): boolean {
  return entry.label === SETUP_EXECUTION_TOOL_NAME || entry.label === MODE_B_SETUP_EXECUTION_TOOL_NAME;
}

function execExitCode(detail: string | undefined): number | undefined {
  if (detail === undefined) return undefined;
  const match = SETUP_EXEC_EXIT_CODE.exec(detail) ?? MODE_B_BASH_EXIT_CODE.exec(detail);
  return match ? Number(match[1]) : undefined;
}

/** Best-effort extraction of the `command` an exec-action worklog entry ran, for a readable error message; `undefined` if the input isn't the expected shape. */
function execCommandOf(entry: SetupWorklogEntry): string | undefined {
  const input = entry.input;
  if (typeof input !== "object" || input === null) return undefined;
  const command = (input as Record<string, unknown>).command;
  return typeof command === "string" ? command : undefined;
}

/**
 * Finds the first setup execution call in `worklog` whose recorded result was
 * a non-zero exit code — i.e. a command that genuinely ran and failed,
 * as opposed to one whose tool invocation merely reported success. This
 * distinction matters because `ToolStep.state` alone cannot make it: every
 * setup execution call reports `state: "done"` as long as the TOOL MECHANISM
 * itself didn't throw (it ran a shell command and captured
 * whatever came back) — regardless of whether the underlying shell command
 * itself succeeded. A nonexistent CLI subcommand (e.g. `wren generate-mdl` —
 * `generate-mdl` is a skill document, not a command; see
 * `composeSetupPrompt`'s `context` branch) still shows `state: "done"`; only
 * the nested `detail` JSON's `exitCode` carries the real signal. See
 * `parseSetupTerminal`'s use of this for why: an `error` status whose own
 * claimed reason blames the connection/data source is only trustworthy if
 * nothing in the trace shows a command failing outright first.
 *
 * KNOWN LIMITATION (disclosed, not silently assumed away): this flags ANY
 * non-zero exit among the step's setup execution calls, without judging
 * whether that particular command was expected to fail as part of ordinary
 * exploration (e.g. a `grep` with no match, or a conditional shell test) —
 * doing so reliably would require actually understanding the command's
 * intent, which this module has no basis to do. The returned message is
 * worded as advisory ("does not by itself confirm...") rather than as a
 * counter-assertion for exactly this reason.
 */
function firstFailedExec(worklog: readonly SetupWorklogEntry[]): { readonly command: string | undefined; readonly exitCode: number } | undefined {
  for (const entry of worklog) {
    if (!isSetupExecutionEntry(entry)) continue;
    const exitCode = execExitCode(entry.detail);
    if (exitCode !== undefined && exitCode !== 0) {
      return { command: execCommandOf(entry), exitCode };
    }
  }
  return undefined;
}

/**
 * Whether `command` has one of the schema-introspection shapes currently
 * documented by the generate-mdl skill. This is deliberately an allowlist:
 * a Wren SQL query, inline Python using SQLAlchemy or a documented database
 * driver, or a connector CLI is only counted when its command text ALSO has
 * recognizable Phase-2 discovery evidence: a schema/catalog query, a table
 * listing command, or a documented table/column discovery API. In particular,
 * connectivity probes such as `SELECT 1` and arbitrary data queries do NOT
 * count; neither do skill fetches or the context build/validate lifecycle
 * commands.
 *
 * KNOWN LIMITATIONS (disclosed, not silently assumed away): a worklog stores
 * only the shell command, not an executed script's contents or its query
 * result. Therefore this recognizes an ATTEMPT with recognizable discovery
 * evidence, not a successful schema read; it cannot recognize opaque script
 * paths, database-specific CLI metacommands, every future driver/CLI, or
 * prove that a matched query returned schema rows. Expanding beyond the
 * evidenced command shapes would turn this from an allowlist into guesswork,
 * so unmatched commands intentionally do not count.
 */
const SCHEMA_DISCOVERY_EVIDENCE =
  /\b(?:information_schema|pg_catalog|sqlite_master|system\.tables|show\s+(?:full\s+)?(?:tables|columns)|describe\s+(?:table|schema)|\.tables|get_table_names|get_columns|get_foreign_keys|get_pk_constraint|get_unique_constraints|list_tables|get_table)\b/i;

const SCHEMA_INTROSPECTION_COMMANDS = [
  /\bwren(?:\s+query)?\s+--sql(?:\s|=)/i,
  /\b(?:python(?:3(?:\.\d+)?)?|uv\s+run\s+python)\b[\s\S]*\b(?:sqlalchemy|psycopg|asyncpg|google\.cloud\.bigquery|snowflake\.connector|clickhouse_driver)\b/i,
  /\b(?:psql|mysql|sqlite3|duckdb|snowsql|clickhouse-client|trino(?:-cli)?)\b[\s\S]*(?:\s(?:-c|--command|--execute|--query)\s|\b(?:information_schema|show\s+(?:tables|columns)|describe\s+(?:table|schema)|\.tables)\b)/i,
  /\bbq\s+query\b/i,
] as const;

export type RecordedSchemaDiscovery =
  | { readonly kind: "successful"; readonly command: string }
  | { readonly kind: "failed"; readonly command: string; readonly exitCode: number }
  | { readonly kind: "none" };

/**
 * The single setup-workflow contract for recognisable schema discovery. A
 * matching command is evidence only after it completed with exit code zero;
 * command text alone proves neither execution nor a readable schema. Callers
 * use this for both terminal acceptance and the no-introspection diagnostic,
 * rather than reimplementing the allowlist elsewhere.
 */
export function classifyRecordedSchemaDiscovery(worklog: readonly SetupWorklogEntry[]): RecordedSchemaDiscovery {
  let failed: Extract<RecordedSchemaDiscovery, { readonly kind: "failed" }> | undefined;
  for (const entry of worklog) {
    const command = isSetupExecutionEntry(entry) ? execCommandOf(entry) : undefined;
    if (
      command === undefined ||
      !SCHEMA_DISCOVERY_EVIDENCE.test(command) ||
      !SCHEMA_INTROSPECTION_COMMANDS.some((pattern) => pattern.test(command))
    ) {
      continue;
    }
    const exitCode = execExitCode(entry.detail);
    if (exitCode === 0) return { kind: "successful", command };
    if (exitCode !== undefined && failed === undefined) failed = { kind: "failed", command, exitCode };
  }
  return failed ?? { kind: "none" };
}

/** A narrow terminal-message check: only override a context error that explicitly claims a zero-table/model outcome. */
function claimsNoTablesOrModels(message: string): boolean {
  return /\b(?:no|zero)\s+(?:tables?|models?)\b|\b0\s+(?:tables?|models?)\b/i.test(message);
}

/**
 * Parses the LAST `SETUP_STATUS: ok|needs_input|error` line out of a setup
 * turn's finalText (the terminal contract lives in the composed
 * prompt, not warble — the agent is instructed to emit this line, and an
 * agent narrating its plan mid-message could emit misleading earlier
 * "SETUP_STATUS"-like text, so only the last line counts).
 *
 * For `ok`, independently verifies an on-disk artifact before trusting the
 * agent's self-report, rather than blindly advancing the wizard — see
 * `SetupTerminalContext.stepKey`'s doc comment for exactly which artifact each
 * step checks (`wren_project.yml` / `.wren-validated` / `target/mdl.json`
 * with at least one model and nested cube measure).
 *
 * The `context` step's `ok` check also requires a successfully completed
 * recognized schema-discovery command whenever a worklog is available. It
 * does NOT try to infer fabrication from model names or columns. Two semantic
 * heuristics were considered and rejected as unsafe:
 *   - Flagging a model literally named "example": a real warehouse can
 *     genuinely have a table named "example" (the composed `context` prompt
 *     itself explicitly tolerates a pre-existing "example" placeholder
 *     surviving on disk), so this would false-positive on a legitimate build.
 *   - Flagging models with zero columns: a fabricating agent writes
 *     plausible-looking column lists (that's what makes the fabrication
 *     convincing), so this wouldn't even have caught the real incident —
 *     it's a weak signal with no compensating safety benefit.
 * No cheap structural signal reliably distinguishes fabricated MDL from a
 * real one. The completed-discovery gate is therefore the deterministic
 * provenance boundary here; the prompt still tells the agent to never
 * fabricate and to report failed discovery honestly as additional guidance.
 */
export function parseSetupTerminal(finalText: string, context: SetupTerminalContext): SetupTerminalResult {
  const lines = finalText.split("\n");
  let matched: { status: SetupTerminalStatus; message: string } | undefined;

  for (const line of lines) {
    const match = SETUP_STATUS_LINE.exec(line.trim());
    if (match) {
      const status = match[1]!.toLowerCase() as SetupTerminalStatus;
      const message = match[2]?.trim();
      matched = { status, message: message && message.length > 0 ? message : defaultMessageFor(status) };
    }
  }

  if (!matched) {
    return {
      status: "error",
      message: "the setup agent's final message did not contain a SETUP_STATUS line",
    };
  }

  if (matched.status === "ok") {
    if (context.stepKey === "context") {
      if (context.worklog !== undefined) {
        const discovery = classifyRecordedSchemaDiscovery(context.worklog);
        if (discovery.kind === "none") {
          return {
            status: "error",
            failureKind: "no_successful_schema_discovery",
            message:
              "The agent never completed recognized schema discovery in its recorded worklog, so its model/build result cannot be accepted. This is an agent-workflow failure, not evidence that the connection or data source lacks tables.",
          };
        }
        if (discovery.kind === "failed") {
          return {
            status: "error",
            message: `\`${discovery.command}\` failed with exit code ${discovery.exitCode} during schema discovery — a model/build result cannot be accepted until that command/tool failure is resolved; this is not evidence that the connection or data source lacks tables.`,
          };
        }
      }
      const mdlPath = path.join(context.root, context.name, "target", "mdl.json");
      if (!existsSync(mdlPath)) {
        return {
          status: "error",
          message: `the setup agent reported "ok" but ${mdlPath} does not exist — treating this as a failed context build`,
        };
      }
      const { models: modelCount, measures: measureCount } = countMdlContents(mdlPath);
      if (modelCount < 1) {
        return {
          status: "error",
          message: `the setup agent reported "ok" but ${mdlPath} has ${modelCount} models — treating this as a failed context build`,
        };
      }
      if (measureCount < 1) {
        return {
          status: "error",
          message: `the setup agent reported "ok" but ${mdlPath} has ${measureCount} measures — treating this as a failed context build`,
        };
      }
    } else {
      const markerName = context.stepKey === "connect_resume" ? ".wren-validated" : "wren_project.yml";
      const marker = path.join(context.root, context.name, markerName);
      if (!existsSync(marker)) {
        return {
          status: "error",
          message: `the setup agent reported "ok" but ${marker} does not exist — treating this as a failed setup`,
        };
      }
      if (context.stepKey === "connect_resume" && context.expectedSourceType !== undefined) {
        const projectYml = path.join(context.root, context.name, "wren_project.yml");
        const pinnedProfile = readProjectYamlField(projectYml, "profile");
        if (pinnedProfile === undefined || pinnedProfile.length === 0) {
          return {
            status: "error",
            message: `the setup agent reported "ok" but ${projectYml} has no "profile:" pin — the connection profile was never actually pinned to this project (check the profile, not .env)`,
          };
        }
        const pinnedDataSource = readProjectYamlField(projectYml, "data_source");
        if ((pinnedDataSource ?? "").trim().toLowerCase() !== context.expectedSourceType.trim().toLowerCase()) {
          return {
            status: "error",
            message: `the setup agent reported "ok" but ${projectYml}'s "data_source: ${pinnedDataSource ?? "(missing)"}" does not match the selected data source "${context.expectedSourceType}" — the connection profile is for the wrong data source (check the profile, not .env)`,
          };
        }
      }
    }
  } else if (matched.status === "needs_input" && (context.stepKey === undefined || context.stepKey === "connect")) {
    const missing = missingConnectArtifact(context);
    if (missing !== undefined) {
      return {
        status: "error",
        message: `the setup agent reported "needs_input" but ${missing} does not exist — treating this as a failed connect`,
      };
    }
  } else if (matched.status === "error" && context.stepKey === "context" && context.worklog !== undefined) {
    // The agent's own `SETUP_STATUS: error` line for the `context` step routinely
    // blames the connection or data source (e.g. "schema introspection found no
    // tables"), but that is only an honest conclusion if an introspection command
    // actually ran and completed. If the agent instead ran a nonexistent or
    // otherwise-failing CLI command (its own tool-use mistake, not a fact about
    // the data source), the "no tables" framing is a false attribution. Before
    // trusting the agent's message, check the turn's own worklog for a
    // `setup_execution` call that exited non-zero, and reframe if one is found.
    const failedExec = firstFailedExec(context.worklog);
    if (failedExec !== undefined) {
      const command = failedExec.command !== undefined ? `\`${failedExec.command}\`` : "a command";
      return {
        status: "error",
        message: `${command} failed with exit code ${failedExec.exitCode} during this step — a command in this step's own history exited non-zero, so this step's error framing can't be trusted until that's ruled out; this is a command/tool failure, not by itself evidence that the connection or data source lacks tables. The agent's own report was: "${matched.message}"`,
      };
    }
    if (claimsNoTablesOrModels(matched.message) && classifyRecordedSchemaDiscovery(context.worklog).kind === "none") {
      return {
        status: "error",
        failureKind: "no_successful_schema_discovery",
        message:
          "The agent never attempted schema introspection in its recorded worklog — it reported a zero-table/model outcome without a recognized introspection command. This is an agent-workflow failure, not evidence that the connection or data source lacks tables.",
      };
    }
  }

  return matched;
}
