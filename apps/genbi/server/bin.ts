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
 *   WREN_HARNESS_WORKSPACE_ROOT REQUIRED. Dir the agentic setup wizard scaffolds NEW wren
 *                               projects into (`<root>/<name>/`). The BFF always boots
 *                               "bootstrap-pending": no project is bound yet, Ask-turn routes
 *                               409 until the setup wizard binds one via TurnDeps.bindProject
 *                               (see server/turn.ts's resolveUserProject /
 *                               effectiveRouteOptions). `/api/setup/*` and
 *                               `/api/config/runtime` work unbound. An EXISTING project is
 *                               taken through the wizard's adopt flow (POST /api/setup/adopt),
 *                               which accepts any path on disk and survives a restart via
 *                               recoverBootstrapProjectBinding — there is no boot-time
 *                               binding env var.
 *   WREN_HARNESS_SETUP_IR       path to the compiled genbi-setup IR (the profile's
 *                               `connect_source` component) the setup wizard dispatches via
 *                               dispatched's DispatchedOptions.irPath bypass. Defaults to
 *                               resolveDefaultSetupIrPath()'s walk for this package's own
 *                               profiles/genbi-setup/ir.golden.json; unlike WREN_HARNESS_PROFILE
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
 *   WREN_HARNESS_CONTEXT_LOADER_BIN
 *                               path to the wren-context-loader binary, which renders the bound
 *                               wren project into the prepared-context document a `kind: prepared`
 *                               binding reads. Falls back to this repo's own Rust build; resolution
 *                               loud-fails rather than degrading to Warble's built-in MDL adapter
 *                               (see harness/compile/context-loader.ts)
 *   WREN_HARNESS_WREN_SHIM      optional absolute server-owned Wren shim for
 *                               native Codex runtime permissions; defaults to
 *                               the fixed local installation when unset
 *   WREN_HARNESS_AGENT_SDK_BIN  path to the agent-sdk CLI binary (dispatched)
 *   WREN_HARNESS_CODEX_LOCAL_BIN path to the warble-codex-local dispatcher CLI
 *   WREN_HARNESS_CODEX_BIN       optional path to the Codex CLI used by that dispatcher
 *   WREN_HARNESS_CODEX_HOME      absolute dedicated, externally authenticated CODEX_HOME used
 *                               by persistent codex:local Ask sessions; must not be the default
 *                               Codex home and must not contain config.toml
 *   WREN_HARNESS_OUT            output dir forwarded to route() (dispatched run dir; also in-process's
 *                               native write_artifact scope root, unless WREN_HARNESS_ARTIFACTS_DIR
 *                               is set — see harness/route/in-process.ts's resolveArtifactsDir)
 *   WREN_HARNESS_ARTIFACTS_DIR  in-process only: overrides resolveArtifactsDir's default
 *                               (an os.tmpdir() path) when WREN_HARNESS_OUT isn't set — read
 *                               directly by resolveArtifactsDir, not plumbed through CliFlags
 *   WREN_HARNESS_DEPLOYMENT     personal|hosted (default personal)
 *   WREN_HARNESS_TIER_ADAPTER   repeatable via commas: "<tier>=<mode>[:<field>=<value>,...]"
 *                               (see harness/cli-args.ts's parseTierAdapterFlag), e.g.
 *                               "cheap=local:endpoint=http://localhost:11434/v1,model=llama3.1"
 *   WREN_HARNESS_MODELS_CONFIG  path forwarded verbatim to warble-agent-sdk chat (dispatched)
 *   WREN_HARNESS_CHAT_TIMEOUT_MS  dispatched only: overrides spawnChat's default 10-minute hang
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
 *   WREN_HARNESS_ENRICH_IR      a PREBUILT genbi-enrich-context IR — in practice the profile's
 *                               eval golden, i.e. that profile compiled against this repo's own
 *                               example project with that project's schema baked into
 *                               `context_binding.resolved`. It is NOT a per-user artifact and is
 *                               no longer what a draft or a native session dispatches: both now
 *                               compile against the bound project (see `resolveDispatchIr` and
 *                               the enrichment runner's `profileSource`). What it still feeds is
 *                               the producer contract probe and readiness, which ask whether this
 *                               Warble can dispatch this profile SHAPE at all and have no user
 *                               project in view — a fixture is the correct input there.
 *                               Defaults to
 *                               resolveDefaultEnrichIrPath()'s walk for this package's own
 *                               profiles/genbi-enrich-context/ir.golden.json; like
 *                               WREN_HARNESS_SETUP_IR this does NOT hard-fail at boot if
 *                               unresolved — GET /api/context/enrichment reports the draft
 *                               capability unavailable until one is configured, and
 *                               POST /api/context/enrichment/start 503s. Claude subscription
 *                               auth only; apply/reconcile/approval remain unwired (see the
 *                               ticket).
 *
 * These mirror harness/cli.ts's `--project`/`--profile`/`--mode`/... flags
 * one-to-one (env vars instead of flags, since this is a long-running server
 * rather than a one-shot CLI invocation) and reuse the same cli-args.ts
 * helpers harness/cli.ts itself uses for auth/deployment/tier-binding resolution.
 */
import { serve } from "@hono/node-server";
import { createRequire } from "node:module";
import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import {
  createDefaultLoginProbe,
  CodexSetupRunner,
  describeBundle,
  deriveAdapterSpec,
  enforceCompliance,
  InProcessSetupRunner,
  DispatchedSetupRunner,
  resolveDefaultEnrichIrPath,
  resolveDefaultProfileSource,
  resolveDefaultSetupIrPath,
  route,
  resolveArtifactsDir,
  selectSetupRunnerForAuth,
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
import { recoverBootstrapProjectBinding } from "./bootstrap-project-binding.js";
import { createHarnessProfileSources } from "./harness-profile-sources.js";
import { compileProfile, compileRawProfile } from "../harness/compile/index.js";
import { resolveWarbleBinary } from "../harness/compile/resolve-binary.js";
import { toAuthChoiceFromRuntimeSettings } from "./auth-choice.js";
import { Store } from "./db.js";
import { resolveEnrichmentBinding, resolveProjectIdentity } from "./enrichment.js";
import type { EnrichmentBinding } from "./enrichment.js";
import { createDispatchedEnrichmentDraftRunner } from "./enrichment-runner.js";
import { dispatchInteractiveArtifacts, getInteractiveTerminalReadiness, InteractiveLaunchError, InteractiveTerminalManager, prepareInteractiveHandoff, unavailableInteractiveReadiness } from "./interactive-terminal.js";
import type { InteractiveTarget, PtyFactory } from "./interactive-terminal.js";
import { createProbedPtyFactory, ensureDarwinNodePtySpawnHelper } from "./node-pty-host.js";
import { NativeSessionService } from "./native-sessions.js";
import { NativeArtifactService } from "./native-artifacts.js";
import { RuntimeHost } from "./runtime-host/local.js";
import { assertNativeExecutableIdentity, assertNativeRuntimeSpec, attestNativeExecutable, buildNativeChildEnvironment, buildNativeRuntimeSpec, resolveNativeExecutable } from "./native-runtime-spec.js";
import type { NativeExecutableIdentity } from "./native-runtime-spec.js";
import { initializeNativeSessionStateBase, legacyInteractiveWorkspace, validateLegacyInteractiveWorkspace } from "./native-session-workspace.js";
import {
  codexModelsForRuntime,
  compileUnboundProfileTierNames,
  effectiveTierModel,
  materializeRuntimeRouteOptions,
} from "./runtime-binding.js";
import { invalidateBundleAgentIdsCache } from "./turn.js";
import type { TurnDeps } from "./turn.js";
import { createSetWrenHomeForSetupMode } from "./wren-home.js";
import { createSubscriptionModelCatalog } from "./subscription-model-catalog.js";

function envFlags(): CliFlags {
  const env = process.env;
  const tierAdapters = env["WREN_HARNESS_TIER_ADAPTER"];
  const chatTimeoutMs = parseChatTimeoutMs(env["WREN_HARNESS_CHAT_TIMEOUT_MS"]);
  return {
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
  const port = Number.parseInt(process.env["PORT"] ?? "4787", 10);
  const workspaceRoot = process.env["WREN_HARNESS_WORKSPACE_ROOT"];

  // Loud-fail rather than ignore: a caller still exporting the removed bound-mode variable
  // believes it is booting against that project, and silently starting unbound would hand
  // them a BFF pointed somewhere else entirely.
  if (process.env["WREN_HARNESS_PROJECT"] !== undefined) {
    process.stderr.write(
      "error: WREN_HARNESS_PROJECT is no longer supported — the BFF has a single boot mode. " +
        "Set WREN_HARNESS_WORKSPACE_ROOT and bring an existing project in through the setup " +
        "wizard's adopt flow, which now survives a restart.\n",
    );
    process.exitCode = 1;
    return;
  }
  if (workspaceRoot === undefined || workspaceRoot.trim().length === 0) {
    process.stderr.write("error: WREN_HARNESS_WORKSPACE_ROOT is required\n");
    process.exitCode = 1;
    return;
  }
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.basename(path.dirname(moduleDirectory)) === "dist-server"
    ? path.resolve(moduleDirectory, "../..")
    : path.resolve(moduleDirectory, "..");
  // Opt-in same-process SPA serving: only wired when a build actually
  // exists next to this package (`vite build`'s `dist/index.html`). A dev
  // boot (no `dist/`) leaves `staticDir` unset, so `server/app.ts` never
  // mounts the fallback and behavior is unchanged from today (UI served
  // separately by vite's dev proxy). See `TurnDeps.staticDir`'s doc comment
  // (server/turn.ts) and `server/spa.ts`.
  const candidateStaticDir = path.join(packageRoot, "dist");
  const staticDir = existsSync(path.join(candidateStaticDir, "index.html")) ? candidateStaticDir : undefined;

  // Resolve the Warble binary once, here, and hand the resolved path to every
  // consumer. Passing the bare name `"warble"` looked like a harmless default and
  // was not: `resolveWarbleBinary` treats any value it is given as an explicit
  // path and only searches when given nothing, so that default disabled the one
  // lookup that finds the `@warble/cli` an install actually ships. It also made
  // two resolvers disagree about the same string — the native preflight resolves
  // a bare name through PATH and reported the producer healthy, while every
  // compile failed.
  const resolvedWarbleBin = await resolveWarbleBinary(flags.warbleBin).catch((error: unknown) => {
    // Not fatal: the app still starts, and readiness reports the reason per
    // vendor rather than the process dying at boot over a feature the user may
    // not reach.
    process.stderr.write(`warning: ${error instanceof Error ? error.message : String(error)}\n`);
    return undefined;
  });
  const warbleBinOption = resolvedWarbleBin !== undefined ? { warbleBin: resolvedWarbleBin } : {};
  const nativeHome = realpathSync(os.homedir());
  const nodeExecutable = attestNativeExecutable("node", process.execPath);
  const producerExecutable = resolvedWarbleBin ? attestNativeExecutable("producer", resolvedWarbleBin) : undefined;
  const bootPath = process.env["PATH"];
  const claudeExecutable = resolveNativeExecutable("vendor", "claude", bootPath);
  const codexExecutable = resolveNativeExecutable("vendor", "codex", bootPath);
  const vendorExecutables: Readonly<Partial<Record<"claude" | "codex", NativeExecutableIdentity>>> = Object.freeze({
    ...(claudeExecutable ? { claude: claudeExecutable } : {}),
    ...(codexExecutable ? { codex: codexExecutable } : {}),
  });
  const nativeToolDirectories = Object.freeze([...new Set([
    path.dirname(nodeExecutable.executable),
    ...Object.values(vendorExecutables).filter((value): value is NativeExecutableIdentity => value !== undefined).map((value) => path.dirname(value.executable)),
    ...(producerExecutable ? [path.dirname(producerExecutable.executable)] : []),
  ])]);
  const nativeHostEnvironment = buildNativeChildEnvironment({ toolDirectories: nativeToolDirectories, home: nativeHome });

  const profileSource = flags.profile ?? resolveDefaultProfileSource();
  // Frozen at boot: GET /api/harness accepts only a purpose and must never
  // inherit a caller-supplied RouteOptions.profileSource.
  const harnessProfileSources = createHarnessProfileSources(profileSource);
  const loginProbe = createDefaultLoginProbe();
  const authChoice = await resolveAuthChoice(flags, loginProbe);
  const deployment = resolveDeployment(flags);

  const { warnings } = enforceCompliance(authChoice, { deployment });
  for (const warning of warnings) process.stderr.write(`warning: ${warning}\n`);

  const tierBinding = flags.tierAdapters !== undefined ? buildTierBindingFromFlags(flags.tierAdapters) : undefined;
  const dbPath = process.env["WREN_BFF_DB_PATH"] ?? "./wren-harness-bff.sqlite";
  // BFF state, never a bound project, owns all non-Setup native artifacts.
  // Initialization creates the fixed private namespaces once at startup.
  const nativeMaterializationState = initializeNativeSessionStateBase(dbPath);
  const store = new Store(dbPath);
  const getCodexModels = () => codexModelsForRuntime(store.getRuntimeSettings());
  const getRuntimeTierNames = () =>
    compileUnboundProfileTierNames({
      profileSource,
      ...(flags.warbleBin !== undefined ? { warbleBin: flags.warbleBin } : {}),
    });

  // userProject is always a placeholder here: the BFF boots unbound.
  // RouteOptions.userProject is a required string, but every real reader resolves the LIVE
  // value through TurnDeps.getUserProject() (see server/turn.ts's resolveUserProject /
  // effectiveRouteOptions), which takes precedence over this fixed field once wired below.
  // This field is only ever read as a fallback for TurnDeps literals that don't wire
  // getUserProject at all (e.g. existing tests' plain-object TurnDeps).
  const baseRouteOptions: Omit<RouteOptions, "question" | "onEvent"> = {
    authChoice,
    profileSource,
    userProject: "",
    deployment,
    ...(flags.model !== undefined ? { model: flags.model } : {}),
    ...(flags.warbleBin !== undefined ? { warbleBin: flags.warbleBin } : {}),
    ...(flags.agentSdkBin !== undefined ? { agentSdkBin: flags.agentSdkBin } : {}),
    ...(flags.out !== undefined ? { outDir: flags.out } : {}),
    ...(tierBinding !== undefined ? { tierBinding } : {}),
    ...(flags.modelsConfig !== undefined ? { modelsConfig: flags.modelsConfig } : {}),
    ...(flags.chatTimeoutMs !== undefined ? { chatTimeoutMs: flags.chatTimeoutMs } : {}),
    codexModels: getCodexModels,
    ...(process.env["WREN_HARNESS_CODEX_HOME"] !== undefined
      ? { codexHome: process.env["WREN_HARNESS_CODEX_HOME"] }
      : {}),
    ...(process.env["WREN_HARNESS_CODEX_LOCAL_BIN"] !== undefined
      ? { codexLocalBin: process.env["WREN_HARNESS_CODEX_LOCAL_BIN"] }
      : {}),
    ...(process.env["WREN_HARNESS_CODEX_BIN"] !== undefined
      ? { codexBin: process.env["WREN_HARNESS_CODEX_BIN"] }
      : {}),
  };

  // Mutable project binding: the BFF always boots unbound, recovering a previously bound
  // project from durable state when there is one, and is otherwise bound by the setup
  // wizard's connect/adopt flows calling deps.bindProject(dir) — see server/turn.ts.
  let boundProject: string | undefined = recoverBootstrapProjectBinding(store, workspaceRoot);
  // eslint-disable-next-line prefer-const -- assigned once below, referenced by the closures first
  let deps: TurnDeps;
  function getUserProject(): string | undefined {
    return boundProject;
  }
  function bindProject(dir: string): void {
    // Canonicalize before exposing the binding. A different symlink spelling
    // therefore cannot make an old enrichment run appear current, and every
    // call (even to the same directory) advances its generation. Binding is
    // a foundation operation (Setup connect, adopt, the context step's
    // healthcheck bind) that must succeed for a project that has never been
    // built, so it resolves identity only — never a revision, which would
    // require `target/mdl.json` to exist. Enrichment call sites resolve the
    // revision lazily, on demand, and treat an unbuilt project as a
    // legitimate refusal there instead.
    const identity = resolveProjectIdentity(dir);
    boundProject = identity.path;
    const { revokedNativeSessionIds } = store.activateEnrichmentBindingAndRevokeBoundNativeSessions(identity);
    nativeSessions.revokeBindingCapabilities(revokedNativeSessionIds);
    invalidateBundleAgentIdsCache(deps);
  }
  function unbindProject(): void {
    boundProject = undefined;
    invalidateBundleAgentIdsCache(deps);
  }

  // Discovery shares the same configured binaries and Codex identity as the
  // runtime. Its implementation owns subprocess cleanup and payload
  // sanitization; the app route only sees the public wire contract.
  const listSubscriptionModels = createSubscriptionModelCatalog({
    ...(flags.agentSdkBin !== undefined ? { agentSdkBin: flags.agentSdkBin } : {}),
    ...(process.env["WREN_HARNESS_CODEX_LOCAL_BIN"] !== undefined
      ? { codexLocalBin: process.env["WREN_HARNESS_CODEX_LOCAL_BIN"] }
      : {}),
    ...(baseRouteOptions.codexHome !== undefined ? { codexHome: baseRouteOptions.codexHome } : {}),
    ...(baseRouteOptions.codexBin !== undefined ? { codexBin: baseRouteOptions.codexBin } : {}),
    getUserProject,
  });

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
  const operatorWrenHome = originalWrenHome?.trim() || path.join(nativeHome, ".wren");
  const nativeSourceWrenHome = () => store.getSetupMode() === "create"
    ? path.join(workspaceRoot, ".wren")
    : operatorWrenHome;
  const setWrenHomeForSetupMode = createSetWrenHomeForSetupMode(workspaceRoot, originalWrenHome);

  // Mutable auth-choice binding — the auth-choice mirror of boundProject above. Starts at the
  // boot-resolved `authChoice` and can be rebound later by PUT /api/config/runtime
  // (server/app.ts) once a candidate AuthChoice has passed the compliance gate there.
  let boundAuthChoice: AuthChoice = store.hasExplicitRuntimeSettings()
    ? toAuthChoiceFromRuntimeSettings(store.getRuntimeSettings())
    : authChoice;
  function getAuthChoice(): AuthChoice {
    return boundAuthChoice;
  }
  function setAuthChoice(choice: AuthChoice): void {
    boundAuthChoice = choice;
  }

  const setupIrPath = process.env["WREN_HARNESS_SETUP_IR"] ?? resolveDefaultSetupIrPath();
  const setupMaxTurns = parseSetupMaxTurns(process.env["WREN_HARNESS_SETUP_MAX_TURNS"]);
  // Provider-aware setup selection: Claude subscription dispatches through
  // DispatchedSetupRunner, Codex subscription through CodexSetupRunner, and
  // api-key/local/gateway through
  // the in-process vercel loop (InProcessSetupRunner). `agentSdkBin` still only
  // applies to dispatched — it has no subprocess to pass a binary path to — but
  // `setupMaxTurns` now applies to both: in-process enforces it as an in-process
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
    const dispatchedSetupRunner = new DispatchedSetupRunner({
      irPath: setupIrPath,
      getModelsConfig: () => {
        if (!store.hasExplicitRuntimeSettings()) return flags.modelsConfig;
        const modelsConfig = materializeRuntimeRouteOptions(store.getRuntimeSettings(), {
          mode: "subscription",
          provider: "claude",
        }).modelsConfig;
        if (!modelsConfig) throw new Error("Claude setup requires a generated models config");
        return modelsConfig;
      },
      ...(flags.warbleBin !== undefined ? { warbleBin: flags.warbleBin } : {}),
      ...(flags.agentSdkBin !== undefined ? { agentSdkBin: flags.agentSdkBin } : {}),
      ...(flags.out !== undefined ? { outDir: flags.out } : {}),
      ...(setupMaxTurns !== undefined ? { maxTurns: setupMaxTurns } : {}),
    });
    const inProcessSetupRunner = new InProcessSetupRunner({
      irPath: setupIrPath,
      getStrongAdapterSpec: (choice) => {
        if (!store.hasExplicitRuntimeSettings()) {
          if (choice.mode === "subscription") throw new Error("in-process setup requires non-subscription auth");
          return deriveAdapterSpec(choice, flags.model !== undefined ? { model: flags.model } : {});
        }
        const strong = materializeRuntimeRouteOptions(store.getRuntimeSettings(), choice).tierBinding?.["strong"];
        if (!strong) throw new Error("in-process setup requires a configured strong-tier adapter");
        return strong;
      },
      ...(flags.warbleBin !== undefined ? { warbleBin: flags.warbleBin } : {}),
      ...(flags.out !== undefined ? { outDir: flags.out } : {}),
      ...(flags.model !== undefined ? { model: flags.model } : {}),
      ...(setupMaxTurns !== undefined ? { maxTurns: setupMaxTurns } : {}),
    });
    const codexSetupRunner = new CodexSetupRunner({
      irPath: setupIrPath,
      getStrongModel: () =>
        store.hasExplicitRuntimeSettings()
          ? effectiveTierModel(
              store.getRuntimeSettings().tierModels.find((binding) => binding.tier === "strong") ?? { tier: "strong" },
              store.getRuntimeSettings(),
            ) ?? ""
          : flags.model ?? "",
      ...(process.env["WREN_HARNESS_CODEX_LOCAL_BIN"] !== undefined
        ? { codexLocalBin: process.env["WREN_HARNESS_CODEX_LOCAL_BIN"] }
        : {}),
      ...(process.env["WREN_HARNESS_CODEX_BIN"] !== undefined
        ? { codexBin: process.env["WREN_HARNESS_CODEX_BIN"] }
        : {}),
    });
    const runnerSet = {
      claudeSubscription: dispatchedSetupRunner,
      codexSubscription: codexSetupRunner,
      nonSubscription: inProcessSetupRunner,
    };
    const runnerFor = (choice: AuthChoice): SetupStepRunner => selectSetupRunnerForAuth(choice, runnerSet);
    setupRunner = runnerFor(authChoice);
    setupRunnerFor = runnerFor;
  } else {
    process.stderr.write(
      "warning: no genbi-setup IR found (set WREN_HARNESS_SETUP_IR or restore this package's " +
        "profiles/genbi-setup/ir.golden.json) — POST /api/setup/connect will 500 until one is " +
        "configured\n",
    );
  }

  // Post-bind enrichment draft callback. Guarded only by enrichIrPath being resolvable, mirroring
  // setupRunner above — the runner itself reads the LIVE auth choice per-call (getAuthChoice)
  // rather than freezing the boot-time one, and refuses (EnrichmentContractError, surfaced as a
  // 500 by the route) any call made while the live choice isn't Claude subscription. Apply,
  // reconcile and approval stay unwired: deps.enrichmentApplyRunner / .enrichmentApprovalProvider
  // are intentionally left unset, so GET /api/context/enrichment keeps reporting those three
  // "callback_unavailable" and POST /api/context/enrichment/.../apply keeps 503ing, exactly as
  // before this change — only the draft capability goes live.
  const enrichIrPath = process.env["WREN_HARNESS_ENRICH_IR"] ?? resolveDefaultEnrichIrPath();
  // The profile's committed IR beside profile.yml — its eval golden, carrying
  // the example project's schema. It is a producer-contract and readiness
  // input only: what a session actually dispatches is compiled per binding by
  // `resolveDispatchIr` below.
  const analysisIrCandidate = process.env["WREN_HARNESS_ANALYSIS_IR"] ?? path.join(profileSource, "ir.golden.json");
  const analysisIrPath = existsSync(analysisIrCandidate) ? analysisIrCandidate : undefined;
  let enrichmentRunner: ReturnType<typeof createDispatchedEnrichmentDraftRunner> | undefined;
  if (enrichIrPath !== undefined) {
    enrichmentRunner = createDispatchedEnrichmentDraftRunner({
      irPath: enrichIrPath,
      // Compile against the bound project rather than dispatching the prebuilt
      // IR, which is the profile's eval golden and carries this repo's example
      // project's schema.
      profileSource: harnessProfileSources.context_enrichment,
      getAuthChoice,
      // Mirrors DispatchedSetupRunner's getModelsConfig above: enrichment draft dispatch is Claude
      // subscription only, so this always materializes the Claude models config regardless of
      // which auth choice is currently live — getAuthChoice's own check rejects the call before
      // dispatch if the live choice isn't actually Claude subscription.
      getModelsConfig: () => {
        if (!store.hasExplicitRuntimeSettings()) return flags.modelsConfig;
        return materializeRuntimeRouteOptions(store.getRuntimeSettings(), { mode: "subscription", provider: "claude" }).modelsConfig;
      },
      ...(flags.warbleBin !== undefined ? { warbleBin: flags.warbleBin } : {}),
      ...(flags.agentSdkBin !== undefined ? { agentSdkBin: flags.agentSdkBin } : {}),
      ...(flags.out !== undefined ? { outDir: flags.out } : {}),
      ...(flags.chatTimeoutMs !== undefined ? { chatTimeoutMs: flags.chatTimeoutMs } : {}),
    });
  } else {
    process.stderr.write(
      "warning: no genbi-enrich-context IR found (set WREN_HARNESS_ENRICH_IR or restore this " +
        "package's profiles/genbi-enrich-context/ir.golden.json) — GET /api/context/enrichment " +
        "will report draft unavailable until one is configured\n",
    );
  }

  // Lazy-load the native add-on: a BFF serving ordinary Ask/Context must not
  // fail at boot merely because the optional local terminal host is absent.
  let interactiveTerminal: InteractiveTerminalManager | undefined;
  const currentInteractiveBinding = () => {
    const project = getUserProject();
    const stored = store.getEnrichmentBinding();
    if (!project || !stored) return undefined;
    try {
      const resolved = resolveEnrichmentBinding(project);
      return resolved.path === stored.path && resolved.identity === stored.identity
        ? { ...resolved, generation: stored.generation }
        : undefined;
    } catch { return undefined; }
  };

  let ptyFactory: Promise<PtyFactory> | undefined;
  async function loadPty(): Promise<PtyFactory> {
    ptyFactory ??= (async () => {
      try {
        const require = createRequire(import.meta.url);
        ensureDarwinNodePtySpawnHelper(require.resolve("node-pty"));
        assertNativeExecutableIdentity(nodeExecutable);
        return await createProbedPtyFactory(await import("node-pty"), {
          cwd: nativeMaterializationState.root,
          env: nativeHostEnvironment,
          probeExecutable: nodeExecutable.executable,
        });
      } catch {
        throw new InteractiveLaunchError("interactive terminal host cannot spawn local processes on this machine");
      }
    })();
    return ptyFactory;
  }

  async function terminalManager(): Promise<InteractiveTerminalManager> {
    if (interactiveTerminal) return interactiveTerminal;
    interactiveTerminal = new InteractiveTerminalManager(await loadPty());
    return interactiveTerminal;
  }

  async function prepareInteractiveTerminal(target: InteractiveTarget, binding: EnrichmentBinding) {
    if (enrichIrPath === undefined) throw new InteractiveLaunchError("interactive enrichment artifacts are not configured");
    if (producerExecutable === undefined) throw new InteractiveLaunchError("interactive enrichment materialization failed");
    const artifactRoot = legacyInteractiveWorkspace(nativeMaterializationState, binding.path, target);
    const dispatchEnvironment = buildNativeChildEnvironment({
      toolDirectories: nativeToolDirectories,
      home: nativeHome,
      projectPath: binding.path,
    });
    return prepareInteractiveHandoff({
      target,
      binding,
      artifactRoot,
      materializationState: nativeMaterializationState,
      materialize: () => dispatchInteractiveArtifacts({ producer: producerExecutable, irPath: enrichIrPath, target, cwd: artifactRoot, env: dispatchEnvironment, boundProject: binding.path, materializationState: nativeMaterializationState }),
    }, {
      getCurrentBinding: currentInteractiveBinding,
      resolveExecutable: (executable) => executable === "claude" ? vendorExecutables.claude : vendorExecutables.codex,
    });
  }

  const nativeMcpUrl = `http://127.0.0.1:${port}/api/native-sessions/mcp`;
  const nativeArtifacts = new NativeArtifactService({
    store,
    artifactsRoot: resolveArtifactsDir(flags.out),
    expectedMcpUrl: nativeMcpUrl,
    mcpUrl: process.env["WREN_HARNESS_NATIVE_MCP_URL"] ?? nativeMcpUrl,
    getBinding: currentInteractiveBinding,
  });
  const nativeTerminalHostAvailable = async (): Promise<boolean> => {
    try { await loadPty(); return true; } catch { return false; }
  };
  // This is the sole production composition of the Phase-1 policy. Browser
  // requests never reach this selection or its executable/policy inputs.
  const nativeRuntimeHost = new RuntimeHost({
    selected: "local",
    deployment: process.env["NODE_ENV"] === "production" ? "production" : "development",
    localAvailable: nativeTerminalHostAvailable,
  });
  const nativeSessions = new NativeSessionService({
    store,
    terminalManager,
    getBinding: currentInteractiveBinding,
    workspaceRoot,
    materializationState: nativeMaterializationState,
    irPaths: { analysis: analysisIrPath, setup: setupIrPath, context_enrichment: enrichIrPath },
    // A session dispatches an IR compiled for the project it is bound to. The
    // paths above are the profiles' eval goldens — this profile compiled against
    // warble's own example project, that project's schema baked into
    // `context_binding.resolved` — which is the right artifact for the producer
    // contract probe and the wrong one for a session that has a binding.
    //
    // Setup has no binding by definition, so it compiles the profile's authored
    // context with no user project composed in; its golden resolves nothing
    // either, which is why Setup never showed this symptom.
    resolveDispatchIr: async (purpose, binding) => {
      const profileSource = harnessProfileSources[purpose];
      const compiled = purpose === "setup" || binding === undefined
        ? await compileRawProfile({ profileSource, mode: "native", ...warbleBinOption })
        : await compileProfile({ profileSource, userProject: binding.path, mode: "native", ...warbleBinOption });
      return compiled.irPath;
    },
    // The service's option is a required string; when resolution failed the bare
    // name is what the preflight will report as unresolvable, with its reason.
    warbleBin: producerExecutable?.executable ?? "warble",
    ...(process.env["WREN_HARNESS_WREN_SHIM"] !== undefined ? { wrenShim: process.env["WREN_HARNESS_WREN_SHIM"] } : {}),
    terminalHostAvailable: nativeTerminalHostAvailable,
    runtimeHost: nativeRuntimeHost,
    nativeHome,
    sourceWrenHome: nativeSourceWrenHome,
    ...(baseRouteOptions.codexHome ? { codexHome: baseRouteOptions.codexHome } : {}),
    vendorExecutables,
    nodeExecutable,
    childToolDirectories: nativeToolDirectories,
    ...(bootPath !== undefined ? { pathValue: bootPath } : {}),
    artifactService: nativeArtifacts,
  });

  deps = {
    store,
    nativeSessions,
    nativeArtifacts,
    route,
    baseRouteOptions,
    describeBundle: (options) => {
      return describeBundle({
        ...options,
        codexModels: typeof options.codexModels === "function" ? options.codexModels() : options.codexModels ?? getCodexModels(),
        ...(process.env["WREN_HARNESS_CODEX_LOCAL_BIN"] !== undefined
          ? { codexLocalBin: process.env["WREN_HARNESS_CODEX_LOCAL_BIN"] }
          : {}),
      });
    },
    describeHarnessBundle: (purpose, options) => {
      const profileSource = harnessProfileSources[purpose];
      const common = {
        ...options,
        profileSource,
        codexManifestPurpose: purpose,
        codexModels: typeof options.codexModels === "function" ? options.codexModels() : options.codexModels ?? getCodexModels(),
        ...(process.env["WREN_HARNESS_CODEX_LOCAL_BIN"] !== undefined
          ? { codexLocalBin: process.env["WREN_HARNESS_CODEX_LOCAL_BIN"] }
          : {}),
      };
      return purpose === "setup"
        ? describeBundle({ ...common, context: "bootstrap" })
        : describeBundle({ ...common, context: "bound_project", userProject: options.userProject });
    },
    getRuntimeTierNames,
    getUserProject,
    bindProject,
    unbindProject,
    getAuthChoice,
    setAuthChoice,
    loginProbe,
    listSubscriptionModels,
    ...(setupRunner !== undefined ? { setupRunner } : {}),
    ...(setupRunnerFor !== undefined ? { setupRunnerFor } : {}),
    ...(enrichmentRunner !== undefined ? { enrichmentRunner } : {}),
    startInteractiveTerminal: async ({ target, binding }) => {
      const { spec } = await prepareInteractiveTerminal(target, binding);
      const manager = await terminalManager();
      validateLegacyInteractiveWorkspace(nativeMaterializationState, binding.path, spec.cwd);
      if (producerExecutable === undefined || spec.hostExecutable === undefined) throw new InteractiveLaunchError("interactive enrichment materialization failed");
      const runtimeSpec = buildNativeRuntimeSpec({
        backend: "local",
        vendor: target === "claude-code:interactive" ? "claude" : "codex",
        executables: [
          nodeExecutable,
          producerExecutable,
          attestNativeExecutable("vendor", spec.hostExecutable),
        ],
        toolDirectories: nativeToolDirectories,
        workspace: spec.cwd,
        home: nativeHome,
        binding,
        ...(target === "codex:interactive" && baseRouteOptions.codexHome ? { codexHome: baseRouteOptions.codexHome } : {}),
      });
      assertNativeRuntimeSpec(runtimeSpec);
      return manager.start(spec, undefined, runtimeSpec.childEnvironment);
    },
    prepareInteractiveTerminal: async ({ target, binding }) => {
      return (await prepareInteractiveTerminal(target, binding)).handoff;
    },
    getInteractiveTerminal: (id) => interactiveTerminal?.get(id),
    revokeInteractiveTerminals: () => interactiveTerminal?.closeAll(),
    interactiveTerminalReadiness: async () => {
      if (enrichIrPath === undefined) return unavailableInteractiveReadiness("interactive enrichment artifacts are not configured");
      return getInteractiveTerminalReadiness({
        getCurrentBinding: currentInteractiveBinding,
        materializationState: nativeMaterializationState,
        terminalHostAvailable: async () => {
          try { await loadPty(); return true; } catch { return false; }
        },
        resolveExecutable: (executable) => executable === "claude" ? vendorExecutables.claude : vendorExecutables.codex,
      });
    },
    workspaceRoot,
    setWrenHomeForSetupMode,
    ...(staticDir !== undefined ? { staticDir } : {}),
  };
  const app = createApp(deps);

  const websocket = new WebSocketServer({ noServer: true });
  // ws' `noServer` runtime shape is the one documented by @hono/node-server;
  // its package types disagree under exactOptionalPropertyTypes.
  const server = serve({ fetch: app.fetch, websocket: { server: websocket as never }, hostname: "127.0.0.1", port }, (info) => {
    process.stdout.write(`wren-harness BFF listening on http://127.0.0.1:${info.port} (db: ${dbPath})\n`);
  });
  // Without this, a port that is already taken surfaces as an unhandled 'error' event and a raw
  // Node stack trace -- the first thing a new user is likely to hit, and the least readable.
  server.on("error", (error: NodeJS.ErrnoException) => {
    process.stderr.write(
      error.code === "EADDRINUSE"
        ? `error: port ${port} is already in use — stop whatever is using it, or set PORT to a free one\n`
        : `error: could not start the server on port ${port}: ${error.message}\n`,
    );
    process.exit(1);
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
