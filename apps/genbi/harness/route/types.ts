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
 * In-process ("api-key" | "local" | "gateway"): compile the profile to a vercel
 * bundle and run it in-process via `runAgent`. `bundle`/`mcpServers` are
 * test-only overrides — production callers leave them unset and let
 * `runInProcessDefault` compile+load the bundle itself and resolve the `query`
 * tool through the real `wren` CLI (native tools) against `userProject`.
 */
export interface InProcessOptions {
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
   * path when unset; see `resolveArtifactsDir` in `in-process.ts`. Never
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
   * adapter> }`. When set, `runInProcessDefault` binds via
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
   * invoking `route()`; `runInProcessDefault` itself does no classification of
   * its own.
   */
  readonly agentId?: string;
}

export type InProcessExecutor = (options: InProcessOptions) => Promise<RunAgentResult>;

/**
 * Dispatched ("subscription"): compile the profile to IR only, then shell the
 * warble `claude-agent-sdk` dispatcher's `chat` subcommand to answer via a
 * Dispatched component (`options.agentId`, defaulting to `"answer_query"`).
 */
export interface DispatchedOptions {
  readonly authChoice: Extract<AuthChoice, { mode: "subscription" }>;
  readonly profileSource: string;
  readonly userProject: string;
  readonly question: string;
  /**
   * Belt gate: deployment context for `runDispatchedDefault`'s own
   * `enforceCompliance` call, independent of whatever gate the caller (e.g.
   * `route()` or the CLI) already ran before reaching here. Defaults to
   * `"personal"` — an embedder that imports `runDispatchedDefault` directly
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
   * entirely warble's own mechanism. See known limitations in `route/dispatched.ts`.
   */
  readonly modelsConfig?: string;
  /**
   * Which warble component dispatched dispatches, forwarded
   * as `--component <agentId>` to `warble-agent-sdk chat` (see
   * `buildAgentSdkChatArgs`). Defaults to `"answer_query"` when unset — the
   * original default, unblocking later work that dispatches a
   * `connect_source`/`build_context` component via dispatched instead. Named
   * `agentId` to match `InProcessOptions.agentId` (intent routing).
   */
  readonly agentId?: string;
  /**
   * Live-event layer: dispatched only emits `run.start`/`answer`/
   * `run.finish`/`error` — it shells `warble-agent-sdk chat` as a single-shot
   * subprocess and reads only its final stdout text, so there is no live
   * step/tool/artifact visibility into the dispatcher's own internals from
   * this harness (a documented gap, not a wiring bug — see `runDispatchedDefault`'s
   * doc comment).
   */
  readonly onEvent?: (event: AgentEvent) => void;
  /**
   * Setup-flow bypass: an explicit path to an already-compiled IR file to
   * dispatch directly, skipping `compileProfile` entirely. Mirrors
   * `InProcessOptions.bundle`'s test-only override pattern, but this one is a
   * real (non-test) production path — the setup wizard's `connect_source`
   * dispatch runs against a fixed, warble-committed IR
   * (`profiles/genbi-setup/ir.golden.json`), not a profile compiled from the
   * bound wren project (there is no bound project yet during setup). When
   * unset, behavior is unchanged: `runDispatchedDefault` compiles `profileSource`
   * itself. See `harness/setup/runner.ts`'s `DispatchedSetupRunner`.
   */
  readonly irPath?: string;
  /**
   * Overrides `spawnChat`'s default `CHAT_TIMEOUT_MS` guard (10 minutes) for
   * this dispatch. A cold Ask turn against a freshly-onboarded project can
   * legitimately take longer than a warm one — the default is a hang guard,
   * not a target latency, so callers with a slower expected cold start (e.g.
   * the BFF's Ask route right after setup) can raise it instead of the turn
   * being killed and reported as a timeout. See `spawnChat` in `dispatched.ts`.
   */
  readonly chatTimeoutMs?: number;
  /**
   * Forwarded verbatim as `warble-agent-sdk chat --max-turns <n>`, capping the
   * dispatcher's agent loop. Omitted when unset, so warble's own default
   * (currently 40) applies. Raised by the setup wizard's `DispatchedSetupRunner`
   * because `build_context` (agentically generating an MDL) needs far more than
   * 40 tool-call turns and otherwise dies with `error_max_turns`.
   */
  readonly maxTurns?: number;
  /**
   * Session resume: an SDK session id captured from an earlier `chat` invocation (either its
   * `DispatchedResult.sessionId` on success, or the session id a failed/`error_max_turns` turn still
   * carried — see `spawnChat`'s `DispatchedSessionError`). When set, forwarded as
   * `warble-agent-sdk chat --resume <id>` so the dispatcher resumes the SAME agent-sdk
   * conversation instead of starting a fresh one — the agent keeps whatever it already read/
   * listed/fetched this session, rather than re-orienting from scratch. Ignored (no `--resume`
   * flag) when unset, which is the pre-existing behavior.
   */
  readonly resumeSessionId?: string;
  /** Cancels the owned dispatcher process without falling back to another vendor. */
  readonly signal?: AbortSignal;
}

export interface DispatchedResult {
  /** The dispatcher's final answer text for the turn (its `${turn.finalText}` stdout line). */
  readonly finalText: string;
  /**
   * The SDK session id this turn ran under (the dispatcher's `{t:"session",id}` NDJSON line),
   * forwarded so a caller can resume it on a later turn via `DispatchedOptions.resumeSessionId`.
   * `undefined` when the dispatcher's output never carried a session line at all (e.g. an older
   * warble build without the `session` event); `null` when the dispatcher emitted the line but
   * the SDK itself never produced a session id to report.
   */
  readonly sessionId?: string | null;
}

export type DispatchedExecutor = (options: DispatchedOptions) => Promise<DispatchedResult>;

/** Codex subscription Ask runs through warble-codex-local, never the Claude dispatched dispatcher. */
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
 * Options for the `route()` seam. `inProcess`/`dispatched` are injectable executors —
 * omit them to use the real default back-ends (`runInProcessDefault`/
 * `runDispatchedDefault`), or inject stubs for testing/future gating (compliance
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
  readonly inProcess?: InProcessExecutor;
  readonly dispatched?: DispatchedExecutor;
  readonly codexAsk?: CodexAskExecutor;
  /** Passed through to the default in-process executor; see `InProcessOptions.model`. */
  readonly model?: string;
  readonly warbleBin?: string;
  readonly agentSdkBin?: string;
  readonly workDir?: string;
  readonly outDir?: string;
  readonly bundle?: Bundle;
  readonly mcpServers?: McpServerConfigMap;
  /** In-process only (hybrid mode); see `InProcessOptions.tierBinding`. `route()` rejects this alongside a `subscription` authChoice. */
  readonly tierBinding?: Readonly<Record<string, AdapterSpec>>;
  /** Dispatched only (hybrid mode); see `DispatchedOptions.modelsConfig`. `route()` rejects this alongside a non-`subscription` authChoice. */
  readonly modelsConfig?: string;
  /** Live-event layer: forwarded to whichever mode executor runs. See `InProcessOptions.onEvent`/`DispatchedOptions.onEvent`. */
  readonly onEvent?: (event: AgentEvent) => void;
  /**
   * Intent routing (in-process) / component dispatch (dispatched): which
   * compiled agent (in-process) or dispatched warble component (dispatched) to run
   * `question` against. Forwarded to whichever mode executor runs; see
   * `InProcessOptions.agentId` / `DispatchedOptions.agentId`. Defaults to
   * `"answer_query"` in both modes when unset.
   */
  readonly agentId?: string;
  /** Subscription subprocess timeout: Claude chat or Codex Ask. Ignored by in-process. */
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
  | ({ readonly backend: "agent-sdk"; readonly warnings: readonly string[] } & DispatchedResult)
  | ({ readonly backend: "codex-local"; readonly warnings: readonly string[] } & CodexAskResult);
