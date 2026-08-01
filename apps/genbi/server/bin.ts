#!/usr/bin/env node
/**
 * The BFF's process entrypoint. This is the ONLY file
 * in `server/` that wires real production values (env vars, a real `Store`
 * file, the real `route()` from `../harness/index.js`); every other `server/*`
 * module takes its dependencies injected (`TurnDeps`) so tests never import
 * this file.
 *
 * Env vars:
 *   PORT                        HTTP port to listen on (default 4787)
 *   WREN_BFF_DB_PATH            SQLite file path (default "./wren-harness-bff.sqlite")
 *   WREN_HARNESS_PROJECT        userProject dir for route() — required UNLESS
 *                               WREN_HARNESS_WORKSPACE_ROOT is set (bootstrap mode, see below)
 *   WREN_HARNESS_WORKSPACE_ROOT dir the agentic setup wizard scaffolds NEW wren projects
 *                               into (`<root>/<name>/`). When set and WREN_HARNESS_PROJECT is
 *                               unset, the BFF boots "bootstrap-pending": no project is bound
 *                               yet, Ask-turn routes 409 until the setup wizard's connect/bind
 *                               steps bind one via TurnDeps.bindProject (see server/turn.ts's
 *                               resolveUserProject/effectiveRouteOptions). `/api/setup/*` and
 *                               `/api/config/runtime` work unbound.
 *   WREN_HARNESS_SETUP_IR       path to the compiled genbi-setup IR (warble's
 *                               `connect_source` component) the setup wizard dispatches via
 *                               Mode B's ModeBOptions.irPath bypass. Defaults to
 *                               resolveDefaultSetupIrPath()'s sibling-repo walk
 *                               (warble/genbi-setup/ir.golden.json); unlike WREN_HARNESS_PROFILE
 *                               this does NOT hard-fail at boot if unresolved — only
 *                               POST /api/setup/connect(/resume) needs it, and those return a
 *                               clear 500 at dispatch time instead.
 *   WREN_HARNESS_PROFILE        profileSource; default resolveDefaultProfileSource()
 *   WREN_HARNESS_MODE           subscription|api-key|local|gateway (auth mode)
 *   WREN_HARNESS_PROVIDER       subscription provider: claude|codex
 *   WREN_HARNESS_ADAPTER        api-key adapter name
 *   WREN_HARNESS_API_KEY        api-key credential
 *   WREN_HARNESS_MODEL          model override
 *   WREN_HARNESS_ENDPOINT       local/gateway endpoint URL
 *   WREN_HARNESS_WARBLE_BIN     path to the warble CLI binary
 *   WREN_HARNESS_AGENT_SDK_BIN  path to the agent-sdk CLI binary (Mode B)
 *   WREN_HARNESS_OUT            output dir forwarded to route() (Mode B run dir; also Mode A's
 *                               native write_artifact scope root, unless WREN_HARNESS_ARTIFACTS_DIR
 *                               is set — see harness/route/mode-a.ts's resolveArtifactsDir)
 *   WREN_HARNESS_ARTIFACTS_DIR  Mode A only: overrides resolveArtifactsDir's default
 *                               (an os.tmpdir() path) when WREN_HARNESS_OUT isn't set — read
 *                               directly by resolveArtifactsDir, not plumbed through CliFlags
 *   WREN_HARNESS_DEPLOYMENT     personal|hosted (default personal)
 *   WREN_HARNESS_TIER_ADAPTER   repeatable via commas: "<tier>=<mode>[:<field>=<value>,...]"
 *                               (see harness/cli-args.ts's parseTierAdapterFlag), e.g.
 *                               "cheap=local:endpoint=http://localhost:11434/v1,model=llama3.1"
 *   WREN_HARNESS_MODELS_CONFIG  path forwarded verbatim to warble-agent-sdk chat (Mode B)
 *   WREN_HARNESS_CHAT_TIMEOUT_MS  Mode B only: overrides spawnChat's default 10-minute hang
 *                               guard on a "warble-agent-sdk chat" invocation. Raise this for a
 *                               legitimately slower cold-start Ask turn (e.g. right after
 *                               onboarding a project, before any compile cache is warm) instead
 *                               of the turn being killed and reported as a timeout. Must be a
 *                               positive integer (milliseconds); an invalid value fails fast at
 *                               boot via the same parseChatTimeoutMs used by harness/cli.ts.
 *   WREN_HARNESS_SETUP_MAX_TURNS  agentic setup only: caps the agent loop per setup turn,
 *                               forwarded as "warble-agent-sdk chat --max-turns". Defaults to
 *                               DEFAULT_SETUP_MAX_TURNS (120) — well above the dispatcher's own
 *                               40 — because build_context (generating an MDL) needs many turns
 *                               and otherwise dies with error_max_turns. Positive integer.
 *
 * These mirror harness/cli.ts's `--project`/`--profile`/`--mode`/... flags
 * one-to-one (env vars instead of flags, since this is a long-running server
 * rather than a one-shot CLI invocation) and reuse the same cli-args.ts
 * helpers harness/cli.ts itself uses for auth/deployment/tier-binding resolution.
 */
import { serve } from "@hono/node-server";
import {
  createDefaultLoginProbe,
  describeBundle,
  enforceCompliance,
  ModeASetupRunner,
  ModeBSetupRunner,
  resolveDefaultProfileSource,
  resolveDefaultSetupIrPath,
  route,
} from "../harness/index.js";
import type { AuthChoice, RouteOptions, SetupStepRunner } from "../harness/index.js";
import {
  buildTierBindingFromFlags,
  parseChatTimeoutMs,
  parseSetupMaxTurns,
  resolveAuthChoice,
  resolveDeployment,
} from "../harness/cli-args.js";
import type { CliFlags } from "../harness/cli-args.js";
import { createApp } from "./app.js";
import { Store } from "./db.js";
import { invalidateBundleAgentIdsCache } from "./turn.js";
import type { TurnDeps } from "./turn.js";
import { createSetWrenHomeForSetupMode } from "./wren-home.js";

function envFlags(): CliFlags {
  const env = process.env;
  const tierAdapters = env["WREN_HARNESS_TIER_ADAPTER"];
  const chatTimeoutMs = parseChatTimeoutMs(env["WREN_HARNESS_CHAT_TIMEOUT_MS"]);
  return {
    ...(env["WREN_HARNESS_PROJECT"] !== undefined ? { project: env["WREN_HARNESS_PROJECT"] } : {}),
    ...(env["WREN_HARNESS_PROFILE"] !== undefined ? { profile: env["WREN_HARNESS_PROFILE"] } : {}),
    ...(env["WREN_HARNESS_MODE"] !== undefined ? { mode: env["WREN_HARNESS_MODE"] } : {}),
    ...(env["WREN_HARNESS_PROVIDER"] !== undefined ? { provider: env["WREN_HARNESS_PROVIDER"] } : {}),
    ...(env["WREN_HARNESS_ADAPTER"] !== undefined ? { adapter: env["WREN_HARNESS_ADAPTER"] } : {}),
    ...(env["WREN_HARNESS_API_KEY"] !== undefined ? { apiKey: env["WREN_HARNESS_API_KEY"] } : {}),
    ...(env["WREN_HARNESS_MODEL"] !== undefined ? { model: env["WREN_HARNESS_MODEL"] } : {}),
    ...(env["WREN_HARNESS_ENDPOINT"] !== undefined ? { endpoint: env["WREN_HARNESS_ENDPOINT"] } : {}),
    ...(env["WREN_HARNESS_WARBLE_BIN"] !== undefined ? { warbleBin: env["WREN_HARNESS_WARBLE_BIN"] } : {}),
    ...(env["WREN_HARNESS_AGENT_SDK_BIN"] !== undefined ? { agentSdkBin: env["WREN_HARNESS_AGENT_SDK_BIN"] } : {}),
    ...(env["WREN_HARNESS_OUT"] !== undefined ? { out: env["WREN_HARNESS_OUT"] } : {}),
    ...(env["WREN_HARNESS_DEPLOYMENT"] !== undefined ? { deployment: env["WREN_HARNESS_DEPLOYMENT"] } : {}),
    ...(tierAdapters !== undefined ? { tierAdapters: tierAdapters.split(",").filter((s) => s.length > 0) } : {}),
    ...(env["WREN_HARNESS_MODELS_CONFIG"] !== undefined ? { modelsConfig: env["WREN_HARNESS_MODELS_CONFIG"] } : {}),
    ...(chatTimeoutMs !== undefined ? { chatTimeoutMs } : {}),
  };
}

async function main(): Promise<void> {
  const flags = envFlags();
  const workspaceRoot = process.env["WREN_HARNESS_WORKSPACE_ROOT"];
  const hasProject = flags.project !== undefined && flags.project.trim().length > 0;
  const hasWorkspaceRoot = workspaceRoot !== undefined && workspaceRoot.trim().length > 0;

  if (!hasProject && !hasWorkspaceRoot) {
    process.stderr.write(
      "error: either WREN_HARNESS_PROJECT (bound mode) or WREN_HARNESS_WORKSPACE_ROOT " +
        "(bootstrap mode — boots unbound, the setup wizard binds a project later) must be set\n",
    );
    process.exitCode = 1;
    return;
  }

  const profileSource = flags.profile ?? resolveDefaultProfileSource();
  const authChoice = await resolveAuthChoice(flags, createDefaultLoginProbe());
  const deployment = resolveDeployment(flags);

  const { warnings } = enforceCompliance(authChoice, { deployment });
  for (const warning of warnings) process.stderr.write(`warning: ${warning}\n`);

  const tierBinding = flags.tierAdapters !== undefined ? buildTierBindingFromFlags(flags.tierAdapters) : undefined;

  // userProject is a placeholder here when booting bootstrap-pending (hasProject === false):
  // RouteOptions.userProject is a required string, but every real reader resolves the LIVE
  // value through TurnDeps.getUserProject() (see server/turn.ts's resolveUserProject /
  // effectiveRouteOptions), which takes precedence over this fixed field once wired below.
  // This field is only ever read as a fallback for TurnDeps literals that don't wire
  // getUserProject at all (e.g. existing tests' plain-object TurnDeps).
  const baseRouteOptions: Omit<RouteOptions, "question" | "onEvent"> = {
    authChoice,
    profileSource,
    userProject: flags.project ?? "",
    deployment,
    ...(flags.model !== undefined ? { model: flags.model } : {}),
    ...(flags.warbleBin !== undefined ? { warbleBin: flags.warbleBin } : {}),
    ...(flags.agentSdkBin !== undefined ? { agentSdkBin: flags.agentSdkBin } : {}),
    ...(flags.out !== undefined ? { outDir: flags.out } : {}),
    ...(tierBinding !== undefined ? { tierBinding } : {}),
    ...(flags.modelsConfig !== undefined ? { modelsConfig: flags.modelsConfig } : {}),
    ...(flags.chatTimeoutMs !== undefined ? { chatTimeoutMs: flags.chatTimeoutMs } : {}),
  };

  const dbPath = process.env["WREN_BFF_DB_PATH"] ?? "./wren-harness-bff.sqlite";
  const store = new Store(dbPath);

  // Mutable project binding: userProject starts as `flags.project` (bound mode) or
  // `undefined` (bootstrap-pending mode) and can be rebound later, once, by the setup
  // wizard's connect flow calling deps.bindProject(dir) — see server/turn.ts.
  let boundProject: string | undefined = hasProject ? flags.project : undefined;
  // eslint-disable-next-line prefer-const -- assigned once below, referenced by the closures first
  let deps: TurnDeps;
  function getUserProject(): string | undefined {
    return boundProject;
  }
  function bindProject(dir: string): void {
    boundProject = dir;
    invalidateBundleAgentIdsCache(deps);
  }
  function unbindProject(): void {
    boundProject = undefined;
    invalidateBundleAgentIdsCache(deps);
  }

  // Baseline WREN_HOME this process actually booted with (possibly undefined — an operator may
  // legitimately not have the var set at all, in which case the wren CLI's own default of
  // `~/.wren` applies). Captured once, before anything below ever mutates
  // `process.env["WREN_HOME"]`, so `setWrenHomeForSetupMode` can restore exactly this rather than
  // guessing or force-deleting a value the operator's own shell environment set. See
  // `TurnDeps.setWrenHomeForSetupMode`'s doc comment (server/turn.ts) for why
  // this is toggled per setup-mode-action rather than once at boot: the wizard's create/adopt
  // choice is a runtime, resettable decision (POST /api/setup/mode, POST /api/setup/reset), not
  // something fixed at process start, so a single boot-time assignment would apply create's
  // workspace-anchored WREN_HOME to adopt turns too whenever adopt is chosen (or re-chosen after
  // a reset) later in the same boot. The actual logic lives in `./wren-home.js` so it's directly
  // unit-testable without going through a mocked `TurnDeps`.
  const originalWrenHome = process.env["WREN_HOME"];
  const setWrenHomeForSetupMode = createSetWrenHomeForSetupMode(workspaceRoot, originalWrenHome);

  // Mutable auth-choice binding — the auth-choice mirror of boundProject above. Starts at the
  // boot-resolved `authChoice` and can be rebound later by PUT /api/config/runtime
  // (server/app.ts) once a candidate AuthChoice has passed the compliance gate there.
  let boundAuthChoice: AuthChoice = authChoice;
  function getAuthChoice(): AuthChoice {
    return boundAuthChoice;
  }
  function setAuthChoice(choice: AuthChoice): void {
    boundAuthChoice = choice;
  }

  const setupIrPath = process.env["WREN_HARNESS_SETUP_IR"] ?? resolveDefaultSetupIrPath();
  const setupMaxTurns = parseSetupMaxTurns(process.env["WREN_HARNESS_SETUP_MAX_TURNS"]);
  // Same authChoice.mode branch route()/mode-b.ts's codex guard already reads
  // elsewhere: subscription auth dispatches setup through the agent-sdk
  // subprocess (ModeBSetupRunner); api-key/local/gateway dispatches through
  // the in-process vercel loop (ModeASetupRunner). `agentSdkBin` still only
  // applies to Mode B — it has no subprocess to pass a binary path to — but
  // `setupMaxTurns` now applies to both: Mode A enforces it as an in-process
  // tool-loop step budget (`ExecuteAgentContext.maxSteps`) rather than a
  // subprocess CLI flag, and `effectiveMaxTurns` reports it accordingly (see
  // that class's doc comment in harness/setup/runner.ts).
  //
  // Both runners are constructed unconditionally (guarded only by setupIrPath being
  // resolvable) rather than picking just one at boot, so a live auth-choice rebind (via
  // setAuthChoice above) can dispatch a LATER setup turn through the OTHER runner without
  // a process restart — see setupRunnerFor below and resolveSetupRunner in server/turn.ts.
  let setupRunner: SetupStepRunner | undefined;
  let setupRunnerFor: ((choice: AuthChoice) => SetupStepRunner) | undefined;
  if (setupIrPath !== undefined) {
    const modeBSetupRunner = new ModeBSetupRunner({
      irPath: setupIrPath,
      ...(flags.warbleBin !== undefined ? { warbleBin: flags.warbleBin } : {}),
      ...(flags.agentSdkBin !== undefined ? { agentSdkBin: flags.agentSdkBin } : {}),
      ...(flags.out !== undefined ? { outDir: flags.out } : {}),
      ...(setupMaxTurns !== undefined ? { maxTurns: setupMaxTurns } : {}),
    });
    const modeASetupRunner = new ModeASetupRunner({
      irPath: setupIrPath,
      ...(flags.warbleBin !== undefined ? { warbleBin: flags.warbleBin } : {}),
      ...(flags.out !== undefined ? { outDir: flags.out } : {}),
      ...(flags.model !== undefined ? { model: flags.model } : {}),
      ...(setupMaxTurns !== undefined ? { maxTurns: setupMaxTurns } : {}),
    });
    setupRunner = authChoice.mode === "subscription" ? modeBSetupRunner : modeASetupRunner;
    setupRunnerFor = (choice) => (choice.mode === "subscription" ? modeBSetupRunner : modeASetupRunner);
  } else {
    process.stderr.write(
      "warning: no genbi-setup IR found (set WREN_HARNESS_SETUP_IR or check out warble as a " +
        "sibling repo) — POST /api/setup/connect will 500 until one is configured\n",
    );
  }

  deps = {
    store,
    route,
    baseRouteOptions,
    describeBundle,
    getUserProject,
    bindProject,
    unbindProject,
    getAuthChoice,
    setAuthChoice,
    ...(setupRunner !== undefined ? { setupRunner } : {}),
    ...(setupRunnerFor !== undefined ? { setupRunnerFor } : {}),
    ...(workspaceRoot !== undefined ? { workspaceRoot, setWrenHomeForSetupMode } : {}),
  };
  const app = createApp(deps);

  const port = Number.parseInt(process.env["PORT"] ?? "4787", 10);
  serve({ fetch: app.fetch, port }, (info) => {
    process.stdout.write(`wren-harness BFF listening on http://localhost:${info.port} (db: ${dbPath})\n`);
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
