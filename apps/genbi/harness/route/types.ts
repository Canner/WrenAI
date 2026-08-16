import type { AuthChoice } from "../auth/index.js";
import type { Bundle } from "../bundle/schema.js";
import type { Deployment } from "../compliance/index.js";
import type { AgentEvent } from "../events/index.js";
import type { AdapterSpec } from "../providers/index.js";
import type { RunAgentResult } from "../session/index.js";
import type { McpServerConfigMap } from "../tools/index.js";
import type { ResolvedCli } from "./agent-sdk-cli.js";
import type { CodexManifestModels } from "./codex-local-manifest.js";

/**
 * Mode A ("api-key" | "local" | "gateway"): compile the profile to a vercel
 * bundle and run it in-process via `runAgent`. `bundle`/`mcpServers` are
 * test-only overrides — production callers leave them unset and let
 * `runModeADefault` compile+load the bundle itself and resolve the `query`
 * tool through the real `wren` CLI (native tools) against `userProject`.
 */
export interface ModeAOptions {
  readonly authChoice: Extract<AuthChoice, { mode: "api-key" | "local" | "gateway" }>;
  readonly profileSource: string;
  readonly userProject: string;
  readonly question: string;
  /**
   * Only consulted when `authChoice.mode === "local"` — `LocalAuthChoice` has
   * no `model` field of its own, but the `openai-compatible` adapter it maps to
   * requires one. See `DEFAULT_LOCAL_MODEL`.
   */
  readonly model?: string;
  readonly warbleBin?: string;
  readonly workDir?: string;
  /**
   * Base directory the native `write_artifact` tool's scoped
   * workspace (`createLocalExecutionEnv({ rootDir })`) resolves under.
   * Independent of `userProject` — that only governs the `query` tool's
   * exec cwd (see `createWrenQueryTool`), never artifact writes. Defaults
   * to `WREN_HARNESS_ARTIFACTS_DIR` (env var) or a fixed `os.tmpdir()`
   * path when unset; see `resolveArtifactsDir` in `mode-a.ts`. Never
   * `process.cwd()` — that was the bug this option fixes.
   */
  readonly outDir?: string;
  /** Test-only: skip `compileProfile`/`loadBundle` and run this bundle directly. */
  readonly bundle?: Bundle;
  /** Test-only: route the `query` tool through an injected MCP server instead of the real `wren` CLI. */
  readonly mcpServers?: McpServerConfigMap;
  /**
   * The "hybrid" per-tier override: a NON-uniform map from tier name to its
   * own `AdapterSpec`, e.g. `{ cheap: <local endpoint>, strong: <cloud
   * adapter> }`. When set, `runModeADefault` binds via
   * `buildHybridTierBinding` (which validates every tier the compiled
   * `answer_query` agent uses is covered, and rejects unknown tier names)
   * instead of `buildUniformTierBinding`'s single-adapter-for-every-tier
   * default; `authChoice`/`model` are then only consulted for anything
   * `tierBinding` doesn't already cover — today that's nothing, since
   * coverage is total-or-loud-fail.
   */
  readonly tierBinding?: Readonly<Record<string, AdapterSpec>>;
  /** Live-event layer: forwarded to `RunAgentContext.onEvent`. See that field's doc comment. */
  readonly onEvent?: (event: AgentEvent) => void;
  /**
   * Intent routing: which compiled agent to run `question` against.
   * Defaults to `ANSWER_QUERY_AGENT_ID` (`"answer_query"`) when unset — the
   * original default from before intent routing existed. Callers (the BFF's `server/turn.ts`) resolve this via
   * `server/route-intent.ts`'s deterministic `classifyIntent` before
   * invoking `route()`; `runModeADefault` itself does no classification of
   * its own.
   */
  readonly agentId?: string;
}

export type ModeAExecutor = (options: ModeAOptions) => Promise<RunAgentResult>;

/**
 * Mode B ("subscription"): compile the profile to IR only, then shell the
 * warble `claude-agent-sdk` dispatcher's `chat` subcommand to answer via a
 * dispatched component (`options.agentId`, defaulting to `"answer_query"`).
 */
export interface ModeBOptions {
  readonly authChoice: Extract<AuthChoice, { mode: "subscription" }>;
  readonly profileSource: string;
  readonly userProject: string;
  readonly question: string;
  /**
   * Belt gate: deployment context for `runModeBDefault`'s own
   * `enforceCompliance` call, independent of whatever gate the caller (e.g.
   * `route()` or the CLI) already ran before reaching here. Defaults to
   * `"personal"` — an embedder that imports `runModeBDefault` directly
   * (bypassing `route()` entirely) still gets the real compliance decision
   * rather than an implicit, ungated `"personal"` assumption with no check
   * at all.
   */
  readonly deployment?: Deployment;
  readonly warbleBin?: string;
  /** Explicit override for resolving the warble-agent-sdk CLI. See `resolveAgentSdkCli`. */
  readonly agentSdkBin?: string;
  /** Run output directory the CLI writes into. Defaults to a fresh `os.tmpdir()` mkdtemp. */
  readonly outDir?: string;
  readonly workDir?: string;
  /**
   * The "hybrid" passthrough: an explicit path to a `warble-agent-sdk`
   * `--models-config <yaml>` file, forwarded verbatim to the `chat`
   * invocation (see `ModelConfig.fromYaml`, warble's `dispatcher/
   * claude-agent-sdk/src/models.ts`). This is pure argv plumbing — the
   * harness never parses or validates the YAML itself; that per-step
   * provider routing (subscription main loop + one non-Anthropic step) is
   * entirely warble's own mechanism. See known limitations in `route/mode-b.ts`.
   */
  readonly modelsConfig?: string;
  /**
   * Which warble component Mode B dispatches, forwarded
   * as `--component <agentId>` to `warble-agent-sdk chat` (see
   * `buildAgentSdkChatArgs`). Defaults to `"answer_query"` when unset — the
   * original default, unblocking later work that dispatches a
   * `connect_source`/`build_context` component via Mode B instead. Named
   * `agentId` to match `ModeAOptions.agentId` (intent routing).
   */
  readonly agentId?: string;
  /**
   * Live-event layer: Mode B only emits `run.start`/`answer`/
   * `run.finish`/`error` — it shells `warble-agent-sdk chat` as a single-shot
   * subprocess and reads only its final stdout text, so there is no live
   * step/tool/artifact visibility into the dispatcher's own internals from
   * this harness (a documented gap, not a wiring bug — see `runModeBDefault`'s
   * doc comment).
   */
  readonly onEvent?: (event: AgentEvent) => void;
  /**
   * Setup-flow bypass: an explicit path to an already-compiled IR file to
   * dispatch directly, skipping `compileProfile` entirely. Mirrors
   * `ModeAOptions.bundle`'s test-only override pattern, but this one is a
   * real (non-test) production path — the setup wizard's `connect_source`
   * dispatch runs against a fixed, warble-committed IR
   * (`warble/genbi-setup/ir.golden.json`), not a profile compiled from the
   * bound wren project (there is no bound project yet during setup). When
   * unset, behavior is unchanged: `runModeBDefault` compiles `profileSource`
   * itself. See `harness/setup/runner.ts`'s `ModeBSetupRunner`.
   */
  readonly irPath?: string;
  /**
   * Overrides `spawnChat`'s default `CHAT_TIMEOUT_MS` guard (10 minutes) for
   * this dispatch. A cold Ask turn against a freshly-onboarded project can
   * legitimately take longer than a warm one — the default is a hang guard,
   * not a target latency, so callers with a slower expected cold start (e.g.
   * the BFF's Ask route right after setup) can raise it instead of the turn
   * being killed and reported as a timeout. See `spawnChat` in `mode-b.ts`.
   */
  readonly chatTimeoutMs?: number;
  /**
   * Forwarded verbatim as `warble-agent-sdk chat --max-turns <n>`, capping the
   * dispatcher's agent loop. Omitted when unset, so warble's own default
   * (currently 40) applies. Raised by the setup wizard's `ModeBSetupRunner`
   * because `build_context` (agentically generating an MDL) needs far more than
   * 40 tool-call turns and otherwise dies with `error_max_turns`.
   */
  readonly maxTurns?: number;
  /**
   * Session resume: an SDK session id captured from an earlier `chat` invocation (either its
   * `ModeBResult.sessionId` on success, or the session id a failed/`error_max_turns` turn still
   * carried — see `spawnChat`'s `ModeBSessionError`). When set, forwarded as
   * `warble-agent-sdk chat --resume <id>` so the dispatcher resumes the SAME agent-sdk
   * conversation instead of starting a fresh one — the agent keeps whatever it already read/
   * listed/fetched this session, rather than re-orienting from scratch. Ignored (no `--resume`
   * flag) when unset, which is the pre-existing behavior.
   */
  readonly resumeSessionId?: string;
  /** Cancels the owned dispatcher process without falling back to another vendor. */
  readonly signal?: AbortSignal;
}

export interface ModeBResult {
  /** The dispatcher's final answer text for the turn (its `${turn.finalText}` stdout line). */
  readonly finalText: string;
  /**
   * The SDK session id this turn ran under (the dispatcher's `{t:"session",id}` NDJSON line),
   * forwarded so a caller can resume it on a later turn via `ModeBOptions.resumeSessionId`.
   * `undefined` when the dispatcher's output never carried a session line at all (e.g. an older
   * warble build without the `session` event); `null` when the dispatcher emitted the line but
   * the SDK itself never produced a session id to report.
   */
  readonly sessionId?: string | null;
}

export type ModeBExecutor = (options: ModeBOptions) => Promise<ModeBResult>;

/** Codex subscription Ask runs through warble-codex-local, never the Claude Mode B dispatcher. */
export interface CodexAskOptions {
  readonly authChoice: Extract<AuthChoice, { mode: "subscription" }> & { readonly provider: "codex" };
  readonly profileSource: string;
  readonly userProject: string;
  readonly question: string;
  readonly deployment?: Deployment;
  readonly warbleBin?: string;
  readonly workDir?: string;
  /** Test/integration override for an already-compiled native IR. */
  readonly irPath?: string;
  readonly agentId?: string;
  readonly onEvent?: (event: AgentEvent) => void;
  readonly codexModels?: CodexManifestModels | (() => CodexManifestModels);
  readonly codexHome?: string;
  readonly codexLocalBin?: string;
  readonly codexLocalCli?: ResolvedCli;
  readonly codexBin?: string;
  readonly mcpServer?: ResolvedCli;
  readonly timeoutMs?: number;
  /** Test-only outer subprocess watchdog override; production is dispatcher timeout plus cleanup grace. */
  readonly processTimeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface CodexAskResult {
  readonly finalText: string;
}

export type CodexAskExecutor = (options: CodexAskOptions) => Promise<CodexAskResult>;

/**
 * Options for the `route()` seam. `modeA`/`modeB` are injectable executors —
 * omit them to use the real default back-ends (`runModeADefault`/
 * `runModeBDefault`), or inject stubs for testing/future gating (compliance
 * checks, hybrid dispatch) without touching either mode's internals.
 */
export interface RouteOptions {
  readonly authChoice: AuthChoice;
  readonly profileSource: string;
  readonly userProject: string;
  readonly question: string;
  /**
   * Explicit deployment-context declaration for the compliance gate
   * (see `enforceCompliance`). Defaults to `"personal"` — the harness has
   * no way to detect multi-tenancy on its own, so a `"hosted"` (multi-
   * tenant / shared / always-on-server) deployment must be declared by the
   * caller.
   */
  readonly deployment?: Deployment;
  readonly modeA?: ModeAExecutor;
  readonly modeB?: ModeBExecutor;
  readonly codexAsk?: CodexAskExecutor;
  /** Passed through to the default Mode A executor; see `ModeAOptions.model`. */
  readonly model?: string;
  readonly warbleBin?: string;
  readonly agentSdkBin?: string;
  readonly workDir?: string;
  readonly outDir?: string;
  readonly bundle?: Bundle;
  readonly mcpServers?: McpServerConfigMap;
  /** Mode A only (hybrid mode); see `ModeAOptions.tierBinding`. `route()` rejects this alongside a `subscription` authChoice. */
  readonly tierBinding?: Readonly<Record<string, AdapterSpec>>;
  /** Mode B only (hybrid mode); see `ModeBOptions.modelsConfig`. `route()` rejects this alongside a non-`subscription` authChoice. */
  readonly modelsConfig?: string;
  /** Live-event layer: forwarded to whichever mode executor runs. See `ModeAOptions.onEvent`/`ModeBOptions.onEvent`. */
  readonly onEvent?: (event: AgentEvent) => void;
  /**
   * Intent routing (Mode A) / component dispatch (Mode B): which
   * compiled agent (Mode A) or dispatched warble component (Mode B) to run
   * `question` against. Forwarded to whichever mode executor runs; see
   * `ModeAOptions.agentId` / `ModeBOptions.agentId`. Defaults to
   * `"answer_query"` in both modes when unset.
   */
  readonly agentId?: string;
  /** Subscription subprocess timeout: Claude chat or Codex Ask. Ignored by Mode A. */
  readonly chatTimeoutMs?: number;
  /** Codex subscription Ask-only configuration. */
  readonly codexModels?: CodexManifestModels | (() => CodexManifestModels);
  readonly codexHome?: string;
  readonly codexLocalBin?: string;
  readonly codexLocalCli?: ResolvedCli;
  readonly codexBin?: string;
  readonly codexMcpServer?: ResolvedCli;
  readonly signal?: AbortSignal;
}

/**
 * `route()`'s result, tagged with which back-end actually served the
 * question. `warnings` surfaces the compliance gate's `enforceCompliance`
 * warnings (e.g. `SUBSCRIPTION_TOS_WARNING`) to programmatic callers of
 * `route()` — previously these were computed and discarded inside `route()`,
 * visible only to the CLI (which runs its own, separate `enforceCompliance`
 * call and prints to stderr). Empty for any non-`subscription` `authChoice`.
 */
export type RouteResult =
  | ({ readonly backend: "agent"; readonly warnings: readonly string[] } & RunAgentResult)
  | ({ readonly backend: "agent-sdk"; readonly warnings: readonly string[] } & ModeBResult)
  | ({ readonly backend: "codex-local"; readonly warnings: readonly string[] } & CodexAskResult);
