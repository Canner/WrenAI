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
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthChoice } from "../auth/index.js";
import { loadBundleWithProvenance } from "../bundle/loader.js";
import { runWarble } from "../compile/pipeline.js";
import { resolveWarbleBinary } from "../compile/resolve-binary.js";
import { createAgentEventEmitter, type AgentEvent, type AgentEventInput } from "../events/index.js";
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
import type { AdapterSpec } from "../providers/index.js";
import { deriveAdapterSpec } from "../route/adapter-spec.js";
import { resolveCodexLocalCli } from "../route/codex-local-cli.js";
import type { ResolvedCli } from "../route/agent-sdk-cli.js";
import { runModeBDefault } from "../route/mode-b.js";
import { buildUniformTierBinding } from "../route/tier-binding.js";
import { createNativeToolRegistry, createSetupExecutionTool, SETUP_EXECUTION_TOOL_NAME } from "../tools/index.js";
import { withResolvedTools } from "../tools/wiring.js";
import { CodexSetupEventMapper } from "./codex-events.js";

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
  /** The workspace root the initial connect turn scaffolds `<name>/` into. */
  readonly workspaceRoot: string;
  /**
   * The persisted, validated single-segment project name. Required by the
   * project-bound `connect_resume` and `context` turns; optional only so
   * pre-existing initial-connect callers retain their workspace-root cwd.
   */
  readonly projectName?: string;
  /**
   * Step semantics for the dispatch cwd. Initial `connect` is intentionally
   * workspace-bound so it can scaffold; later turns are project-bound.
   */
  readonly stepKey?: "connect" | "connect_resume" | "context";
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

export interface SetupRunnerSet {
  readonly claudeSubscription: SetupStepRunner;
  readonly codexSubscription: SetupStepRunner;
  readonly nonSubscription: SetupStepRunner;
}

/** Single provider-aware selection seam shared by boot wiring and tests. */
export function selectSetupRunnerForAuth(authChoice: AuthChoice, runners: SetupRunnerSet): SetupStepRunner {
  if (authChoice.mode !== "subscription") return runners.nonSubscription;
  return authChoice.provider === "codex" ? runners.codexSubscription : runners.claudeSubscription;
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

const SAFE_PROJECT_NAME = /^[a-zA-Z0-9_-]+$/;

/**
 * Subscription dispatchers have one cwd per turn, while their guarded setup
 * tool accepts a separately bounded working root. Keep the initial scaffold
 * at the workspace root. Immediately before a project-bound dispatch,
 * canonicalize the existing workspace/project dirs and require the latter to
 * be a strict descendant of the former. This is a pre-dispatch guard, not a
 * claim that filesystem paths cannot change after the child process starts.
 */
function resolveModeBUserProject(runOptions: SetupStepRunOptions, agentId: string): string {
  const stepKey = runOptions.stepKey ?? (agentId === BUILD_CONTEXT_AGENT_ID ? "context" : "connect");
  if (stepKey === "connect") return runOptions.workspaceRoot;

  const projectName = runOptions.projectName;
  if (projectName === undefined || !SAFE_PROJECT_NAME.test(projectName)) {
    throw new Error(`Mode B ${stepKey} requires a validated single-segment projectName`);
  }

  const canonicalDirectory = (directory: string, label: string): string => {
    if (!existsSync(directory)) throw new Error(`Mode B ${stepKey} ${label} must exist before dispatch`);
    if (!statSync(directory).isDirectory()) throw new Error(`Mode B ${stepKey} ${label} must be a directory`);
    return realpathSync(directory);
  };
  const canonicalWorkspace = canonicalDirectory(runOptions.workspaceRoot, "workspace root");
  const projectDir = path.resolve(runOptions.workspaceRoot, projectName);
  const canonicalProject = canonicalDirectory(projectDir, "project directory");
  const relative = path.relative(canonicalWorkspace, canonicalProject);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Mode B ${stepKey} project directory must be a strict descendant of the setup workspace root`);
  }
  return canonicalProject;
}

export interface ModeBSetupRunnerOptions {
  /** Path to the committed genbi-setup IR (e.g. `warble/genbi-setup/ir.golden.json`) — see `resolveSetupIrPath`. */
  readonly irPath: string;
  readonly warbleBin?: string;
  readonly agentSdkBin?: string;
  readonly outDir?: string;
  readonly workDir?: string;
  /** Live dispatcher config generated from the persisted runtime tier rows. */
  readonly getModelsConfig?: () => string | undefined;
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

    const modelsConfig = this.options.getModelsConfig?.();
    const userProject = resolveModeBUserProject(runOptions, agentId);
    const result = await runModeBDefault({
      authChoice,
      // Unused: `irPath` below makes `runModeBDefault` skip compileProfile
      // entirely (see its short-circuit), so this value is never read. It is
      // set to the same setup IR for clarity, not because it is consulted.
      profileSource: this.options.irPath,
      userProject,
      question: runOptions.prompt,
      agentId,
      irPath: this.options.irPath,
      ...(this.options.warbleBin !== undefined ? { warbleBin: this.options.warbleBin } : {}),
      ...(this.options.agentSdkBin !== undefined ? { agentSdkBin: this.options.agentSdkBin } : {}),
      ...(this.options.outDir !== undefined ? { outDir: this.options.outDir } : {}),
      ...(this.options.workDir !== undefined ? { workDir: this.options.workDir } : {}),
      ...(modelsConfig !== undefined ? { modelsConfig } : {}),
      ...(maxTurns !== undefined ? { maxTurns } : {}),
      ...(runOptions.onEvent !== undefined ? { onEvent: runOptions.onEvent } : {}),
      ...(runOptions.resumeSessionId !== undefined ? { resumeSessionId: runOptions.resumeSessionId } : {}),
    });

    return { finalText: result.finalText, ...(result.sessionId !== undefined ? { sessionId: result.sessionId } : {}) };
  }
}

const CODEX_BILLING_ENV_KEYS = new Set([
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "OPENAI_ORGANIZATION",
  "OPENAI_ORG_ID",
  "OPENAI_PROJECT",
  "OPENAI_PROJECT_ID",
]);

export interface CodexSetupRunnerOptions {
  readonly irPath: string;
  readonly getStrongModel: () => string;
  readonly codexLocalBin?: string;
  /** Test/dev override for a command with required prefix args. */
  readonly codexLocalCli?: ResolvedCli;
  readonly codexBin?: string;
  readonly mcpServer?: ResolvedCli;
  readonly timeoutMs?: number;
}

/**
 * Setup-only Codex subscription runner. It invokes the target's `dispatch`
 * command directly against the committed setup IR and exposes exactly one
 * guarded MCP tool. Normal Ask routing never calls this class.
 */
export class CodexSetupRunner implements SetupStepRunner {
  constructor(private readonly options: CodexSetupRunnerOptions) {}

  async run(runOptions: SetupStepRunOptions): Promise<SetupStepRunResult> {
    if (runOptions.authChoice.mode !== "subscription" || runOptions.authChoice.provider !== "codex") {
      throw new Error("Codex setup runner requires a Codex subscription auth choice");
    }
    const agentId = runOptions.agentId ?? CONNECT_SOURCE_AGENT_ID;
    if (agentId !== CONNECT_SOURCE_AGENT_ID && agentId !== BUILD_CONTEXT_AGENT_ID) {
      throw new Error(`Codex setup only supports "${CONNECT_SOURCE_AGENT_ID}" and "${BUILD_CONTEXT_AGENT_ID}"`);
    }
    const model = this.options.getStrongModel().trim();
    if (!model) throw new Error("Codex setup requires a configured strong-tier model");

    const cli = this.options.codexLocalCli ?? (await resolveCodexLocalCli(this.options.codexLocalBin));
    const traceDir = this.options.mcpServer ? undefined : await mkdtemp(path.join(os.tmpdir(), "wren-codex-setup-trace-"));
    const tracePath = traceDir ? path.join(traceDir, "setup-execution.jsonl") : undefined;
    if (tracePath) await writeFile(tracePath, "", { encoding: "utf8", mode: 0o600 });
    const mcp = this.options.mcpServer ?? defaultCodexSetupMcpInvocation(tracePath!);
    const timeoutMs = this.options.timeoutMs ?? 10 * 60 * 1000;
    const turnRoot = resolveModeBUserProject(runOptions, agentId);
    const args = [
      ...cli.prefixArgs,
      "dispatch",
      this.options.irPath,
      runOptions.prompt,
      "--component",
      agentId,
      "--project",
      turnRoot,
      "--model",
      model,
      "--server",
      "setup",
      "--server-command",
      mcp.command,
      ...mcp.prefixArgs.flatMap((arg) => (arg.startsWith("-") ? [`--server-arg=${arg}`] : ["--server-arg", arg])),
      "--server-arg=--workspace-root",
      "--server-arg",
      turnRoot,
      "--source-tool",
      SETUP_EXECUTION_TOOL_NAME,
      "--context-tool",
      SETUP_EXECUTION_TOOL_NAME,
      "--timeout",
      String(timeoutMs),
      ...(this.options.codexBin ? ["--codex-bin", this.options.codexBin] : []),
      "--stream-json",
    ];

    const emitter = createAgentEventEmitter(runOptions.onEvent);
    emitter.emit({ kind: "run.start", mode: "B", agentId });
    const mapper = new CodexSetupEventMapper(tracePath);
    try {
      const finalText = await spawnCodexSetup(cli.command, args, mapper, emitter.emit, timeoutMs + 5_000);
      emitter.emit({ kind: "run.finish", status: "answer" });
      return { finalText };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emitter.emit({ kind: "error", message });
      emitter.emit({ kind: "run.finish", status: "error" });
      throw error;
    } finally {
      if (traceDir) await rm(traceDir, { recursive: true, force: true });
    }
  }
}

function defaultCodexSetupMcpInvocation(tracePath: string): ResolvedCli {
  return {
    command: process.execPath,
    prefixArgs: [fileURLToPath(new URL("../../server/codex-setup-mcp.js", import.meta.url)), "--trace-path", tracePath],
  };
}

function sanitizedCodexSetupEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => value !== undefined && !CODEX_BILLING_ENV_KEYS.has(key.toUpperCase()),
    ),
  );
}

function spawnCodexSetup(
  command: string,
  args: readonly string[],
  mapper: CodexSetupEventMapper,
  emit: (event: AgentEventInput) => void,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      env: sanitizedCodexSetupEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const terminate = (signal: NodeJS.Signals) => {
      if (child.pid !== undefined && process.platform !== "win32") {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // Fall through to the direct child.
        }
      }
      child.kill(signal);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate("SIGTERM");
      killTimer = setTimeout(() => terminate("SIGKILL"), 1_000);
    }, timeoutMs);
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      if (settled || !line.trim()) return;
      try {
        const event = mapper.nextLine(line);
        if (event) emit(event);
      } catch (error) {
        settled = true;
        clearTimeout(timer);
        terminate("SIGTERM");
        killTimer = setTimeout(() => terminate("SIGKILL"), 1_000);
        reject(error);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 8_192) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      reject(new Error(`warble-codex-local failed to start: ${error.message}`));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      lines.close();
      // Do not cancel an already-scheduled process-group SIGKILL here. The
      // direct dispatcher can exit on SIGTERM while one of its descendants
      // ignores the signal; the escalation still has to reap that descendant.
      if (settled) return;
      settled = true;
      if (timedOut) {
        reject(new Error(`warble-codex-local timed out after ${timeoutMs}ms`));
      } else if (code !== 0) {
        reject(new Error(`warble-codex-local exited with ${code ?? signal ?? "unknown"}: ${stderr.trim()}`));
      } else {
        try {
          resolve(mapper.result());
        } catch (error) {
          reject(error);
        }
      }
    });
  });
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
  /** Live strong-tier adapter/model binding from persisted runtime settings. */
  readonly getStrongAdapterSpec?: (authChoice: AuthChoice) => AdapterSpec;
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
      const bundle = loadBundleWithProvenance(JSON.parse(await readFile(bundlePath, "utf-8")), {
        warbleBin,
        profileSource: this.options.irPath,
      });

      const agent = bundle.agents.find((candidate) => candidate.id === agentId);
      if (!agent) {
        throw new Error(`compiled setup bundle has no "${agentId}" agent`);
      }

      const adapterSpec = this.options.getStrongAdapterSpec
        ? this.options.getStrongAdapterSpec(authChoice)
        : deriveAdapterSpec(authChoice, this.options.model !== undefined ? { model: this.options.model } : {});
      const binding = buildUniformTierBinding(agent, adapterSpec);
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
   *    dataSource, layoutVersion }`). A missing file, invalid JSON, a
   *    `models` array with zero entries, or (when a worklog is available) no
   *    successfully completed recognized schema
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
  /**
   * A host-recorded, identity-bound completed prefix from earlier corrective
   * context attempts. Agent prose never supplies this value. It is optional
   * so callers that only have one worklog retain the original behavior.
   */
  readonly priorContextLifecycle?: ContextLifecyclePrefix;
}

/**
 * The minimal structural shape of a `ToolStep` (`server/wire-types.ts`) that
 * {@link firstFailedExec} needs. Declared locally rather than imported — see
 * `SetupTerminalContext.worklog`'s doc comment.
 *
 * `state` mirrors `ToolStep.state` and is ALREADY populated correctly, today,
 * for every mode: `LiveWorkLog.ingest` (`server/fold.ts`) sets it straight
 * from the originating `AgentEvent`'s own structured `status`/`outcome`
 * field, and `server/turn.ts` passes that raw, unsanitized snapshot into
 * `parseSetupTerminal` — no plumbing change was needed to expose it here.
 * See {@link execSucceeded} for why it is trustworthy for a Mode B (`Bash`)
 * entry but NOT for a Mode A / Codex local (`setup_execution`-shaped) one.
 */
export interface SetupWorklogEntry {
  readonly label: string;
  readonly input?: unknown;
  readonly detail?: string;
  readonly state?: "running" | "done" | "error";
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

/** Parses the small KEY=value subset of a project .env file used by Wren profiles. */
function parseDotEnv(text: string): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const assignment = line.startsWith("export ") ? line.slice("export ".length) : line;
    const separator = assignment.indexOf("=");
    if (separator === -1) continue;
    const key = assignment.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    const rawValue = assignment.slice(separator + 1).trim();
    const quoted = /^(".*"|'.*')$/.test(rawValue) ? rawValue.slice(1, -1) : rawValue;
    values.set(key, quoted);
  }
  return values;
}

interface ConnectionTarget {
  readonly scheme: string;
  readonly host: string;
  readonly port: string;
  readonly database: string;
}

function normalizeConnectionScheme(scheme: string): string {
  const normalized = scheme.replace(/:$/, "").toLowerCase();
  return normalized === "postgresql" ? "postgres" : normalized;
}

/**
 * Closed URL-scheme allowlist for the source types accepted by Setup. Keep
 * this local rather than importing `server/app.ts`: harness must not depend
 * on its BFF consumer. A source without an unambiguous host/database URL
 * shape (for example DuckDB's filesystem `url`) deliberately has no entries
 * and therefore cannot retain lifecycle proof through this URL path.
 */
const URL_SCHEMES_BY_SOURCE: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["postgres", new Set(["postgres"])],
  ["mysql", new Set(["mysql", "mysql+pymysql", "mysql+mysqldb"])],
  ["bigquery", new Set(["bigquery"])],
  ["snowflake", new Set(["snowflake"])],
  ["clickhouse", new Set(["clickhouse", "clickhouse+http", "clickhouse+https"])],
  ["mssql", new Set(["mssql"])],
  ["trino", new Set(["trino", "trino+https"])],
  ["duckdb", new Set()],
]);

/**
 * Only these Setup sources have the host/port/database fields represented by
 * the generic field fallback below. Other supported sources use different
 * identity shapes (for example BigQuery project/dataset and Trino
 * catalog/schema), so accepting generic DB_HOST/DB_DATABASE for them would
 * forge an identity rather than derive the effective connection target.
 */
const HOST_DATABASE_FIELD_SOURCES = new Set([
  "postgres",
  "mysql",
  "clickhouse",
  "mssql",
  // Added when Setup began offering wren's full connector set. Each of these
  // has host/port/database in its own wren connection model, so the generic
  // fallback derives their identity rather than forging one. Sources whose
  // identity is shaped differently — BigQuery's project/dataset, Trino's
  // catalog/schema, Databricks' serverHostname/httpPath, Athena's S3 staging
  // dir, Spark's bare host/port — are still deliberately absent.
  "oracle",
  "redshift",
  "doris",
]);

function connectionTargetFromUrl(value: string, sourceType: string): ConnectionTarget | undefined {
  try {
    const url = new URL(value);
    const database = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, "");
    const scheme = normalizeConnectionScheme(url.protocol);
    if (!url.protocol || !url.hostname || !database || !URL_SCHEMES_BY_SOURCE.get(sourceType)?.has(scheme)) return undefined;
    // Intentionally do not return username, password, query, or fragment.
    return {
      scheme,
      host: url.hostname.toLowerCase(),
      port: url.port,
      database,
    };
  } catch {
    return undefined;
  }
}

function connectionTargetFromFields(
  scheme: string,
  host: string | undefined,
  port: string | undefined,
  database: string | undefined,
): ConnectionTarget | undefined {
  if (!host || !database) return undefined;
  return { scheme: normalizeConnectionScheme(scheme), host: host.toLowerCase(), port: port ?? "", database };
}

/**
 * Resolves a single effective value using Wren's shell-over-.env precedence.
 * Multiple aliases that disagree are ambiguous, so retained proof must not be
 * reused. The returned value is never persisted directly.
 */
function effectiveConnectionValue(dotenv: ReadonlyMap<string, string>, aliases: readonly string[]): string | undefined {
  const values = new Set<string>();
  for (const key of aliases) {
    const value = process.env[key] ?? dotenv.get(key);
    if (value !== undefined && value.trim()) values.add(value.trim());
  }
  return values.size === 1 ? [...values][0] : undefined;
}

function connectionAliases(sourceType: string): {
  readonly urls: readonly string[];
  readonly hosts: readonly string[];
  readonly ports: readonly string[];
  readonly databases: readonly string[];
} {
  const source = sourceType.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const generic = {
    urls: [`${source}_URL`, "DATABASE_URL", "DB_URL"],
    hosts: [`${source}_HOST`, "DB_HOST"],
    ports: [`${source}_PORT`, "DB_PORT"],
    databases: [`${source}_DATABASE`, `${source}_DB`, "DB_DATABASE", "DB_NAME"],
  };
  if (source !== "POSTGRES" && source !== "POSTGRESQL") return generic;
  return {
    urls: ["POSTGRES_URL", "POSTGRESQL_URL", "PG_URL", ...generic.urls],
    hosts: ["POSTGRES_HOST", "PGHOST", ...generic.hosts],
    ports: ["POSTGRES_PORT", "PGPORT", ...generic.ports],
    databases: ["POSTGRES_DATABASE", "POSTGRES_DB", "PGDATABASE", "PG_DB", ...generic.databases],
  };
}

/**
 * Returns a digest of the effective, non-secret database target. It accepts a
 * URL or host/database fields, but deliberately retains only scheme, host,
 * port, and database; credentials and raw URLs never enter persisted state.
 * Missing or contradictory target facts fail closed.
 */
function effectiveConnectionTargetDigest(projectDir: string, sourceType: string): string | undefined {
  let dotenv: ReadonlyMap<string, string>;
  try {
    dotenv = parseDotEnv(readFileSync(path.join(projectDir, ".env"), "utf-8"));
  } catch {
    return undefined;
  }

  const aliases = connectionAliases(sourceType);
  const targets = new Set<string>();
  for (const key of aliases.urls) {
    const value = process.env[key] ?? dotenv.get(key);
    if (value === undefined || !value.trim()) continue;
    const target = connectionTargetFromUrl(value.trim(), sourceType);
    if (target === undefined) return undefined;
    targets.add(JSON.stringify(target));
  }
  const fieldTarget = !HOST_DATABASE_FIELD_SOURCES.has(sourceType)
    ? undefined
    : connectionTargetFromFields(
      sourceType,
      effectiveConnectionValue(dotenv, aliases.hosts),
      effectiveConnectionValue(dotenv, aliases.ports),
      effectiveConnectionValue(dotenv, aliases.databases),
    );
  if (fieldTarget !== undefined) targets.add(JSON.stringify(fieldTarget));
  if (targets.size !== 1) return undefined;
  return createHash("sha256").update([...targets][0]!).digest("hex");
}

/**
 * A non-secret, host-derived identity for retained context lifecycle proof.
 * It deliberately binds the canonical on-disk project, the BFF-selected
 * source type, wren's project-level profile declaration, and a non-secret
 * digest of the effective connection target. If any required filesystem fact
 * cannot be read or is ambiguous, callers must fail closed and not reuse
 * evidence from an earlier attempt.
 */
export function contextLifecycleIdentityFingerprint(
  root: string,
  name: string,
  selectedSourceType: string,
): string | undefined {
  try {
    const projectDir = realpathSync(path.join(root, name));
    if (!statSync(projectDir).isDirectory()) return undefined;
    const projectYml = path.join(projectDir, "wren_project.yml");
    const profile = readProjectYamlField(projectYml, "profile");
    const declaredSourceType = readProjectYamlField(projectYml, "data_source");
    const normalizedSelectedSourceType = selectedSourceType.trim().toLowerCase();
    const normalizedDeclaredSourceType = declaredSourceType?.trim().toLowerCase();
    if (profile === undefined || normalizedDeclaredSourceType === undefined || normalizedDeclaredSourceType !== normalizedSelectedSourceType) return undefined;
    const connectionTargetDigest = effectiveConnectionTargetDigest(projectDir, normalizedSelectedSourceType);
    if (connectionTargetDigest === undefined) return undefined;
    return createHash("sha256")
      .update(JSON.stringify({ version: 2, projectDir, selectedSourceType: normalizedSelectedSourceType, profile, declaredSourceType: normalizedDeclaredSourceType, connectionTargetDigest }))
      .digest("hex");
  } catch {
    return undefined;
  }
}

export interface SetupTerminalResult {
  readonly status: SetupTerminalStatus;
  readonly message: string;
  /**
   * A host-owned rejection of an agent's claimed `SETUP_STATUS: ok`.
   *
   * This is deliberately structured rather than inferred from the display
   * message: `server/turn.ts` uses it to decide whether the completed,
   * resumable agent session gets one corrective continuation. Agent-declared
   * errors, dispatcher failures, cancellation, and timeouts do not create
   * this diagnostic and therefore cannot enter that recovery path.
   */
  readonly diagnostic?: HostContractDiagnostic;
  /**
   * A deterministic workflow outcome, deliberately separate from the
   * human-facing message so callers never have to re-classify prose.
   * Present when a context turn needs the BFF's explicit bounded
   * missing-discovery correction.
   */
  readonly failureKind?: "no_successful_schema_discovery" | "missing_terminal_status";
}

export type HostContractCode =
  | "connect_artifact_missing"
  | "connection_marker_missing"
  | "connection_profile_missing"
  | "connection_source_mismatch"
  | "context_schema_discovery_missing"
  | "context_schema_discovery_failed"
  | "context_validate_missing"
  | "context_build_missing"
  | "context_lifecycle_out_of_order"
  | "context_mdl_missing"
  | "context_mdl_empty";

/** Non-secret, host-owned evidence returned when a claimed setup success fails its artifact gate. */
export interface HostContractDiagnostic {
  readonly kind: "host_contract";
  readonly code: HostContractCode;
  /** What the BFF observed. This must remain safe to return to the agent. */
  readonly observed: string;
  /** The concrete artifact/workflow conditions that must be true before another claimed success. */
  readonly expectedArtifactContract: readonly string[];
}

function hostContractFailure(
  code: HostContractCode,
  message: string,
  observed: string,
  expectedArtifactContract: readonly string[],
  failureKind?: SetupTerminalResult["failureKind"],
): SetupTerminalResult {
  return {
    status: "error",
    message,
    diagnostic: { kind: "host_contract", code, observed, expectedArtifactContract },
    ...(failureKind !== undefined ? { failureKind } : {}),
  };
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

/** Counts the built MDL's models; unreadable/malformed content is deliberately treated as empty rather than trusted. */
function countMdlModels(mdlPath: string): number {
  try {
    const parsed = JSON.parse(readFileSync(mdlPath, "utf-8")) as { models?: unknown };
    return Array.isArray(parsed.models) ? parsed.models.length : 0;
  } catch {
    return 0;
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
 * Matches Mode A's / Codex local's `setup_execution` "exec" call's
 * `ToolStep.detail` — a `summarizeToolOutput`-bounded (200-char)
 * `JSON.stringify` of `{exitCode, stdout, stderr, ...}` (see
 * `harness/tools/setup-native.ts`) — and extracts the exit code. A regex, not
 * `JSON.parse`: once `stdout`/`stderr` push a stringified object past 200
 * characters (routine for a CLI usage/error message), the truncated detail
 * is no longer valid JSON, but Mode A serializes `exitCode` first so it
 * always survives.
 *
 * Deliberately Mode-A/Codex-local-only. There used to be a sibling
 * `MODE_B_BASH_EXIT_CODE` regex here matching a literal `"exit code: N"`
 * phrase, on the theory that a Mode B Bash result might carry that text —
 * but no real code path ever writes it: Mode B's `detail` is the command's
 * raw (240-char-truncated) stdout via `summarizeResultContent` in warble's
 * `dispatcher/claude-agent-sdk/src/events.ts`, with no such wrapping. That
 * dead regex made `execSucceeded` return `undefined` for every genuine Mode B
 * discovery/validate/build call, which made the `context` step's discovery
 * gate structurally unsatisfiable in Mode B — see `execSucceeded` for the fix.
 */
const SETUP_EXEC_EXIT_CODE = /^\{"exitCode":(-?\d+)/;

function modeAExecExitCode(detail: string | undefined): number | undefined {
  if (detail === undefined) return undefined;
  const match = SETUP_EXEC_EXIT_CODE.exec(detail);
  return match ? Number(match[1]) : undefined;
}

/**
 * Mode A registers the scoped execution capability under its policy name,
 * while Mode B's streamed SDK events retain the underlying `Bash` tool name.
 * Both names represent the same setup-only command boundary at this layer.
 */
const MODE_B_SETUP_EXECUTION_TOOL_NAME = "Bash";
/** Codex local streams the same allowlisted tool with its MCP server prefix. */
const CODEX_SETUP_EXECUTION_TOOL_NAME = `setup.${SETUP_EXECUTION_TOOL_NAME}`;

function isSetupExecutionEntry(entry: SetupWorklogEntry): boolean {
  return (
    entry.label === SETUP_EXECUTION_TOOL_NAME ||
    entry.label === MODE_B_SETUP_EXECUTION_TOOL_NAME ||
    entry.label === CODEX_SETUP_EXECUTION_TOOL_NAME
  );
}

/** Mode A and Codex local share the same non-throwing `setup_execution` tool — see {@link execSucceeded}. */
function isModeAShapedExecEntry(entry: SetupWorklogEntry): boolean {
  return entry.label === SETUP_EXECUTION_TOOL_NAME || entry.label === CODEX_SETUP_EXECUTION_TOOL_NAME;
}

/**
 * Whether a setup-execution worklog entry represents a genuinely successful
 * command run — `true`/`false` when that's known, `undefined` when it isn't
 * recorded either way (e.g. a Mode A file-write action, which has no exit
 * code at all).
 *
 * Mode A and Codex local share the same non-throwing `setup_execution` tool
 * (`harness/tools/setup-native.ts`): the JS tool call itself only throws on a
 * pre-flight denylist/scope violation (`SetupCommandDeniedError`), never on
 * the shell command's own exit code — a nonexistent CLI subcommand still
 * returns normally as `{exitCode: 2, ...}` structured output. That means
 * `ToolStep.state` is ALWAYS `"done"` for these entries regardless of
 * whether the shell command itself succeeded, so the only trustworthy signal
 * for them is the structured exit code folded into `detail`
 * ({@link modeAExecExitCode}) — unchanged from before this fix.
 *
 * Mode B's Bash tool has no such gap: `LiveWorkLog.ingest` (`server/fold.ts`)
 * already sets `ToolStep.state` from the originating `AgentEvent`'s own
 * `status` field ("success" -> "done", "error" -> "error") at fold time, for
 * both a genuine command failure and a blocked/guardrail-denied execution —
 * either way the tool call itself did not succeed, so `state` is sound to
 * trust directly. It is also the ONLY signal available: Mode B's `detail` is
 * the command's raw (240-char-truncated) stdout, never a structured exit
 * code.
 */
function execSucceeded(entry: SetupWorklogEntry): boolean | undefined {
  if (isModeAShapedExecEntry(entry)) {
    const exitCode = modeAExecExitCode(entry.detail);
    return exitCode === undefined ? undefined : exitCode === 0;
  }
  if (entry.state === "done") return true;
  if (entry.state === "error") return false;
  return undefined;
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
 * failed exec among the step's setup execution calls, without judging
 * whether that particular command was expected to fail as part of ordinary
 * exploration (e.g. a `grep` with no match, or a conditional shell test) —
 * doing so reliably would require actually understanding the command's
 * intent, which this module has no basis to do. The returned message is
 * worded as advisory ("does not by itself confirm...") rather than as a
 * counter-assertion for exactly this reason.
 *
 * `exitCode` is optional: Mode A/Codex local failures carry a real numeric
 * exit code; a Mode B (Bash) failure — including a blocked/guardrail-denied
 * execution — has none (only the fact that it failed), so callers must
 * degrade their wording gracefully rather than assume a number is present.
 */
function firstFailedExec(
  worklog: readonly SetupWorklogEntry[],
): { readonly command: string | undefined; readonly exitCode?: number } | undefined {
  for (const entry of worklog) {
    if (!isSetupExecutionEntry(entry)) continue;
    if (execSucceeded(entry) === false) {
      const exitCode = isModeAShapedExecEntry(entry) ? modeAExecExitCode(entry.detail) : undefined;
      return { command: execCommandOf(entry), ...(exitCode !== undefined ? { exitCode } : {}) };
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
  /\b(?:python(?:3(?:\.\d+)?)?|uv\s+run\s+python)\b[\s\S]*\bwren\.profile\b[\s\S]*\bwren\.connector\b/i,
  /\bWREN_PYTHON\b[\s\S]*\bcommand\s+-v\s+wren\b[\s\S]*\bwren\.profile\b[\s\S]*\bwren\.connector\b/i,
  /\b(?:psql|mysql|sqlite3|duckdb|snowsql|clickhouse-client|trino(?:-cli)?)\b[\s\S]*(?:\s(?:-c|--command|--execute|--query)\s|\b(?:information_schema|show\s+(?:tables|columns)|describe\s+(?:table|schema)|\.tables)\b)/i,
  /\bbq\s+query\b/i,
] as const;

export type RecordedSchemaDiscovery =
  | { readonly kind: "successful"; readonly command: string }
  | { readonly kind: "failed"; readonly command: string; readonly exitCode?: number }
  | { readonly kind: "none" };

/**
 * The single setup-workflow contract for recognisable schema discovery. A
 * matching command is evidence only after it completed successfully (see
 * {@link execSucceeded} for what "successfully" means per mode); command
 * text alone proves neither execution nor a readable schema. Callers use
 * this for both terminal acceptance and the no-introspection diagnostic,
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
    const succeeded = execSucceeded(entry);
    if (succeeded === true) return { kind: "successful", command };
    if (succeeded === false && failed === undefined) {
      const exitCode = isModeAShapedExecEntry(entry) ? modeAExecExitCode(entry.detail) : undefined;
      failed = { kind: "failed", command, ...(exitCode !== undefined ? { exitCode } : {}) };
    }
  }
  return failed ?? { kind: "none" };
}

type ContextLifecycleStage = "discovery" | "validate" | "build";

/** Ordered, host-recorded progress; each value includes all preceding work. */
export type ContextLifecyclePrefix = "none" | "discovery" | "validate" | "build";

const SHELL_ENV_ASSIGNMENT = String.raw`[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s;&|]+)`;
const DIRECT_CONTEXT_LIFECYCLE_COMMAND = new RegExp(
  String.raw`^\s*(?:(?:${SHELL_ENV_ASSIGNMENT}\s+)*|env\s+(?:${SHELL_ENV_ASSIGNMENT}\s+)+)?wren\s+context\s+(validate|build)(?:\s+--path\s+(?:\.|"\."|'\.'))?\s*$`,
  "i",
);

/**
 * The mandatory foundation has a native, host-verifiable sequence. A context
 * success needs schema discovery, then `wren context validate`, then `wren
 * context build`, each recorded as a successful setup execution. An artifact
 * alone or merely naming a command in the final message is not evidence.
 */
function contextLifecycleStage(command: string): Exclude<ContextLifecycleStage, "discovery"> | undefined {
  // This evidence must describe the actual lifecycle invocation, rather than
  // merely mention it. `setup_execution` already supplies the project cwd as
  // a separate structured field; the only shell prefixes we accept here are
  // environment assignments (including the standard `env KEY=value` form).
  // The one accepted flag is `--path .`: setup_execution separately binds the
  // command cwd to the canonical project, so this is the same project-local
  // lifecycle operation emitted by some Wren guidance. Arbitrary paths, other
  // flags, shell sequencing, quoted text, and wrappers remain unrecognized.
  const match = DIRECT_CONTEXT_LIFECYCLE_COMMAND.exec(command);
  return match?.[1]?.toLowerCase() as Exclude<ContextLifecycleStage, "discovery"> | undefined;
}

export type RecordedContextLifecycle =
  | { readonly kind: "successful" }
  | { readonly kind: "missing_discovery" }
  | { readonly kind: "validate_missing"; readonly observed: string }
  | { readonly kind: "build_missing"; readonly observed: string }
  | { readonly kind: "out_of_order"; readonly observed: string };

function stageAfter(prefix: ContextLifecyclePrefix): ContextLifecycleStage {
  if (prefix === "discovery") return "validate";
  if (prefix === "validate" || prefix === "build") return "build";
  return "discovery";
}

function prefixFor(stage: ContextLifecycleStage): ContextLifecyclePrefix {
  if (stage === "validate") return "discovery";
  return stage === "build" ? "validate" : "none";
}

function scanRecordedContextLifecycle(worklog: readonly SetupWorklogEntry[], prior: ContextLifecyclePrefix) {
  let stage = stageAfter(prior);
  let completed = prior === "build";
  let outOfOrderObserved: string | undefined;

  for (const entry of worklog) {
    if (!isSetupExecutionEntry(entry) || execSucceeded(entry) !== true) continue;
    const command = execCommandOf(entry);
    if (command === undefined) continue;

    if (stage === "discovery") {
      if (classifyRecordedSchemaDiscovery([entry]).kind === "successful") {
        stage = "validate";
        continue;
      }
      if (contextLifecycleStage(command) !== undefined) {
        outOfOrderObserved ??= `successful \`${command}\` ran before successful schema discovery`;
      }
      continue;
    }

    const nativeStage = contextLifecycleStage(command);
    if (stage === "validate") {
      if (nativeStage === "validate") {
        stage = "build";
      } else if (nativeStage === "build") {
        outOfOrderObserved ??= `successful \`${command}\` ran before successful \`wren context validate\``;
      }
      continue;
    }

    if (nativeStage === "build") completed = true;
  }

  return { stage, completed, outOfOrderObserved };
}

/**
 * Returns the greatest ordered prefix proved by the supplied successful tool
 * calls. This intentionally retains an earlier valid prefix even if a later
 * call in the same attempt is out of order, so a corrective attempt can ask
 * only for the unproven suffix.
 */
export function recordedContextLifecyclePrefix(
  worklog: readonly SetupWorklogEntry[],
  prior: ContextLifecyclePrefix = "none",
): ContextLifecyclePrefix {
  const scan = scanRecordedContextLifecycle(worklog, prior);
  return scan.completed ? "build" : prefixFor(scan.stage);
}

export function classifyRecordedContextLifecycle(
  worklog: readonly SetupWorklogEntry[],
  prior: ContextLifecyclePrefix = "none",
): RecordedContextLifecycle {
  const { stage, completed, outOfOrderObserved } = scanRecordedContextLifecycle(worklog, prior);

  if (completed) return { kind: "successful" };
  if (outOfOrderObserved !== undefined) return { kind: "out_of_order", observed: outOfOrderObserved };
  if (stage === "discovery") return { kind: "missing_discovery" };
  if (stage === "validate") return { kind: "validate_missing", observed: "no successful `wren context validate` followed successful schema discovery" };
  return { kind: "build_missing", observed: "no successful `wren context build` followed successful `wren context validate`" };
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
 * with at least one model).
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
      failureKind: "missing_terminal_status",
    };
  }

  if (matched.status === "ok") {
    if (context.stepKey === "context") {
      if (context.worklog !== undefined) {
        const lifecycle = classifyRecordedContextLifecycle(context.worklog, context.priorContextLifecycle);
        if (lifecycle.kind === "missing_discovery") {
          return hostContractFailure(
            "context_schema_discovery_missing",
            "The agent never completed recognized schema discovery in its recorded worklog, so its model/build result cannot be accepted. This is an agent-workflow failure, not evidence that the connection or data source lacks tables.",
            "the recorded worklog has no successful recognized schema-discovery command",
            [
              "run a recognized schema-discovery command against the connected source and make sure it exits successfully",
              "build target/mdl.json only from that discovered schema, with at least one model",
            ],
            "no_successful_schema_discovery",
          );
        }
        const discovery = classifyRecordedSchemaDiscovery(context.worklog);
        if (discovery.kind === "failed") {
          const exitCodeSuffix = discovery.exitCode !== undefined ? ` with exit code ${discovery.exitCode}` : "";
          return hostContractFailure(
            "context_schema_discovery_failed",
            `\`${discovery.command}\` failed${exitCodeSuffix} during schema discovery — a model/build result cannot be accepted until that command/tool failure is resolved; this is not evidence that the connection or data source lacks tables.`,
            discovery.exitCode !== undefined
              ? `the recorded schema-discovery command exited with code ${discovery.exitCode}`
              : "the recorded schema-discovery command failed",
            [
              "resolve the schema-discovery command failure and run a recognized discovery command successfully",
              "build target/mdl.json only from that discovered schema, with at least one model",
            ],
          );
        }
        if (lifecycle.kind === "validate_missing") {
          return hostContractFailure(
            "context_validate_missing",
            "The agent did not successfully run `wren context validate` after recognized schema discovery, so its model/build result cannot be accepted.",
            lifecycle.observed,
            [
              "run a recognized schema-discovery command successfully",
              "run `wren context validate` successfully before `wren context build`",
              "build target/mdl.json only after validation, with at least one model",
            ],
          );
        }
        if (lifecycle.kind === "build_missing") {
          return hostContractFailure(
            "context_build_missing",
            "The agent did not successfully run `wren context build` after `wren context validate`, so its claimed context success cannot be accepted.",
            lifecycle.observed,
            [
              "run a recognized schema-discovery command successfully",
              "run `wren context validate` successfully",
              "run `wren context build` successfully after validation and produce target/mdl.json with at least one model",
            ],
          );
        }
        if (lifecycle.kind === "out_of_order") {
          return hostContractFailure(
            "context_lifecycle_out_of_order",
            "The native context lifecycle ran out of order; Setup requires successful schema discovery followed by `wren context validate` and then `wren context build`.",
            lifecycle.observed,
            [
              "run a recognized schema-discovery command successfully",
              "run `wren context validate` successfully before `wren context build`",
              "produce target/mdl.json with at least one schema-derived model",
            ],
          );
        }
      }
      const mdlPath = path.join(context.root, context.name, "target", "mdl.json");
      if (!existsSync(mdlPath)) {
        return hostContractFailure(
          "context_mdl_missing",
          `the setup agent reported "ok" but ${mdlPath} does not exist — treating this as a failed context build`,
          "target/mdl.json is missing after the claimed context build",
          ["target/mdl.json must exist", "target/mdl.json must contain at least one model"],
        );
      }
      const modelCount = countMdlModels(mdlPath);
      if (modelCount < 1) {
        return hostContractFailure(
          "context_mdl_empty",
          `the setup agent reported "ok" but ${mdlPath} has ${modelCount} models — treating this as a failed context build`,
          `target/mdl.json has ${modelCount} models after the claimed context build`,
          ["target/mdl.json must contain at least one model"],
        );
      }
    } else {
      const markerName = context.stepKey === "connect_resume" ? ".wren-validated" : "wren_project.yml";
      const marker = path.join(context.root, context.name, markerName);
      if (!existsSync(marker)) {
        return hostContractFailure(
          context.stepKey === "connect_resume" ? "connection_marker_missing" : "connect_artifact_missing",
          `the setup agent reported "ok" but ${marker} does not exist — treating this as a failed setup`,
          `${markerName} is missing after the claimed setup success`,
          context.stepKey === "connect_resume"
            ? ["create .wren-validated only after the connection profile validates successfully"]
            : ["create the project directory", "create wren_project.yml", "create the empty .env template"],
        );
      }
      if (context.stepKey === "connect_resume" && context.expectedSourceType !== undefined) {
        const projectYml = path.join(context.root, context.name, "wren_project.yml");
        const pinnedProfile = readProjectYamlField(projectYml, "profile");
        if (pinnedProfile === undefined || pinnedProfile.length === 0) {
          return hostContractFailure(
            "connection_profile_missing",
            `the setup agent reported "ok" but ${projectYml} has no "profile:" pin — the connection profile was never actually pinned to this project (check the profile, not .env)`,
            "wren_project.yml has no non-empty profile pin",
            ["wren_project.yml must have a non-empty profile pin", "the pinned profile must match the selected data source"],
          );
        }
        const pinnedDataSource = readProjectYamlField(projectYml, "data_source");
        if ((pinnedDataSource ?? "").trim().toLowerCase() !== context.expectedSourceType.trim().toLowerCase()) {
          return hostContractFailure(
            "connection_source_mismatch",
            `the setup agent reported "ok" but ${projectYml}'s "data_source: ${pinnedDataSource ?? "(missing)"}" does not match the selected data source "${context.expectedSourceType}" — the connection profile is for the wrong data source (check the profile, not .env)`,
            `the pinned data source does not match the selected ${context.expectedSourceType} source`,
            [
              "wren_project.yml must have a non-empty profile pin",
              `the pinned data_source must match the selected ${context.expectedSourceType} source`,
              "create .wren-validated only after the matching profile validates successfully",
            ],
          );
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
      const exitCodeSuffix = failedExec.exitCode !== undefined ? ` with exit code ${failedExec.exitCode}` : "";
      return {
        status: "error",
        message: `${command} failed${exitCodeSuffix} during this step — a command in this step's own history failed, so this step's error framing can't be trusted until that's ruled out; this is a command/tool failure, not by itself evidence that the connection or data source lacks tables. The agent's own report was: "${matched.message}"`,
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
