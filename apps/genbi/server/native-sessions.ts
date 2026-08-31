/**
 * Durable native-session control plane.  SQLite owns identity/lifecycle;
 * the PTY remains deliberately process-local and contains the only replay.
 */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EnrichmentBinding } from "./enrichment.js";
import { InteractiveLaunchError, InteractiveTerminalManager, NO_INTERACTIVE_TERMINAL_LEASES, interactiveExecutableAvailable } from "./interactive-terminal.js";
import type { InteractiveLaunchSpec, InteractiveTarget, InteractiveTerminalSession } from "./interactive-terminal.js";
import { newId, type NativeSessionPurpose, type NativeSessionRow, type NativeSessionVendor, type NativeSetupRecoveryCode, type NativeSetupRecoveryRow, type NativeSetupRecoveryState, type Store } from "./db.js";
import { NATIVE_MCP_CREDENTIAL_ENV_VAR, type NativeArtifactService, type NativeMcpDescriptor, type NativeMcpHealth } from "./native-artifacts.js";
import { dispatchForPurpose, NATIVE_DISPATCH_REGISTRY, NATIVE_PURPOSES, nativeTargetLabel, sameNativeRuntimeBinding, targetForProvider } from "./native-dispatch-registry.js";
import type { NativePurpose, NativeRuntimeBinding, NativeVendor } from "./native-dispatch-registry.js";
import { createNativeSessionWorkspace, initializeNativeSessionStateBase, nativeSessionStateBaseAvailable, nativeSessionStateBaseAvailableForProject, validateNativeSessionWorkspace } from "./native-session-workspace.js";
import type { NativeSessionStateBase } from "./native-session-workspace.js";
import { NativeWrenRuntimeError, resolveNativeWrenRuntime } from "./native-wren-runtime.js";
import type { NativeWrenRuntime } from "./native-wren-runtime.js";
import { runtimeSettingsCorrection } from "./runtime-binding.js";
import { sealNativeClaudeResumeHandle, sealNativeResumeHandle, unsealNativeResumeHandle } from "./native-session-resume.js";

export const NATIVE_VENDORS = ["claude", "codex"] as const;
export { NATIVE_PURPOSES };
export type { NativePurpose, NativeVendor };
export const NATIVE_SETUP_RECOVERY_MCP_TOOL_NAME = "report_setup_recovery";
/** Set only from the sealed, BFF-revalidated Setup bootstrap root at PTY launch. */
export const NATIVE_SETUP_BOOTSTRAP_ROOT_ENV_VAR = "WARBLE_SETUP_BOOTSTRAP_ROOT";
const MAX_SAFE_SETUP_RECOVERY_SEQUENCE = Number.MAX_SAFE_INTEGER;
/** A browser must attach a newly-created PTY promptly or it is an orphan. */
export const NATIVE_SESSION_INITIAL_ATTACHMENT_GRACE_MS = 15_000;
/**
 * Ordinary navigation and idle browser detaches keep an already-authorized
 * PTY reconnectable for this product TTL.  This is intentionally much longer
 * than the never-attached orphan cleanup below: a Session is a live tool, not
 * a 60-second page view.  It remains process-local; a BFF restart cannot
 * recover this PTY without a separately sealed provider resume contract.
 */
export const NATIVE_SESSION_IDLE_TTL_MS = 30 * 60_000;
/** @deprecated Use `NATIVE_SESSION_IDLE_TTL_MS`. Retained for test/API compatibility. */
export const NATIVE_SESSION_POST_CLAIM_DETACH_GRACE_MS = NATIVE_SESSION_IDLE_TTL_MS;
const START_SEPARATE_REPLAY_TTL_MS = 5 * 60_000;
const START_SEPARATE_REPLAY_LIMIT = 128;
const CODEX_NATIVE_PERMISSION_HEADER = "[permissions.warble_native_wren.filesystem]";
const PROVIDER_SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODEX_RESUME_HANDLE_FILE = path.join(".warble", "codex-thread-id");

type NativeLaunchPhase =
  | "workspace"
  | "dispatch"
  | "launch_spec"
  | "codex_wren_home"
  | "codex_project_read"
  | "terminal_manager"
  | "codex_executable"
  | "terminal_start"
  | "running_transition";

function logNativeLaunchFailure(purpose: NativePurpose, vendor: NativeVendor, phase: NativeLaunchPhase, error: unknown): void {
  const category = error instanceof InteractiveLaunchError ? "rejected" : "unexpected";
  // Keep the precise boundary server-side without logging exception text,
  // paths, credentials, argv, or other launch material. Browser/API callers
  // continue through nativeSessionLaunchFailure's closed public projection.
  console.error(`[native-sessions] launch failed purpose=${purpose} vendor=${vendor} phase=${phase} category=${category}`);
}

/**
 * The producer deliberately sees only a sealed binding identity, never a caller-supplied path.
 * After materialization, the BFF adds the canonical bound root to Codex's read-only permission
 * profile so WREN_PROJECT_HOME can resolve through the exact server-owned binding.
 */
export function grantCodexBoundProjectRead(cwd: string, projectPath: string, dataRoots: readonly string[] = []): void {
  const configPath = path.join(cwd, ".codex", "config.toml");
  const canonicalProject = realpathSync(projectPath);
  const config = readFileSync(configPath, "utf8");
  const headerIndex = config.indexOf(CODEX_NATIVE_PERMISSION_HEADER);
  if (headerIndex < 0 || config.indexOf(CODEX_NATIVE_PERMISSION_HEADER, headerIndex + 1) >= 0) {
    throw new InteractiveLaunchError("native Codex permission profile is invalid");
  }
  const nextTable = config.indexOf("\n[", headerIndex + CODEX_NATIVE_PERMISSION_HEADER.length);
  const insertion = nextTable < 0 ? config.length : nextTable + 1;
  const roots = [...new Set([canonicalProject, ...dataRoots.map((root) => realpathSync(root))])];
  const permissions = roots
    .map((root) => `${JSON.stringify(root)} = "read"\n`)
    .filter((permission) => !config.includes(permission))
    .join("");
  if (!permissions) return;
  const updated = `${config.slice(0, insertion)}${permissions}${config.slice(insertion)}`;
  writeFileSync(configPath, updated, { encoding: "utf8", mode: 0o600 });
  chmodSync(configPath, 0o600);
}

const MATERIALIZE_WREN_HOME_SCRIPT = String.raw`
import os
import pathlib
import shutil
import sys
import yaml
from wren.profile import expand_profile_secrets, resolve_profile_for_project

project = pathlib.Path(sys.argv[1]).resolve(strict=True)
destination = pathlib.Path(sys.argv[2])
name, profile = resolve_profile_for_project(project, strict=True)
if not name or not profile:
    raise SystemExit(2)
destination.mkdir(mode=0o700, parents=False, exist_ok=False)
profile_path = destination / "profiles.yml"
profile_path.write_text(yaml.safe_dump({"active": name, "profiles": {name: profile}}, sort_keys=False), encoding="utf-8")
os.chmod(profile_path, 0o600)
project_env = project / ".env"
if project_env.exists():
    if project_env.is_symlink() or not project_env.is_file():
        raise SystemExit(3)
    session_env = destination / ".env"
    shutil.copyfile(project_env, session_env)
    os.chmod(session_env, 0o600)

expanded = expand_profile_secrets(profile)
data_source = expanded.get("datasource")
data_root = None
if data_source in ("duckdb", "local_file"):
    data_root = expanded.get("url")
elif data_source == "datafusion":
    data_root = expanded.get("source")
if data_root:
    root = pathlib.Path(data_root).expanduser()
    if not root.is_absolute():
        root = project / root
    print(root.resolve(strict=True))
`;

interface CodexWrenHome {
  readonly home: string;
  readonly dataRoots: readonly string[];
}

function materializeCodexWrenHome(runtime: NativeWrenRuntime, projectPath: string, cwd: string): CodexWrenHome {
  const destination = path.join(cwd, ".wren");
  try {
    const output = execFileSync(runtime.venv_python, ["-c", MATERIALIZE_WREN_HOME_SCRIPT, projectPath, destination], {
      cwd: projectPath,
      env: process.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    });
    return { home: destination, dataRoots: output.trim() ? [output.trim()] : [] };
  } catch {
    throw new InteractiveLaunchError("native Wren project profile is unavailable");
  }
}

export interface NativeSetupRecoveryReport {
  readonly version: "1";
  readonly sequence: number;
  readonly phase: "connect" | "context";
  readonly state: NativeSetupRecoveryState;
  readonly code: NativeSetupRecoveryCode;
  readonly decision?: { readonly kind: "continue_or_stop"; readonly choices: readonly ["continue", "stop"]; };
}

export interface NativeSessionLaunch {
  readonly row: NativeSessionRow;
  /** Absent when a Setup launch failed before a terminal became attachable. */
  readonly capability?: string;
  /** Browser-only secret for a future restart-safe Setup recovery action. */
  readonly recoveryCapability?: string;
}

/** Browser-safe lifecycle projection. No provider handle, credential, or terminal bytes are exposed. */
export interface NativeSessionLifecycle {
  readonly liveAction: "reattach" | "resume" | "restart";
  /** True only for a still-available sealed provider conversation. */
  readonly resumeAvailable: boolean;
  readonly reason?: string;
}

/**
 * Every independent reason `resumeAvailable` can fail closed for. Each one
 * gets its own user-facing sentence in `nativeSessionLifecycle` below — the
 * lifecycle reason must never assert a specific cause the caller has not
 * actually distinguished.
 */
export type NativeSessionResumeUnavailableCause =
  | "not_terminal"
  | "runtime_settings_correction"
  | "scope_stale"
  | "workspace_unavailable"
  | "no_resume_handle";

/** Discriminated projection of why a row can or cannot resume. No identifiers travel in either branch. */
export type NativeSessionResumeAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly cause: NativeSessionResumeUnavailableCause };

function nativeSessionRestartReason(target: string, cause: NativeSessionResumeUnavailableCause): string {
  switch (cause) {
    case "not_terminal":
      return `The ${target} session is still active; resume is only decided once it stops.`;
    case "runtime_settings_correction":
      return `Runtime settings need a correction in Setup before this ${target} session can resume. Restart creates a new isolated session.`;
    case "scope_stale":
      return `The project this session was bound to has changed since it ran, so resume is withheld deliberately. Restart creates a new isolated session against the current project.`;
    case "workspace_unavailable":
      return `The workspace this ${target} session used is no longer available. Restart creates a new isolated session.`;
    case "no_resume_handle":
      return `The current ${target} native launch contract has no sealed provider resume handle. Restart creates a new isolated session.`;
  }
}

/**
 * The accepted native-launch schema deliberately has no `resume` field for
 * either current target.  `readNativeLaunchSpec` rejects unknown fields, so
 * this matrix is a deterministic statement about the sealed contract rather
 * than a claim based on a browser-supplied handle.
 */
export function nativeSessionLifecycle(
  row: Pick<NativeSessionRow, "status" | "vendor">,
  resumeAvailability: NativeSessionResumeAvailability = { available: false, cause: "no_resume_handle" },
): NativeSessionLifecycle {
  if (row.status === "creating" || row.status === "running" || row.status === "detached") {
    return { liveAction: "reattach", resumeAvailable: false };
  }
  const target = row.vendor === "claude" ? "Claude" : "Codex";
  if (resumeAvailability.available) {
    return { liveAction: "resume", resumeAvailable: true, reason: `Resume continues the retained ${target} conversation in a new isolated terminal.` };
  }
  return {
    liveAction: "restart",
    resumeAvailable: false,
    reason: nativeSessionRestartReason(target, resumeAvailability.cause),
  };
}

/** Browser intent is explicit: reconnecting is never mistaken for a new TUI. */
export type NativeSessionLaunchIntent = "open_existing" | "start_separate" | "resume";

export class NativeSetupRecoveryError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export interface NativeVendorReadiness {
  readonly available: boolean;
  readonly reason?: string;
}

/** Browser-safe producer compatibility state. It intentionally contains no path or process detail. */
export interface NativeProducerReadiness {
  readonly available: boolean;
  readonly category?: "native_session_producer_incompatible";
}

export interface NativePurposeReadiness {
  readonly scopeKind: "bootstrap" | "bound_project";
  readonly profile: string;
  readonly target?: InteractiveTarget;
  readonly targetLabel?: string;
  readonly available: boolean;
  readonly reason?: string;
  readonly producer?: NativeProducerReadiness;
  /** Compatibility shape retained empty; native target authority is `target`. */
  readonly vendors: Record<NativeVendor, NativeVendorReadiness>;
}

export type NativeSessionReadiness = {
  readonly runtime: NativeRuntimeBinding;
  readonly purposes: Record<NativePurpose, NativePurposeReadiness>;
  /** Health of the host-owned GenBI MCP endpoint; never includes a credential. */
  readonly mcp: NativeMcpHealth;
} & Record<NativePurpose, NativePurposeReadiness>;

/**
 * The profile component each purpose enters through. This host owns these names: the components
 * live in this product's own profiles, and Warble no longer keeps a copy — it materializes
 * whichever verb the scope declares, after checking the declaration against the compiled IR.
 */
const entryVerbFor = (purpose: NativePurpose): string =>
  purpose === "analysis" ? "answer_query" : purpose === "setup" ? "connect_source" : "draft_enrichment";

const agentFor = (purpose: NativePurpose, vendor: NativeVendor): string =>
  vendor === "claude" ? entryVerbFor(purpose) : `genbi-${purpose === "context_enrichment" ? "enrich-context" : purpose}`;

/**
 * Closed v4 Claude entry contract. This host is the only place the mapping exists: Warble used to
 * carry a matching table and no longer does, so there is no second copy to drift from. Each native
 * purpose enters through its named driver, never the profile-wide scope document. In particular,
 * analysis is pinned to
 * `answer_query`: that driver alone receives `persist_answer`, so a scope-entry launch must not
 * make the capability reachable by analysis step agents.
 *
 * This host deliberately validates the dispatched shape rather than accepting either form. Add a
 * purpose here only together with the corresponding Warble mapping and an exact-shape test; an
 * omitted purpose remains a scope entry and is rejected if Warble emits a pin for it.
 */
const PINNED_CLAUDE_PURPOSES: readonly NativePurpose[] = ["setup", "context_enrichment"];

/** Whether this closed producer contract uses the profile-wide Claude scope document. */
const claudeScopeEntry = (purpose: NativePurpose, vendor: NativeVendor): boolean =>
  vendor === "claude" && !PINNED_CLAUDE_PURPOSES.includes(purpose);

/**
 * The entry this host declares in the scope descriptor Warble validates.
 *
 * Scope entry names no verb: the session starts at the profile-wide scope document and its own
 * driver selects the component that owns each request, using the descriptions those components
 * authored. Warble refuses a `scope` entry that also carries a verb, so the two forms are built
 * here as alternatives rather than one shape with an optional field.
 *
 * `analysis` is the only purpose on the scope form today. It is also the one that gives up the
 * most by pinning: its profile mounts four selectable components, and a pinned session can only
 * reach the other three by delegating out of the one it was forced to start as.
 */
const nativeEntryFor = (
  purpose: NativePurpose,
  vendor: NativeVendor,
): { readonly kind: "scope"; readonly prompt: string } | { readonly verb: string; readonly prompt: string } =>
  claudeScopeEntry(purpose, vendor)
    ? { kind: "scope", prompt: welcomePromptFor(purpose) }
    : { verb: entryVerbFor(purpose), prompt: welcomePromptFor(purpose) };

/** Closed producer/host contract for the one initial native TUI prompt. */
const welcomePromptFor = (purpose: NativePurpose): string => {
  switch (purpose) {
    case "setup":
      return "Help me set up this GenBI project. Start by explaining the next setup step and ask what data source I want to connect.";
    case "analysis":
      return "Help me analyze this data. Ask me what question I want to answer about the server-bound project.";
    case "context_enrichment":
      return "Help me inspect this project's context and draft a read-only enrichment proposal. Do not apply changes; ask what context I want to review.";
  }
};

export interface NativeSessionServiceOptions {
  readonly store: Store;
  readonly terminalManager: () => Promise<InteractiveTerminalManager>;
  readonly getBinding: () => EnrichmentBinding | undefined;
  readonly workspaceRoot: string | undefined;
  /** BFF-owned external state root, initialized once from the configured DB path. */
  readonly materializationState?: NativeSessionStateBase;
  readonly irPaths: Readonly<Record<NativePurpose, string | undefined>>;
  /**
   * The IR a session actually dispatches from, compiled for the binding it is
   * about to run against.
   *
   * `irPaths` are the profiles' eval goldens: a golden is this profile compiled
   * against warble's own example project, with that project's schema baked into
   * `context_binding.resolved`. Dispatching one told a session on a real project
   * that its models were jaffle-shop's, while the CLI in its cwd resolved the
   * user's — the agent that noticed refused to draft anything, correctly.
   *
   * Goldens remain right for the producer contract probe, which asks whether
   * this Warble can dispatch these profile shapes at all and has no user
   * project in view. They are wrong the moment a session has a binding.
   */
  readonly resolveDispatchIr?: (purpose: NativePurpose, binding: EnrichmentBinding | undefined) => Promise<string>;
  readonly warbleBin: string;
  /** Exact startup-attested Codex CLI path and bytes; native PTYs never rediscover it through PATH. */
  readonly codexBin?: string;
  readonly codexBinSha256?: string;
  readonly codexSource?: "standalone" | "npm:@openai/codex";
  readonly codexSourceClosureSha256?: string;
  readonly codexVersion?: string;
  /** Absolute server-configured Wren shim for native Codex sessions; never a request input. */
  readonly wrenShim?: string;
  /** Read-only probe used by readiness; creation remains the final authority. */
  readonly terminalHostAvailable?: () => Promise<boolean>;
  /** Test seam for the local executable probe. */
  readonly executableAvailable?: (vendor: NativeVendor) => boolean;
  /** Test seam for the configured local Warble producer probe. */
  readonly producerAvailable?: () => boolean;
  /** Test seam for the server-filtered, session-local Wren profile store. */
  readonly prepareCodexWrenHome?: (input: { readonly runtime: NativeWrenRuntime; readonly projectPath: string; readonly cwd: string }) => CodexWrenHome;
  /** When configured, bound native sessions use the accepted v4 MCP+welcome descriptor; v2 remains compatible for callers without it. */
  readonly artifactService?: NativeArtifactService;
  /** Server-owned product idle TTL after a successful browser attachment disconnects. */
  readonly idleTtlMs?: number;
  /** @deprecated Compatibility alias for `idleTtlMs`. */
  readonly postClaimDetachGraceMs?: number;
  /** Bounded post-settlement duplicate-delivery window; test seam only. */
  readonly startSeparateReplayTtlMs?: number;
  /** Maximum retained settled start-separate action results; test seam only. */
  readonly startSeparateReplayLimit?: number;
  /** Test seam for the fixed, server-owned Warble dispatch only. */
  readonly dispatch?: (input: NativeDispatchInput) => Promise<void>;
}

/** Resolve and re-hash the exact startup-attested Codex executable immediately before use. */
export function resolvePinnedCodexExecutable(codexBin: string, expectedSha256: string, sourcePin?: {
  readonly source: "standalone" | "npm:@openai/codex";
  readonly closureSha256: string;
  readonly version: string;
}): string {
  try {
    if (!path.isAbsolute(codexBin) || !/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error("invalid pin");
    const canonical = realpathSync(codexBin);
    const stat = statSync(canonical);
    accessSync(canonical, constants.X_OK);
    if (!stat.isFile() || createHash("sha256").update(readFileSync(canonical)).digest("hex") !== expectedSha256) throw new Error("mismatched pin");
    if (sourcePin) {
      let sourceRoot = canonical;
      let declaredVersion: unknown;
      for (let candidate = path.dirname(canonical); candidate !== path.dirname(candidate); candidate = path.dirname(candidate)) {
        const packageFile = path.join(candidate, "package.json");
        if (!existsSync(packageFile)) continue;
        try {
          const metadata = JSON.parse(readFileSync(packageFile, "utf8")) as { readonly name?: unknown; readonly version?: unknown };
          if (metadata.name === "@openai/codex") { sourceRoot = candidate; declaredVersion = metadata.version; break; }
        } catch { /* Not the selected Codex package root. */ }
      }
      const source = sourceRoot === canonical ? "standalone" : "npm:@openai/codex";
      if (source !== sourcePin.source || (source !== "standalone" && declaredVersion !== sourcePin.version)) throw new Error("mismatched source");
      const closure = createHash("sha256");
      const visit = (directory: string): void => {
        for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          const candidate = path.join(directory, entry.name); const relative = path.relative(sourceRoot, candidate);
          if (entry.isSymbolicLink()) throw new Error("symlinked source");
          if (entry.isDirectory()) visit(candidate);
          else if (entry.isFile()) { closure.update(relative); closure.update("\0"); closure.update(readFileSync(candidate)); }
        }
      };
      if (sourceRoot === canonical) closure.update(readFileSync(canonical)); else visit(sourceRoot);
      if (closure.digest("hex") !== sourcePin.closureSha256) throw new Error("mismatched source closure");
    }
    return canonical;
  } catch {
    throw new InteractiveLaunchError("the attested Codex executable is unavailable or has changed");
  }
}

export interface NativeDispatchInput {
  readonly warbleBin: string;
  /** Server-owned resolved producer identity captured by the compatibility preflight. */
  readonly producer?: NativeProducerIdentity;
  readonly irPath: string;
  readonly target: InteractiveTarget;
  readonly cwd: string;
  readonly purpose: NativePurpose;
  /** Exact v2 scope descriptor. It must never contain connection material. */
  readonly scope: Record<string, unknown>;
  /** Exact v4 MCP descriptor, transported separately through --native-mcp. */
  readonly mcp?: NativeMcpDescriptor;
}

interface StartSeparateReplay {
  readonly scopeKey: string;
  readonly launch: Promise<NativeSessionLaunch>;
  settledAt?: number;
  result?: NativeSessionLaunch;
}

type NativeProviderLaunch = { readonly kind: "initial"; readonly sessionId: string } | { readonly kind: "resume"; readonly handle: string } | undefined;

function sameBinding(a: EnrichmentBinding, b: EnrichmentBinding | undefined): boolean {
  return b !== undefined && a.path === b.path && a.identity === b.identity && a.generation === b.generation && a.revision === b.revision;
}
function resumeScopeFingerprint(row: NativeSessionRow): string {
  return createHash("sha256").update(JSON.stringify([
    row.id, row.purpose, row.vendor, row.scopeKind, row.projectIdentity,
    row.bindingGeneration, row.projectRevision, row.dispatchProfile,
    row.dispatchTarget, row.runtimeGeneration,
  ])).digest("hex");
}
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function hasExactlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function contained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function localExecutableAvailable(executable: string, pathValue = process.env["PATH"]): boolean {
  return localExecutablePath(executable, pathValue) !== undefined;
}

function localExecutablePath(executable: string, pathValue = process.env["PATH"]): string | undefined {
  const candidates = path.isAbsolute(executable) || executable.includes(path.sep)
    ? [path.resolve(executable)]
    : (pathValue ?? "").split(path.delimiter).filter(Boolean).map((directory) => path.join(directory, executable));
  for (const candidate of candidates) {
    try {
      const stat = statSync(candidate);
      if (stat.isFile() && (stat.mode & 0o111) !== 0) return realpathSync(candidate);
    } catch {
      // Try the next PATH entry. The public readiness response never learns this path.
    }
  }
  return undefined;
}

function configuredWorkspace(cwd: string, create: boolean): string | undefined {
  try {
    if (create) mkdirSync(cwd, { recursive: true, mode: 0o700 });
    const entry = lstatSync(cwd);
    if (!entry.isDirectory() || entry.isSymbolicLink()) return undefined;
    const resolved = realpathSync(cwd);
    return statSync(resolved).isDirectory() ? resolved : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Readiness must not create a bootstrap directory. It may nevertheless say
 * ready when the exact configured path is absent but can be safely created by
 * the durable create boundary. Existing non-directories and symlinked roots
 * fail closed rather than being treated as a writable workspace.
 */
function bootstrapWorkspaceCreatable(cwd: string): boolean {
  if (configuredWorkspace(cwd, false)) return true;
  const absolute = path.resolve(cwd);
  let ancestor = absolute;
  const missing: string[] = [];
  while (true) {
    try {
      const entry = lstatSync(ancestor);
      if (!entry.isDirectory() || entry.isSymbolicLink()) return false;
      const canonicalAncestor = realpathSync(ancestor);
      const candidate = path.resolve(canonicalAncestor, ...missing);
      if (!contained(canonicalAncestor, candidate)) return false;
      accessSync(canonicalAncestor, constants.W_OK | constants.X_OK);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) return false;
      missing.unshift(path.basename(ancestor));
      ancestor = parent;
    }
  }
}

function configuredIrPath(irPath: string): boolean {
  try { return statSync(irPath).isFile(); } catch { return false; }
}

/** A deliberately small public classification; never expose process or filesystem detail. */
export function nativeSessionLaunchFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message === "native MCP URL is invalid") return message;
  if (message === "native session workspace is unavailable") return message;
  if (message === "native session materialization prerequisites are unavailable") return message;
  if (message === "native Wren runtime is unavailable") return "native session materialization prerequisites are unavailable";
  if (message === "native session producer is incompatible") return message;
  if (message === "native session launch artifacts are unavailable" || message === "native session launch specification is invalid" || message === "native session launch specification is incompatible") return "native session launch artifacts are unavailable";
  if (message === "native session launch paths are unavailable" || message === "native session launch paths are outside its server-owned scope") return "native session launch artifacts are unavailable";
  return "native session launch failed";
}

const NATIVE_PRODUCER_CATEGORY = "native_session_producer_incompatible" as const;
/** Stable browser-safe code for an action UUID fenced by changed Runtime/binding scope. */
export const NATIVE_SESSION_LAUNCH_ACTION_STALE_CODE = "native_session_launch_action_stale";

/** Deliberately expose only this deterministic replay fence, never process detail. */
export function nativeSessionLaunchErrorCode(error: unknown): typeof NATIVE_SESSION_LAUNCH_ACTION_STALE_CODE | undefined {
  return error instanceof InteractiveLaunchError && error.message === "native session launch action is stale"
    ? NATIVE_SESSION_LAUNCH_ACTION_STALE_CODE
    : undefined;
}

const NATIVE_PROBE_TIMEOUT_MS = 5_000;
const NATIVE_PROBE_MAX_OUTPUT_BYTES = 64 * 1024;
const NATIVE_PROBE_TARGETS: readonly NativeVendor[] = ["claude", "codex"];
const NATIVE_HELP_MARKERS = [
  "--target",
  "--purpose",
  "--native-scope",
  "--native-mcp",
  "--out",
] as const;

/** Never serialize this server-owned executable path to the browser. */
export interface NativeProducerIdentity {
  readonly executable: string;
  readonly identity: string;
}

export interface NativeProducerPreflightResult {
  readonly available: boolean;
  readonly category?: typeof NATIVE_PRODUCER_CATEGORY;
  /** Server-only resolved executable and content identity for the eventual launch. */
  readonly producer?: NativeProducerIdentity;
  /** Server-only: fixed fields plus a content digest; never a command path or process output. */
  readonly diagnostic: string;
}

interface NativeProbeProcessResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly output: string;
  readonly timedOut: boolean;
  readonly spawnFailed: boolean;
}

function nativeProducerResult(
  available: boolean,
  identity: string | undefined,
  phase: string,
  detail: string,
  producer?: NativeProducerIdentity,
): NativeProducerPreflightResult {
  return {
    available,
    ...(available ? {} : { category: NATIVE_PRODUCER_CATEGORY }),
    ...(available && producer ? { producer } : {}),
    diagnostic: `identity=${identity ?? "unavailable"} phase=${phase} ${detail}`,
  };
}

function executableIdentity(executable: string): string | undefined {
  try {
    const metadata = statSync(executable);
    if (!metadata.isFile() || (metadata.mode & 0o111) === 0) return undefined;
    return `sha256:${createHash("sha256").update(readFileSync(executable)).digest("hex")}`;
  } catch {
    return undefined;
  }
}

/**
 * The configured spelling may be a PATH lookup or retargetable symlink. A
 * preflight result instead owns the resolved executable and its digest. Check
 * both again before creating a durable row and directly before spawning.
 */
function assertNativeProducerIdentity(producer: NativeProducerIdentity): void {
  const resolved = localExecutablePath(producer.executable);
  if (resolved !== producer.executable || executableIdentity(producer.executable) !== producer.identity) {
    throw new InteractiveLaunchError("native session producer is incompatible");
  }
}

/**
 * Runs a deliberately noninteractive command with a minimal environment. Its
 * output is used only for local help-marker parsing and is never logged or
 * returned: a third-party executable may print arbitrary sensitive text.
 */
function runNativeProbe(command: string, args: readonly string[]): Promise<NativeProbeProcessResult> {
  return new Promise((resolve) => {
    let output = "";
    let timedOut = false;
    let spawnFailed = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ exitCode, signal, output, timedOut, spawnFailed });
    };
    let child;
    try {
      child = spawn(command, [...args], {
        cwd: os.tmpdir(),
        env: { PATH: process.env["PATH"] ?? "" },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      spawnFailed = true;
      finish(null, null);
      return;
    }
    const append = (value: Buffer) => {
      if (output.length >= NATIVE_PROBE_MAX_OUTPUT_BYTES) return;
      output += value.toString("utf8", 0, Math.min(value.length, NATIVE_PROBE_MAX_OUTPUT_BYTES - output.length));
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.once("error", () => {
      spawnFailed = true;
      finish(null, null);
    });
    child.once("close", (exitCode, signal) => finish(exitCode, signal));
    timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, NATIVE_PROBE_TIMEOUT_MS);
  });
}

/**
 * Exercises the exact, file-only native dispatch boundary against the
 * configured executable. No model, vendor CLI, project workspace, or real
 * credential is involved. The emitted launch spec is parsed by the same
 * validator used just before a PTY starts.
 */
export async function probeNativeSessionProducer(input: {
  readonly warbleBin: string;
  readonly irPaths: Readonly<Record<NativePurpose, string | undefined>>;
  readonly wrenShim?: string;
}): Promise<NativeProducerPreflightResult> {
  const executable = localExecutablePath(input.warbleBin);
  if (!executable) return nativeProducerResult(false, undefined, "resolve", "result=binary_not_found");
  const identity = executableIdentity(executable);
  if (!identity) return nativeProducerResult(false, undefined, "identity", "result=identity_unavailable");
  const producer = { executable, identity };
  const help = await runNativeProbe(executable, ["dispatch", "--help"]);
  if (help.spawnFailed) return nativeProducerResult(false, identity, "dispatch_help", "result=spawn_failed");
  if (help.timedOut) return nativeProducerResult(false, identity, "dispatch_help", "result=timed_out");
  if (help.exitCode !== 0) return nativeProducerResult(false, identity, "dispatch_help", `result=exit_code_${help.exitCode ?? "signal"}`);
  const missingMarkers = NATIVE_HELP_MARKERS.filter((marker) => !help.output.includes(marker));
  if (missingMarkers.length > 0) return nativeProducerResult(false, identity, "dispatch_help", `result=missing_markers_${missingMarkers.join(",")}`);

  for (const purpose of NATIVE_PURPOSES) {
    const irPath = input.irPaths[purpose];
    if (!irPath || !configuredIrPath(irPath)) continue;
    for (const vendor of NATIVE_PROBE_TARGETS) {
      let root: string | undefined;
      try {
        root = mkdtempSync(path.join(os.tmpdir(), "genbi-native-preflight-"));
        chmodSync(root, 0o700);
        root = realpathSync(root);
        const outputRoot = path.join(root, "out");
        mkdirSync(outputRoot, { mode: 0o700 });
        const bootstrapRoot = path.join(root, "bootstrap");
        mkdirSync(bootstrapRoot, { mode: 0o700 });
        const scopeId = `preflight-${purpose}-${vendor}`;
        const scopePath = path.join(root, "scope.json");
        const mcpPath = path.join(root, "mcp.json");
        const wrenRuntime = vendor === "codex" ? resolveNativeWrenRuntime(input.wrenShim) : undefined;
        const binding = NATIVE_DISPATCH_REGISTRY[purpose].scopeKind === "bound_project"
          ? { project_identity: "native-preflight-project", generation: "1", revision: "native-preflight-revision" }
          : undefined;
        writeFileSync(scopePath, JSON.stringify({ version: "3", kind: NATIVE_DISPATCH_REGISTRY[purpose].scopeKind, scope_id: scopeId, cwd: outputRoot, entry: nativeEntryFor(purpose, vendor), ...(purpose === "setup" ? { bootstrap_root: bootstrapRoot } : {}), ...(wrenRuntime ? { wren_runtime: wrenRuntime } : {}), ...(binding ? { binding } : {}) }), { encoding: "utf8", mode: 0o600, flag: "wx" });
        writeFileSync(mcpPath, JSON.stringify({ version: "1", url: "http://127.0.0.1:0/api/native-sessions/mcp", credential: "native-preflight-nonsecret" }), { encoding: "utf8", mode: 0o600, flag: "wx" });
        const dispatched = await runNativeProbe(executable, ["dispatch", irPath, "--target", targetForProvider(vendor), "--purpose", purpose, "--native-scope", scopePath, "--native-mcp", mcpPath, "--out", outputRoot]);
        const phase = `dispatch_${purpose}_${vendor}`;
        if (dispatched.spawnFailed) return nativeProducerResult(false, identity, phase, "result=spawn_failed");
        if (dispatched.timedOut) return nativeProducerResult(false, identity, phase, "result=timed_out");
        if (dispatched.exitCode !== 0) return nativeProducerResult(false, identity, phase, `result=exit_code_${dispatched.exitCode ?? "signal"}`);
        try {
          readNativeLaunchSpec(outputRoot, purpose, vendor, scopeId, undefined, { version: "1", url: "http://127.0.0.1:0/api/native-sessions/mcp", credential: "native-preflight-nonsecret" });
        } catch {
          return nativeProducerResult(false, identity, phase, "result=launch_spec_incompatible");
        }
      } catch (error) {
        if (error instanceof NativeWrenRuntimeError) return nativeProducerResult(false, identity, `dispatch_${purpose}_${vendor}`, "result=wren_runtime_unavailable");
        return nativeProducerResult(false, identity, `dispatch_${purpose}_${vendor}`, "result=preflight_workspace_unavailable");
      } finally {
        if (root) rmSync(root, { recursive: true, force: true });
      }
    }
  }
  return nativeProducerResult(true, identity, "complete", "result=compatible", producer);
}

function parseNativeSetupRecoveryReport(value: unknown): NativeSetupRecoveryReport {
  const report = record(value);
  if (!report || !Object.keys(report).every((key) => ["version", "sequence", "phase", "state", "code", "decision"].includes(key)) ||
    !["version", "sequence", "phase", "state", "code"].every((key) => Object.hasOwn(report, key))) throw new NativeSetupRecoveryError("invalid report_setup_recovery v1 input");
  if (report.version !== "1" || typeof report.sequence !== "number" || !Number.isSafeInteger(report.sequence) || report.sequence < 1 || report.sequence > MAX_SAFE_SETUP_RECOVERY_SEQUENCE ||
    (report.phase !== "connect" && report.phase !== "context") ||
    (report.state !== "working" && report.state !== "needs_input" && report.state !== "needs_decision" && report.state !== "retryable_failure" && report.state !== "reported_complete") ||
    (report.code !== "in_progress" && report.code !== "user_action_required" && report.code !== "continue_or_stop" && report.code !== "retryable" && report.code !== "completion_reported")) throw new NativeSetupRecoveryError("invalid report_setup_recovery v1 input");
  const decision = report.decision;
  const decisionRecord = record(decision);
  const validDecision = decisionRecord !== undefined && hasExactlyKeys(decisionRecord, ["kind", "choices"]) && decisionRecord.kind === "continue_or_stop" && Array.isArray(decisionRecord.choices) && decisionRecord.choices.length === 2 && decisionRecord.choices[0] === "continue" && decisionRecord.choices[1] === "stop";
  const valid = (report.state === "working" && report.code === "in_progress" && decision === undefined)
    || (report.state === "needs_input" && report.code === "user_action_required" && decision === undefined)
    || (report.state === "needs_decision" && report.code === "continue_or_stop" && validDecision)
    || (report.state === "retryable_failure" && report.code === "retryable" && decision === undefined)
    || (report.state === "reported_complete" && report.code === "completion_reported" && decision === undefined);
  if (!valid) throw new NativeSetupRecoveryError("invalid report_setup_recovery v1 input");
  return report as unknown as NativeSetupRecoveryReport;
}

/**
 * Strict parser for the public v2/v4 producer contracts. V4 deliberately
 * omits the host-issued scope; Setup exposes only its separately authorized
 * bootstrap root, which is revalidated against the durable host configuration.
 */
export function readNativeLaunchSpec(cwd: string, purpose: NativePurpose, vendor: NativeVendor, scopeId: string, binding?: EnrichmentBinding, mcp?: NativeMcpDescriptor, materializationState?: NativeSessionStateBase, authorizedWorkspace?: string, providerLaunch?: NativeProviderLaunch): InteractiveLaunchSpec {
  const ownershipRoot = binding?.path ?? authorizedWorkspace;
  const root = materializationState && ownershipRoot
    ? validateNativeSessionWorkspace(materializationState, ownershipRoot, cwd)
    : realpathSync(cwd);
  const specPath = path.join(root, ".warble", "interactive-launch.json");
  if (!existsSync(specPath)) throw new InteractiveLaunchError("native session launch artifacts are unavailable");
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(specPath, "utf8")); } catch { throw new InteractiveLaunchError("native session launch specification is invalid"); }
  const value = record(raw);
  const isV4 = mcp !== undefined;
  const isSetupV4 = isV4 && purpose === "setup";
  const keys = ["version", "target", "purpose", "executable", "argv", "agent", ...(isV4 ? ["mcp", ...(isSetupV4 ? ["bootstrap_root"] : [])] : ["scope"]), "cwd", "artifact_root", "handoff_path"];
  const target = targetForProvider(vendor);
  const executable = vendor === "claude" ? "claude" : "codex";
  const expectedAgent = agentFor(purpose, vendor);
  const scopeEntry = claudeScopeEntry(purpose, vendor);
  if (!value || !hasExactlyKeys(value, keys) ||
    value.version !== (isV4 ? "4" : "2") || value.target !== target || value.purpose !== purpose || value.executable !== executable ||
    !Array.isArray(value.argv) || !value.argv.every((arg) => typeof arg === "string") || !record(value.agent) ||
    (!isV4 && !record(value.scope)) || (isV4 && !record(value.mcp)) || (isSetupV4 && typeof value.bootstrap_root !== "string") || typeof value.cwd !== "string" || typeof value.artifact_root !== "string" || typeof value.handoff_path !== "string") {
    throw new InteractiveLaunchError("native session launch specification is incompatible");
  }
  const welcome = welcomePromptFor(purpose);
  const baseArgv = scopeEntry
    ? isV4 ? [welcome] : []
    : isV4
      ? vendor === "claude" ? ["--agent", expectedAgent, welcome] : [welcome]
      : vendor === "claude" ? ["--agent", expectedAgent] : [];
  const spawnBaseArgv = vendor === "codex" ? ["--dangerously-bypass-hook-trust", ...baseArgv] : baseArgv;
  const agent = value.agent as Record<string, unknown>;
  const scope = record(value.scope);
  const launchMcp = record(value.mcp);
  const launchBinding = scope ? record(scope.binding) : undefined;
  const validV2Scope = scope !== undefined && hasExactlyKeys(scope, ["kind", "scope_id", "bootstrap_root", "binding"])
    && (scope.binding === null || (launchBinding !== undefined && hasExactlyKeys(launchBinding, ["project_identity", "generation", "revision"])))
    && scope.kind === (purpose === "setup" ? "bootstrap" : "bound_project") && scope.scope_id === scopeId
    && (purpose === "setup" ? typeof scope.bootstrap_root === "string" : scope.bootstrap_root === null);
  // A scope-entry launch names the whole profile, not one pinned component, so the emitted
  // "agent" descriptor is a distinct kind (`claude_scope`) carrying the profile id rather than
  // `claude_agent`/`expectedAgent`. See `claudeScopeEntry` above.
  const expectedAgentKind = scopeEntry ? "claude_scope" : vendor === "claude" ? "claude_agent" : "codex_skill";
  const expectedAgentName = scopeEntry ? NATIVE_DISPATCH_REGISTRY[purpose].profile : expectedAgent;
  if (!hasExactlyKeys(agent, ["kind", "name"]) || (!isV4 && !validV2Scope) ||
    JSON.stringify(value.argv) !== JSON.stringify(baseArgv) || agent.kind !== expectedAgentKind || agent.name !== expectedAgentName ||
    (isV4 && (!launchMcp || !hasExactlyKeys(launchMcp, ["server_name", "credential_env_var"]) || launchMcp.server_name !== "genbi_session" || launchMcp.credential_env_var !== NATIVE_MCP_CREDENTIAL_ENV_VAR))) throw new InteractiveLaunchError("native session launch specification is incompatible");
  let specCwd: string; let artifactRoot: string; let handoffPath: string;
  try { specCwd = realpathSync(value.cwd); artifactRoot = realpathSync(value.artifact_root); handoffPath = realpathSync(value.handoff_path); } catch { throw new InteractiveLaunchError("native session launch paths are unavailable"); }
  if (specCwd !== root || artifactRoot !== root || !contained(root, handoffPath)) throw new InteractiveLaunchError("native session launch paths are outside its server-owned scope");
  let bootstrapRoot: string | undefined;
  if (purpose === "setup") {
    const expectedBootstrapRoot = authorizedWorkspace && configuredWorkspace(authorizedWorkspace, true);
    const launchBootstrapRoot = isSetupV4 ? value.bootstrap_root : scope?.bootstrap_root;
    if (typeof launchBootstrapRoot !== "string") throw new InteractiveLaunchError("native session launch bootstrap root is unavailable");
    let canonicalLaunchBootstrapRoot: string;
    try { canonicalLaunchBootstrapRoot = realpathSync(launchBootstrapRoot); } catch { throw new InteractiveLaunchError("native session launch bootstrap root is unavailable"); }
    if (canonicalLaunchBootstrapRoot !== launchBootstrapRoot || (authorizedWorkspace !== undefined && !expectedBootstrapRoot) || (expectedBootstrapRoot !== undefined && canonicalLaunchBootstrapRoot !== expectedBootstrapRoot) || canonicalLaunchBootstrapRoot === root) throw new InteractiveLaunchError("native session launch bootstrap root is incompatible");
    bootstrapRoot = canonicalLaunchBootstrapRoot;
  }
  if (!isV4) {
    if (binding) {
      if (!launchBinding || launchBinding.project_identity !== binding.identity || launchBinding.generation !== String(binding.generation) || launchBinding.revision !== binding.revision) throw new InteractiveLaunchError("native session launch binding is stale");
    } else if (scope?.binding !== null) throw new InteractiveLaunchError("native session launch specification is incompatible");
  }
  if (providerLaunch?.kind === "initial" && vendor !== "claude") throw new InteractiveLaunchError("native session launch specification is incompatible");
  // Claude's welcome text is positional. Provider flags must remain before it
  // so neither `--session-id` nor `--resume` can be parsed as conversation
  // text by a future CLI parser.
  const argv = providerLaunch?.kind === "initial"
    ? [...(scopeEntry ? [] : ["--agent", expectedAgent]), "--session-id", providerLaunch.sessionId, ...(isV4 ? [welcome] : [])]
    : providerLaunch?.kind === "resume"
      ? vendor === "claude"
        ? [...(scopeEntry ? [] : ["--agent", expectedAgent]), "--resume", providerLaunch.handle, ...(isV4 ? [welcome] : [])]
        : ["--dangerously-bypass-hook-trust", "-c", 'tui.resume_cwd="current"', "resume", providerLaunch.handle, ...(isV4 ? [welcome] : [])]
      : spawnBaseArgv;
  return { version: isV4 ? "4" : "2", target, executable, argv, cwd: root, artifact_root: root, handoff_path: handoffPath, ...(bootstrapRoot ? { bootstrap_root: bootstrapRoot } : {}) };
}

/**
 * Materializes only host-owned, short-lived producer inputs. The scope and
 * MCP descriptor deliberately stay in separate exclusive files because the
 * public Warble v4 contract parses them through distinct flags and keeps the
 * credential out of the scope schema and every argv value.
 */
export async function dispatchNativeArtifacts(input: NativeDispatchInput): Promise<void> {
  let tempRoot: string;
  try { tempRoot = realpathSync(os.tmpdir()); } catch { throw new InteractiveLaunchError("native session materialization failed"); }
  const dir = mkdtempSync(path.join(tempRoot, "genbi-native-dispatch-"));
  const scopePath = path.join(dir, "scope.json");
  const mcpPath = path.join(dir, "mcp.json");
  try {
    const directory = lstatSync(dir);
    if (!directory.isDirectory() || directory.isSymbolicLink() || !contained(tempRoot, dir)) throw new InteractiveLaunchError("native session materialization failed");
    chmodSync(dir, 0o700);
    if ((lstatSync(dir).mode & 0o777) !== 0o700 || !contained(dir, scopePath) || !contained(dir, mcpPath)) throw new InteractiveLaunchError("native session materialization failed");
    writeFileSync(scopePath, JSON.stringify(input.scope), { encoding: "utf8", mode: 0o600, flag: "wx" });
    if (input.mcp) writeFileSync(mcpPath, JSON.stringify(input.mcp), { encoding: "utf8", mode: 0o600, flag: "wx" });
    const validateDescriptorFile = (file: string): void => {
      const metadata = lstatSync(file);
      if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600) throw new InteractiveLaunchError("native session materialization failed");
    };
    validateDescriptorFile(scopePath);
    if (input.mcp) validateDescriptorFile(mcpPath);
    const executable = input.producer?.executable ?? input.warbleBin;
    if (input.producer) assertNativeProducerIdentity(input.producer);
    const args = ["dispatch", input.irPath, "--target", input.target, "--purpose", input.purpose, "--native-scope", scopePath, ...(input.mcp ? ["--native-mcp", mcpPath] : []), "--out", input.cwd];
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, args, { cwd: input.cwd, shell: false, stdio: "ignore" });
      child.once("error", () => reject(new InteractiveLaunchError("native session materialization failed")));
      child.once("exit", (code) => code === 0 ? resolve() : reject(new InteractiveLaunchError("native session materialization failed")));
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

export class NativeSessionService {
  private readonly sessions = new Map<string, InteractiveTerminalSession>();
  private readonly leaseTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Open/reconnect coalescing only lasts while a matching launch is in flight. */
  private readonly launches = new Map<string, { readonly scopeKey: string; readonly launch: Promise<NativeSessionLaunch> }>();
  /** Bounded post-settlement delivery replay, fenced to the captured server scope. */
  private readonly startSeparateReplays = new Map<string, StartSeparateReplay>();
  /** In-process duplicate delivery fence for one durable provider-resume action. */
  private readonly resumeLaunches = new Map<string, Promise<NativeSessionLaunch>>();
  private readonly artifactCredentials = new Map<string, string>();
  /** Kept only while the owning BFF and PTY remain live; never reconstructed from SQLite. */
  private readonly recoveryCapabilities = new Map<string, string>();
  private readonly idleTtlMs: number;
  private readonly startSeparateReplayTtlMs: number;
  private readonly startSeparateReplayLimit: number;
  private fixtureMaterializationState: NativeSessionStateBase | undefined;
  constructor(private readonly options: NativeSessionServiceOptions) {
    this.idleTtlMs = options.idleTtlMs ?? options.postClaimDetachGraceMs ?? NATIVE_SESSION_IDLE_TTL_MS;
    if (!Number.isSafeInteger(this.idleTtlMs) || this.idleTtlMs <= 0) throw new RangeError("native session idle TTL must be a positive integer");
    this.startSeparateReplayTtlMs = options.startSeparateReplayTtlMs ?? START_SEPARATE_REPLAY_TTL_MS;
    this.startSeparateReplayLimit = options.startSeparateReplayLimit ?? START_SEPARATE_REPLAY_LIMIT;
    if (!Number.isSafeInteger(this.startSeparateReplayTtlMs) || this.startSeparateReplayTtlMs <= 0) throw new RangeError("native start-separate replay TTL must be a positive integer");
    if (!Number.isSafeInteger(this.startSeparateReplayLimit) || this.startSeparateReplayLimit <= 0) throw new RangeError("native start-separate replay limit must be a positive integer");
    // Unit-only producer seams lack a configured BFF database. Establish their
    // throwaway root at construction, never from the readiness probe.
    if (!options.materializationState && (options.dispatch !== undefined || options.producerAvailable !== undefined || options.warbleBin === "unused")) {
      this.fixtureMaterializationState = initializeNativeSessionStateBase(path.join(mkdtempSync(path.join(os.tmpdir(), "genbi-native-fixture-state-")), "bff.sqlite"));
    }
  }

  /** Existing injected producer seams are test-only and preserve old unit fixtures. */
  private legacyFixtureMode(): boolean {
    return this.options.dispatch !== undefined || this.options.producerAvailable !== undefined || this.options.warbleBin === "unused";
  }

  private pinnedCodexExecutable(required: boolean): string | undefined {
    try {
      if (!this.options.codexBin || !this.options.codexBinSha256) throw new Error("missing pin");
      const sourcePin = required && this.options.codexSource && this.options.codexSourceClosureSha256 && this.options.codexVersion
        ? { source: this.options.codexSource, closureSha256: this.options.codexSourceClosureSha256, version: this.options.codexVersion }
        : undefined;
      if (required && !sourcePin) throw new Error("missing source pin");
      return resolvePinnedCodexExecutable(this.options.codexBin, this.options.codexBinSha256, sourcePin);
    } catch {
      if (required) throw new InteractiveLaunchError("the attested Codex executable is unavailable or has changed");
      return undefined;
    }
  }

  /**
   * Production must inject the DB-derived base at BFF startup. Existing unit
   * seams have no BFF database path, so give only those injected producers an
   * external throwaway state root; browser/API routes can never take this path.
   */
  private materializationState(): NativeSessionStateBase | undefined {
    if (this.options.materializationState) return this.options.materializationState;
    return this.fixtureMaterializationState;
  }

  /**
   * Test-injected producers retain their historical seam. Production always
   * invokes the actual configured executable and logs only the redacted,
   * content-addressed diagnostic; the browser never receives it.
   */
  private async productionProducerPreflight(): Promise<NativeProducerPreflightResult | undefined> {
    if (this.legacyFixtureMode()) return undefined;
    const result = await probeNativeSessionProducer({ warbleBin: this.options.warbleBin, irPaths: this.options.irPaths, ...(this.options.wrenShim !== undefined ? { wrenShim: this.options.wrenShim } : {}) });
    const log = result.available ? console.info : console.warn;
    log(`[native-sessions] producer preflight ${result.diagnostic}`);
    return result;
  }

  /**
   * SQLite is the durable source of truth, but a native PTY and its attach
   * capability are deliberately process-local.  A BFF restart (or a lease
   * expiry racing a browser reconnect) can therefore leave an old durable
   * `detached` row behind after its process-local terminal is gone.  Reconcile
   * that impossible "live" projection at every browser-visible read instead
   * of letting the client repeatedly open a WebSocket to a missing PTY.
   */
  list(): NativeSessionRow[] {
    return this.options.store.listNativeSessions().map((row) => this.reconcileMissingTerminal(row));
  }
  get(id: string): NativeSessionRow | undefined {
    const row = this.options.store.getNativeSession(id);
    return row ? this.reconcileMissingTerminal(row) : undefined;
  }
  runtime(id: string): InteractiveTerminalSession | undefined { return this.sessions.get(id); }
  recovery(id: string): NativeSetupRecoveryRow | undefined { return this.options.store.getNativeSetupRecovery(id); }

  private reconcileMissingTerminal(row: NativeSessionRow): NativeSessionRow {
    // `creating` is intentionally not reconciled here: launch awaits can
    // yield while the durable row is still being initialized. It has never
    // owned an attachable capability, so treating it as a missing terminal
    // would race creation and could terminalize a PTY that is about to start.
    if ((row.status !== "running" && row.status !== "detached") || this.sessions.has(row.id)) return row;
    // Commit the durable fence first.  The cleanup below is best effort and
    // cannot leave a browser-facing row claiming that it can reattach.
    this.captureCodexResumeHandle(row);
    const stopped = this.options.store.stopNativeSessionAndRevokeRecoveryAction(row.id, {
      failure: "native terminal is no longer available for attachment",
    })!;
    this.clearLease(row.id);
    this.clearStartSeparateReplaysForSession(row.id);
    this.recoveryCapabilities.delete(row.id);
    this.options.artifactService?.revoke(this.artifactCredentials.get(row.id));
    this.artifactCredentials.delete(row.id);
    return stopped;
  }

  /** A legacy persisted Runtime must be repaired before it can authorize a PTY. */
  private assertRuntimeDispatchable(): void {
    if (!this.options.store.hasExplicitRuntimeSettings()) return;
    const correction = runtimeSettingsCorrection(this.options.store.getRuntimeSettings());
    if (correction) throw new InteractiveLaunchError(correction);
  }

  /**
   * Reopen only a still-live session in the exact server-owned scope.  In
   * particular, a setup session never inherits the active project binding,
   * while a bound-purpose session cannot cross a generation or revision.
   */
  async openOrCreate(input: { purpose: NativePurpose; vendor?: NativeVendor }): Promise<NativeSessionLaunch> {
    this.assertRuntimeDispatchable();
    const storedRuntime = this.options.store.getNativeRuntimeBinding();
    // Compatibility seam for existing server-side callers/tests only. Browser
    // routes never admit `vendor`, so all web launches remain runtime-bound.
    const runtime = !storedRuntime.configured && input.vendor
      ? { configured: true as const, generation: 0, provider: input.vendor, target: targetForProvider(input.vendor), targetLabel: nativeTargetLabel(input.vendor) }
      : storedRuntime;
    const dispatch = dispatchForPurpose(input.purpose, runtime);
    if (!dispatch) throw new InteractiveLaunchError("native sessions require a saved Runtime & authentication binding");
    const binding = input.purpose === "setup" ? undefined : this.options.getBinding();
    const reusable = this.list().find((row) => this.matchesOpenScope(row, input.purpose, dispatch.target, runtime.generation, binding));
    if (reusable) {
      const recoveryCapability = this.recoveryCapabilities.get(reusable.id);
      return { row: reusable, capability: this.sessions.get(reusable.id)!.capability, ...(recoveryCapability ? { recoveryCapability } : {}) };
    }
    const scopeKey = input.purpose === "setup"
      ? JSON.stringify([input.purpose, dispatch.target, runtime.generation, "bootstrap"])
      : JSON.stringify([input.purpose, dispatch.target, runtime.generation, binding?.identity ?? "unbound", binding?.generation ?? null, binding?.revision ?? null]);
    return this.singleFlight(`open:${scopeKey}`, scopeKey, input, binding, runtime);
  }

  /** Opens the exact row selected by the browser after revalidating its scope. */
  async openExisting(input: { purpose: NativePurpose; id: string; vendor?: NativeVendor }): Promise<NativeSessionLaunch> {
    this.assertRuntimeDispatchable();
    const storedRuntime = this.options.store.getNativeRuntimeBinding();
    const runtime = !storedRuntime.configured && input.vendor
      ? { configured: true as const, generation: 0, provider: input.vendor, target: targetForProvider(input.vendor), targetLabel: nativeTargetLabel(input.vendor) }
      : storedRuntime;
    const dispatch = dispatchForPurpose(input.purpose, runtime);
    if (!dispatch) throw new InteractiveLaunchError("native sessions require a saved Runtime & authentication binding");
    const binding = input.purpose === "setup" ? undefined : this.options.getBinding();
    const row = this.get(input.id);
    if (!row || !this.matchesOpenScope(row, input.purpose, dispatch.target, runtime.generation, binding)) throw new InteractiveLaunchError("native session is unavailable");
    const recoveryCapability = this.recoveryCapabilities.get(row.id);
    return { row, capability: this.sessions.get(row.id)!.capability, ...(recoveryCapability ? { recoveryCapability } : {}) };
  }

  /**
   * Starts a separate TUI even when a matching session is live.  The caller's
   * action id is intentionally part of the single-flight key: retries of one
   * click coalesce, while a later intentional launch receives new durable and
   * browser-scoped authority.
   */
  async startSeparate(input: { purpose: NativePurpose; idempotencyKey: string; vendor?: NativeVendor }): Promise<NativeSessionLaunch> {
    this.assertRuntimeDispatchable();
    const storedRuntime = this.options.store.getNativeRuntimeBinding();
    const runtime = !storedRuntime.configured && input.vendor
      ? { configured: true as const, generation: 0, provider: input.vendor, target: targetForProvider(input.vendor), targetLabel: nativeTargetLabel(input.vendor) }
      : storedRuntime;
    const dispatch = dispatchForPurpose(input.purpose, runtime);
    if (!dispatch) throw new InteractiveLaunchError("native sessions require a saved Runtime & authentication binding");
    const binding = input.purpose === "setup" ? undefined : this.options.getBinding();
    const scopeKey = input.purpose === "setup"
      ? JSON.stringify([input.purpose, dispatch.target, runtime.generation, "bootstrap"])
      : JSON.stringify([input.purpose, dispatch.target, runtime.generation, binding?.identity ?? "unbound", binding?.generation ?? null, binding?.revision ?? null]);
    return this.replayStartSeparate(`start:${input.idempotencyKey}`, scopeKey, input, binding, runtime);
  }

  /**
   * Continues only a sealed Claude conversation. This creates a new durable
   * process row and materialization root; it never reattaches or relabels a
   * fresh conversation as a resume.
   */
  async resume(input: { id: string; idempotencyKey: string }): Promise<NativeSessionLaunch> {
    this.assertRuntimeDispatchable();
    const source = this.get(input.id);
    if (!source || (source.status !== "exited" && source.status !== "stopped" && source.status !== "interrupted" && source.status !== "failed" && source.status !== "stale")) {
      throw new InteractiveLaunchError("native session resume is unavailable");
    }
    this.captureCodexResumeHandle(source);
    const existingAction = this.options.store.getNativeSessionResumeAction(source.id, input.idempotencyKey);
    const scope = this.resumeScope(source);
    if (!scope) {
      if (existingAction) this.failReservedResume(existingAction.resumedSessionId, "native session resume is stale because its Runtime or project binding changed");
      this.options.store.invalidateNativeSessionResume(source.id);
      throw new InteractiveLaunchError("native session resume is stale because its Runtime or project binding changed");
    }
    const launchKey = `${source.id}:${input.idempotencyKey}`;
    const inFlight = this.resumeLaunches.get(launchKey);
    if (inFlight) return inFlight;
    const launch = this.resumeReserved(source, input.idempotencyKey, scope);
    this.resumeLaunches.set(launchKey, launch);
    try {
      return await launch;
    } finally {
      if (this.resumeLaunches.get(launchKey) === launch) this.resumeLaunches.delete(launchKey);
    }
  }

  /** Browser-visible resume state uses the same current-scope fence as launch, plus *why* when it fails. */
  resumeAvailability(row: NativeSessionRow): NativeSessionResumeAvailability {
    if (row.status !== "exited" && row.status !== "stopped" && row.status !== "interrupted" && row.status !== "failed" && row.status !== "stale") {
      return { available: false, cause: "not_terminal" };
    }
    this.captureCodexResumeHandle(row);
    if (this.options.store.hasExplicitRuntimeSettings() && runtimeSettingsCorrection(this.options.store.getRuntimeSettings())) {
      return { available: false, cause: "runtime_settings_correction" };
    }
    const scope = this.resumeScope(row);
    if (scope === undefined) return { available: false, cause: "scope_stale" };
    if (!this.resumeWorkspaceAvailable(row, scope.binding)) return { available: false, cause: "workspace_unavailable" };
    if (!this.options.store.hasAvailableNativeSessionResume(row.id, row.vendor)) return { available: false, cause: "no_resume_handle" };
    return { available: true };
  }

  /** Thin boolean projection kept for callers that only need a yes/no. */
  resumeAvailable(row: NativeSessionRow): boolean {
    return this.resumeAvailability(row).available;
  }

  /**
   * Codex exposes the current thread UUID to hooks. Warble's isolated hook writes
   * only that UUID under this session's BFF-owned materialization. The BFF reads
   * no global Codex state and persists only a provider-bound encrypted envelope.
   */
  private captureCodexResumeHandle(row: NativeSessionRow): void {
    if (row.vendor !== "codex" || this.options.store.hasAvailableNativeSessionResume(row.id, "codex")) return;
    const state = this.materializationState();
    if (!state) return;
    const root = path.join(state.root, "native", row.id);
    const file = path.join(root, CODEX_RESUME_HANDLE_FILE);
    try {
      if (!contained(root, file)) return;
      const entry = lstatSync(file);
      if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o777) !== 0o600 || realpathSync(file) !== file) return;
      const handle = readFileSync(file, "utf8").trim();
      if (!PROVIDER_SESSION_UUID.test(handle)) return;
      const sealed = sealNativeResumeHandle(state, row.id, "codex", handle);
      this.options.store.saveNativeSessionResumeHandle(row.id, "codex", sealed);
    } catch {
      // No completed prompt means no Codex thread exists yet. Missing or unsafe
      // capture state stays restart-only and never degrades terminal cleanup.
    }
  }

  private resumeScope(row: NativeSessionRow): { readonly binding: EnrichmentBinding | undefined; readonly runtime: NativeRuntimeBinding; readonly dispatch: NonNullable<ReturnType<typeof dispatchForPurpose>> } | undefined {
    const storedRuntime = this.options.store.getNativeRuntimeBinding();
    const runtime: NativeRuntimeBinding = !storedRuntime.configured && this.legacyFixtureMode()
      ? { configured: true, generation: 0, provider: row.vendor, target: targetForProvider(row.vendor), targetLabel: nativeTargetLabel(row.vendor) }
      : storedRuntime;
    const dispatch = dispatchForPurpose(row.purpose, runtime);
    const binding = row.purpose === "setup" ? undefined : this.options.getBinding();
    const matches = dispatch?.provider === row.vendor && row.dispatchProfile === dispatch.profile && row.dispatchTarget === dispatch.target && row.runtimeGeneration === runtime.generation
      && (row.purpose === "setup"
        ? row.scopeKind === "bootstrap" && row.projectIdentity === null && row.bindingGeneration === null && row.projectRevision === null
        : binding !== undefined && row.scopeKind === "bound_project" && row.projectIdentity === binding.identity && row.bindingGeneration === binding.generation && row.projectRevision === binding.revision);
    return matches && dispatch ? { binding, runtime, dispatch } : undefined;
  }

  private resumeWorkspaceAvailable(row: NativeSessionRow, binding: EnrichmentBinding | undefined): boolean {
    const configuredCwd = binding?.path ?? this.options.workspaceRoot;
    const authorizedWorkspace = configuredCwd === undefined ? undefined : configuredWorkspace(configuredCwd, false);
    return authorizedWorkspace !== undefined
      && nativeSessionStateBaseAvailableForProject(this.materializationState(), authorizedWorkspace)
      && (row.purpose === "setup" || binding !== undefined);
  }

  private async resumeReserved(source: NativeSessionRow, idempotencyKey: string, scope: { readonly binding: EnrichmentBinding | undefined; readonly runtime: NativeRuntimeBinding; readonly dispatch: NonNullable<ReturnType<typeof dispatchForPurpose>> }): Promise<NativeSessionLaunch> {
    const fingerprint = resumeScopeFingerprint(source);
    const existing = this.options.store.getNativeSessionResumeAction(source.id, idempotencyKey);
    if (existing) {
      if (existing.scopeFingerprint !== fingerprint) {
        this.failReservedResume(existing.resumedSessionId, "native session resume action is stale");
        throw new InteractiveLaunchError("native session resume action is stale");
      }
      return this.recoverReservedResume(existing.resumedSessionId, scope);
    }
    const stored = this.options.store.getNativeSessionResumeHandle(source.id);
    const state = this.materializationState();
    if (!stored || stored.provider !== source.vendor || stored.consumedAt !== null || !state) throw new InteractiveLaunchError("native session resume is unavailable");
    let handle: string;
    try { handle = unsealNativeResumeHandle(state, source.id, source.vendor, stored.sealedHandle); }
    catch (error) {
      this.options.store.invalidateNativeSessionResume(source.id);
      throw error;
    }
    const childId = newId("native-session"); const childScopeId = newId("native-scope");
    const sealedChild = sealNativeResumeHandle(state, childId, source.vendor, handle);
    const reserved = this.options.store.reserveNativeSessionResume({
      sourceSessionId: source.id, idempotencyKey, scopeFingerprint: fingerprint, sealedHandle: sealedChild,
      child: {
        id: childId, purpose: source.purpose, vendor: source.vendor, agent: agentFor(source.purpose, source.vendor), scopeKind: source.scopeKind, scopeId: childScopeId,
        dispatchProfile: scope.dispatch.profile, dispatchTarget: scope.dispatch.target, runtimeGeneration: scope.runtime.generation,
        ...(scope.binding ? { projectIdentity: scope.binding.identity, bindingGeneration: scope.binding.generation, projectRevision: scope.binding.revision } : {}),
      },
    });
    if (!reserved) throw new InteractiveLaunchError("native session resume is unavailable");
    if (!reserved.created) return this.recoverReservedResume(reserved.row.id, scope);
    return this.create({ purpose: source.purpose, ...(this.legacyFixtureMode() ? { vendor: source.vendor } : {}) }, scope.binding, scope.runtime, { row: reserved.row, handle });
  }

  private async recoverReservedResume(id: string, scope: { readonly binding: EnrichmentBinding | undefined; readonly runtime: NativeRuntimeBinding; readonly dispatch: NonNullable<ReturnType<typeof dispatchForPurpose>> }): Promise<NativeSessionLaunch> {
    const row = this.get(id);
    if (!row) throw new InteractiveLaunchError("native session resume is unavailable");
    const terminal = this.sessions.get(row.id);
    if (terminal) return { row, capability: terminal.capability };
    // Store reconciliation marks an unstarted reservation `interrupted` on a
    // BFF restart along with live rows. `startedAt === null` distinguishes
    // this crash window from a child PTY that actually ran and later died.
    if (row.status !== "creating" && !(row.status === "interrupted" && row.startedAt === null)) return { row };
    const state = this.materializationState();
    const stored = this.options.store.getNativeSessionResumeHandle(row.id);
    if (!state || !stored || stored.provider !== row.vendor || stored.consumedAt !== null) {
      this.failReservedResume(row.id, "native session resume reservation cannot be recovered");
      throw new InteractiveLaunchError("native session resume reservation cannot be recovered");
    }
    let handle: string;
    try { handle = unsealNativeResumeHandle(state, row.id, row.vendor, stored.sealedHandle); }
    catch (error) {
      this.failReservedResume(row.id, "native session resume reservation cannot be recovered");
      throw error;
    }
    return this.create({ purpose: row.purpose, ...(this.legacyFixtureMode() ? { vendor: row.vendor } : {}) }, scope.binding, scope.runtime, { row, handle });
  }

  private failReservedResume(id: string, failure: string): void {
    const row = this.options.store.getNativeSession(id);
    if (row?.status === "creating" || (row?.status === "interrupted" && row.startedAt === null)) this.options.store.transitionNativeSession(id, "failed", { failure, ended: true });
    this.options.store.invalidateNativeSessionResume(id);
  }

  private matchesOpenScope(row: NativeSessionRow, purpose: NativePurpose, target: InteractiveTarget, generation: number, binding: EnrichmentBinding | undefined): boolean {
    if (row.purpose !== purpose || row.dispatchTarget !== target || row.runtimeGeneration !== generation || !this.sessions.has(row.id)) return false;
    if (row.status !== "creating" && row.status !== "running" && row.status !== "detached") return false;
    return purpose === "setup"
      ? row.scopeKind === "bootstrap" && row.projectIdentity === null && row.bindingGeneration === null && row.projectRevision === null
      : row.scopeKind === "bound_project" && binding !== undefined && row.projectIdentity === binding.identity && row.bindingGeneration === binding.generation && row.projectRevision === binding.revision;
  }

  /**
   * A start-separate action is browser-scoped by its unguessable UUID. This
   * BFF has no user principal beyond its local browser capability boundary, so
   * its captured Runtime/binding scope is also the authorization fence.
   */
  private replayStartSeparate(
    launchKey: string,
    scopeKey: string,
    input: { purpose: NativePurpose; vendor?: NativeVendor },
    binding: EnrichmentBinding | undefined,
    runtime: NativeRuntimeBinding,
  ): Promise<NativeSessionLaunch> {
    const existing = this.startSeparateReplays.get(launchKey);
    if (existing) {
      if (existing.scopeKey !== scopeKey) throw new InteractiveLaunchError("native session launch action is stale");
      if (this.replayIsUsable(existing)) return existing.launch;
      this.startSeparateReplays.delete(launchKey);
    }
    const launch = this.create(input, binding, runtime);
    const replay: StartSeparateReplay = { scopeKey, launch };
    this.startSeparateReplays.set(launchKey, replay);
    void launch.then((result) => { replay.settledAt = Date.now(); replay.result = result; this.trimStartSeparateReplays(); }, () => { replay.settledAt = Date.now(); this.trimStartSeparateReplays(); });
    return launch;
  }

  private replayIsUsable(replay: StartSeparateReplay): boolean {
    if (replay.settledAt === undefined) return true;
    if (Date.now() - replay.settledAt >= this.startSeparateReplayTtlMs) return false;
    // A successful response may contain an attach capability. Never replay it
    // after the owning PTY/capability has gone away; failures carry no terminal
    // capability and remain safely replayable within the same fenced scope.
    return !replay.result?.capability || this.sessions.get(replay.result.row.id)?.capability === replay.result.capability;
  }

  private trimStartSeparateReplays(): void {
    for (const [key, replay] of this.startSeparateReplays) {
      if (replay.settledAt !== undefined && !this.replayIsUsable(replay)) this.startSeparateReplays.delete(key);
    }
    let settled = [...this.startSeparateReplays.entries()].filter(([, replay]) => replay.settledAt !== undefined);
    while (settled.length > this.startSeparateReplayLimit) {
      this.startSeparateReplays.delete(settled.shift()![0]);
    }
  }

  private clearStartSeparateReplaysForSession(id: string): void {
    for (const [key, replay] of this.startSeparateReplays) {
      if (replay.result?.row.id === id) this.startSeparateReplays.delete(key);
    }
  }

  private async singleFlight(
    launchKey: string,
    scopeKey: string,
    input: { purpose: NativePurpose; vendor?: NativeVendor },
    binding: EnrichmentBinding | undefined,
    runtime: NativeRuntimeBinding,
  ): Promise<NativeSessionLaunch> {
    const pending = this.launches.get(launchKey);
    if (pending) {
      // An action id must never be replayed across a changed Runtime/binding.
      if (pending.scopeKey !== scopeKey) throw new InteractiveLaunchError("native session launch action is stale");
      return pending.launch;
    }
    const launch = this.create(input, binding, runtime);
    this.launches.set(launchKey, { scopeKey, launch });
    try {
      return await launch;
    } finally {
      if (this.launches.get(launchKey)?.launch === launch) this.launches.delete(launchKey);
    }
  }

  async readiness(): Promise<NativeSessionReadiness> {
    const terminalHostAvailable = this.options.terminalHostAvailable ?? (async () => true);
    const pinnedCodexAvailable = !this.options.executableAvailable && !this.legacyFixtureMode()
      ? this.pinnedCodexExecutable(false) !== undefined
      : undefined;
    const executableAvailable = (vendor: NativeVendor) => this.options.executableAvailable
      ? this.options.executableAvailable(vendor)
      : vendor === "codex" && pinnedCodexAvailable !== undefined
        ? pinnedCodexAvailable
        : interactiveExecutableAvailable(vendor);
    const hostAvailable = await terminalHostAvailable();
    const mcpReadiness = this.options.artifactService?.readiness();
    const runtime = this.options.store.getNativeRuntimeBinding();
    const runtimeCorrection = this.options.store.hasExplicitRuntimeSettings()
      ? runtimeSettingsCorrection(this.options.store.getRuntimeSettings())
      : undefined;
    const legacyFixture = !runtime.configured && this.legacyFixtureMode();
    const producer = this.legacyFixtureMode() ? undefined : await this.productionProducerPreflight();
    const legacyProducerAvailable = this.options.producerAvailable ?? (() => this.options.dispatch !== undefined || localExecutableAvailable(this.options.warbleBin));
    const result = {} as Record<NativePurpose, NativePurposeReadiness>;
    for (const purpose of NATIVE_PURPOSES) {
      const definition = NATIVE_DISPATCH_REGISTRY[purpose];
      const dispatch = dispatchForPurpose(purpose, runtime);
      const scopeKind = definition.scopeKind;
      const cwd = purpose === "setup" ? this.options.workspaceRoot : this.options.getBinding()?.path;
      const irPath = this.options.irPaths[purpose];
      const configuredRoot = cwd === undefined ? undefined : configuredWorkspace(cwd, false);
      const projectAvailable = configuredRoot !== undefined || (purpose === "setup" && cwd !== undefined && bootstrapWorkspaceCreatable(cwd));
      // Existing project roots must pass the exact same canonical outside-project
      // check used by createNativeSessionWorkspace. A missing-but-creatable Setup
      // root has no state overlap yet, and remains non-mutating at readiness.
      const stateAvailable = configuredRoot !== undefined
        ? nativeSessionStateBaseAvailableForProject(this.materializationState(), configuredRoot)
        : purpose === "setup" && projectAvailable && nativeSessionStateBaseAvailable(this.materializationState());
      const workspaceUnavailable = !projectAvailable || !stateAvailable;
      const reason = runtimeCorrection
        ?? (!dispatch && !legacyFixture
        ? "native sessions require a saved Runtime & authentication binding"
        : !cwd
        ? purpose === "setup" ? "native setup sessions require a workspace root" : "native sessions require a current bound project"
        : workspaceUnavailable
          ? "native session workspace is unavailable"
          : producer && !producer.available
            ? "native session producer is incompatible"
            : !irPath || !(this.options.dispatch !== undefined || configuredIrPath(irPath)) || !legacyProducerAvailable()
            ? "native session materialization prerequisites are unavailable"
            : mcpReadiness && !mcpReadiness.available
              ? mcpReadiness.reason
              : undefined);
      const executable = dispatch?.provider === "claude" ? "claude" : "codex";
      const unavailable = reason ?? (!hostAvailable
        ? "native terminal host cannot spawn local processes on this machine"
        : dispatch && !executableAvailable(dispatch.provider)
          ? `the ${executable} interactive CLI is not available on this machine`
          : undefined);
      const vendorReadiness = {} as Record<NativeVendor, NativeVendorReadiness>;
      if (legacyFixture) for (const vendor of NATIVE_VENDORS) {
        const legacyExecutable = vendor === "claude" ? "claude" : "codex";
        vendorReadiness[vendor] = reason
          ? { available: false, reason }
          : !hostAvailable ? { available: false, reason: "native terminal host cannot spawn local processes on this machine" }
            : !executableAvailable(vendor) ? { available: false, reason: `the ${legacyExecutable} interactive CLI is not available on this machine` }
              : { available: true };
      }
      const legacyAvailable = legacyFixture ? Object.values(vendorReadiness).some((value) => value.available) : unavailable === undefined;
      result[purpose] = {
        scopeKind,
        profile: definition.profile,
        ...(dispatch ? { target: dispatch.target, targetLabel: dispatch.targetLabel } : {}),
        ...(producer ? { producer: producer.available ? { available: true } : { available: false, category: NATIVE_PRODUCER_CATEGORY } } : {}),
        available: legacyAvailable,
        ...(unavailable ? { reason: unavailable } : {}),
        vendors: vendorReadiness,
      };
    }
    if (legacyFixture) {
      const legacy = Object.fromEntries(Object.entries(result).map(([purpose, value]) => {
        const { profile: _profile, target: _target, targetLabel: _targetLabel, ...oldShape } = value;
        return [purpose, oldShape];
      }));
      return legacy as unknown as NativeSessionReadiness;
    }
    return {
      runtime,
      purposes: result,
      mcp: this.options.artifactService?.health() ?? {
        server: "GenBI MCP",
        tool: "save_dashboard",
        destination: "GenBI Artifacts",
        available: false,
        reason: "GenBI MCP is not configured",
      },
      ...result,
    };
  }

  async create(input: { purpose: NativePurpose; vendor?: NativeVendor }, binding = input.purpose === "setup" ? undefined : this.options.getBinding(), capturedRuntime = this.options.store.getNativeRuntimeBinding(), resumed?: { readonly row: NativeSessionRow; readonly handle: string }): Promise<NativeSessionLaunch> {
    this.assertRuntimeDispatchable();
    const purpose = input.purpose;
    const legacyRuntime = !capturedRuntime.configured && input.vendor
      ? { configured: true as const, generation: 0, provider: input.vendor, target: targetForProvider(input.vendor), targetLabel: nativeTargetLabel(input.vendor) }
      : capturedRuntime;
    const dispatchDefinition = dispatchForPurpose(purpose, legacyRuntime);
    if (!dispatchDefinition) throw new InteractiveLaunchError("native sessions require a saved Runtime & authentication binding");
    if (purpose !== "setup" && !binding) throw new InteractiveLaunchError("native session requires a current bound project");
    const configuredCwd = binding?.path ?? this.options.workspaceRoot;
    const configuredIr = this.options.irPaths[purpose];
    if (!configuredCwd || !configuredIr) throw new InteractiveLaunchError(`native ${dispatchDefinition.profile} session is not configured`);
    // Compile for this binding rather than dispatching the profile's golden.
    // Falls back to the configured path only where no resolver is wired (the
    // fixture-mode tests), never silently in production — see `bin.ts`.
    const irPath = this.options.resolveDispatchIr === undefined
      ? configuredIr
      : await this.options.resolveDispatchIr(purpose, binding);
    const producer = this.legacyFixtureMode() ? undefined : await this.productionProducerPreflight();
    if (producer && (!producer.available || !producer.producer)) throw new InteractiveLaunchError("native session producer is incompatible");
    if (producer?.producer) assertNativeProducerIdentity(producer.producer);
    const scopeId = resumed?.row.scopeId ?? newId("native-scope"); const id = resumed?.row.id ?? newId("native-session"); const capability = randomUUID();
    const recoveryCapability = purpose === "setup" ? randomUUID() : undefined;
    let providerLaunch: NativeProviderLaunch = resumed ? { kind: "resume", handle: resumed.handle } : undefined;
    let initialSealedHandle: string | undefined;
    if (!resumed && dispatchDefinition.provider === "claude") {
      const state = this.materializationState();
      if (!state) throw new InteractiveLaunchError("native session resume storage is unavailable");
      const sessionId = randomUUID();
      initialSealedHandle = sealNativeClaudeResumeHandle(state, id, sessionId);
      providerLaunch = { kind: "initial", sessionId };
    }
    const row = resumed?.row ?? this.options.store.createNativeSession({ id, purpose, vendor: dispatchDefinition.provider, agent: agentFor(purpose, dispatchDefinition.provider), scopeKind: dispatchDefinition.scopeKind, scopeId,
      dispatchProfile: dispatchDefinition.profile, dispatchTarget: dispatchDefinition.target, runtimeGeneration: legacyRuntime.generation,
      ...(binding ? { projectIdentity: binding.identity, bindingGeneration: binding.generation, projectRevision: binding.revision } : {}) });
    if (initialSealedHandle) this.options.store.saveNativeSessionResumeHandle(id, "claude", initialSealedHandle);
    if (recoveryCapability) {
      this.options.store.issueNativeSetupRecoveryAction(id, recoveryCapability);
      this.recoveryCapabilities.set(id, recoveryCapability);
    }
    const artifactService = this.options.artifactService;
    // Setup is bootstrap-scoped, but its accepted v4 recovery tool still uses
    // the same short-lived server-owned MCP transport. The tool allowlist,
    // not a producer-visible scope, decides which operation it can perform.
    let launchPhase: NativeLaunchPhase = "workspace";
    try {
      // The bootstrap workspace remains the authorized project-creation
      // context in the producer scope. Every purpose, including Setup, emits
      // its vendor-owned launch files into a distinct BFF-owned root so a new
      // scope/MCP digest never collides with a prior ownership marker.
      const authorizedWorkspace = purpose === "setup"
        ? configuredWorkspace(configuredCwd, true)
        : configuredWorkspace(configuredCwd, false);
      const materializationState = this.materializationState();
      if (!authorizedWorkspace || !materializationState) throw new InteractiveLaunchError("native session workspace is unavailable");
      const cwd = createNativeSessionWorkspace(materializationState, authorizedWorkspace, id);
      const producerAvailable = this.options.producerAvailable ?? (() => this.options.dispatch !== undefined || localExecutableAvailable(this.options.warbleBin));
      if (!(this.options.dispatch !== undefined || configuredIrPath(irPath)) || !producerAvailable()) throw new InteractiveLaunchError("native session materialization prerequisites are unavailable");
      const mcpReadiness = artifactService?.readiness();
      if (mcpReadiness && !mcpReadiness.available) throw new InteractiveLaunchError(mcpReadiness.reason ?? "native MCP URL is invalid");
      const mcp = artifactService?.issue(row, binding);
      if (mcp) this.artifactCredentials.set(id, mcp.credential);
      let wrenRuntime: NativeWrenRuntime | undefined;
      try {
        wrenRuntime = dispatchDefinition.provider === "codex" && !this.legacyFixtureMode() ? resolveNativeWrenRuntime(this.options.wrenShim) : undefined;
      } catch (error) {
        if (error instanceof NativeWrenRuntimeError) throw new InteractiveLaunchError("native Wren runtime is unavailable");
        throw error;
      }
      const scope: Record<string, unknown> = { version: "3", kind: row.scopeKind, scope_id: scopeId, cwd, entry: nativeEntryFor(purpose, dispatchDefinition.provider), ...(purpose === "setup" ? { bootstrap_root: authorizedWorkspace } : {}), ...(wrenRuntime ? { wren_runtime: wrenRuntime } : {}), ...(binding ? { binding: { project_identity: binding.identity, generation: String(binding.generation), revision: binding.revision } } : {}) };
      const dispatch = this.options.dispatch ?? dispatchNativeArtifacts;
      validateNativeSessionWorkspace(materializationState, authorizedWorkspace, cwd);
      launchPhase = "dispatch";
      await dispatch({ warbleBin: producer?.producer?.executable ?? this.options.warbleBin, ...(producer?.producer ? { producer: producer.producer } : {}), irPath, target: dispatchDefinition.target, cwd, purpose, scope, ...(mcp ? { mcp } : {}) });
      if (!input.vendor && !sameNativeRuntimeBinding(capturedRuntime, this.options.store.getNativeRuntimeBinding())) {
        this.options.store.transitionNativeSession(id, "stale", { failure: "native runtime binding changed before launch", ended: true });
        throw new InteractiveLaunchError("native session is stale because the runtime binding changed");
      }
      if (binding && !sameBinding(binding, this.options.getBinding())) {
        this.options.store.transitionNativeSession(id, "stale", { failure: "native session binding changed before launch", ended: true });
        throw new InteractiveLaunchError("native session is stale because the bound project changed");
      }
      launchPhase = "launch_spec";
      const spec = readNativeLaunchSpec(cwd, purpose, dispatchDefinition.provider, scopeId, binding, mcp, materializationState, authorizedWorkspace, providerLaunch);
      let codexWrenHome: CodexWrenHome | undefined;
      if (spec.version === "4" && dispatchDefinition.provider === "codex" && binding) {
        if (wrenRuntime) {
          launchPhase = "codex_wren_home";
          codexWrenHome = (this.options.prepareCodexWrenHome ?? ((input) => materializeCodexWrenHome(input.runtime, input.projectPath, input.cwd)))({
            runtime: wrenRuntime,
            projectPath: binding.path,
            cwd,
          });
        }
        launchPhase = "codex_project_read";
        grantCodexBoundProjectRead(cwd, binding.path, codexWrenHome?.dataRoots);
      }
      launchPhase = "terminal_manager";
      const terminalManager = await this.options.terminalManager();
      if (binding && !sameBinding(binding, this.options.getBinding())) {
        this.options.store.transitionNativeSession(id, "stale", { failure: "native session binding changed before PTY launch", ended: true });
        throw new InteractiveLaunchError("native session is stale because the bound project changed");
      }
      if (!input.vendor && !sameNativeRuntimeBinding(capturedRuntime, this.options.store.getNativeRuntimeBinding())) {
        this.options.store.transitionNativeSession(id, "stale", { failure: "native runtime binding changed before PTY launch", ended: true });
        throw new InteractiveLaunchError("native session is stale because the runtime binding changed");
      }
      validateNativeSessionWorkspace(materializationState, authorizedWorkspace, cwd);
      const terminalEnv: NodeJS.ProcessEnv = {
        ...process.env,
        ...(mcp ? { [NATIVE_MCP_CREDENTIAL_ENV_VAR]: mcp.credential } : {}),
        ...(binding ? { WREN_PROJECT_HOME: binding.path } : {}),
        ...(codexWrenHome ? { WREN_HOME: codexWrenHome.home } : {}),
      };
      // Never inherit a caller/operator value: only the launch spec's already
      // revalidated Setup root may reach the native TUI.
      delete terminalEnv[NATIVE_SETUP_BOOTSTRAP_ROOT_ENV_VAR];
      if (spec.bootstrap_root) terminalEnv[NATIVE_SETUP_BOOTSTRAP_ROOT_ENV_VAR] = spec.bootstrap_root;
      launchPhase = "codex_executable";
      const hostExecutable = dispatchDefinition.provider === "codex" && !this.legacyFixtureMode()
        ? this.pinnedCodexExecutable(true)
        : undefined;
      launchPhase = "terminal_start";
      const terminal = terminalManager.start(hostExecutable ? { ...spec, hostExecutable } : spec, { id, capability }, terminalEnv, NO_INTERACTIVE_TERMINAL_LEASES);
      this.sessions.set(id, terminal);
      // Mark running before registering a replaying exit listener. A PTY can
      // exit between start() and this registration; `onExit` immediately
      // replays that state and must win over this transition, never be
      // overwritten by a later unconditional running write.
      launchPhase = "running_transition";
      this.options.store.transitionNativeSession(id, "running", { started: true });
      terminal.onExit((exitCode) => {
        this.captureCodexResumeHandle(this.options.store.getNativeSession(id) ?? row);
        this.clearLease(id);
        this.sessions.delete(id);
        this.clearStartSeparateReplaysForSession(id);
        this.recoveryCapabilities.delete(id);
        artifactService?.revoke(this.artifactCredentials.get(id)); this.artifactCredentials.delete(id);
        const current = this.options.store.getNativeSession(id);
        if (current && (current.status === "running" || current.status === "detached")) this.options.store.transitionNativeSession(id, "exited", { exitCode, ended: true });
      });
      if (this.sessions.has(id)) this.armLease(id, "native session attachment timed out", NATIVE_SESSION_INITIAL_ATTACHMENT_GRACE_MS);
      return { row: this.options.store.getNativeSession(id)!, capability, ...(recoveryCapability ? { recoveryCapability } : {}) };
    } catch (error) {
      logNativeLaunchFailure(purpose, dispatchDefinition.provider, launchPhase, error);
      this.recoveryCapabilities.delete(id);
      artifactService?.revoke(this.artifactCredentials.get(id)); this.artifactCredentials.delete(id);
      const current = this.options.store.getNativeSession(id);
      const failure = nativeSessionLaunchFailure(error);
      if (current?.status === "creating" || (resumed && current?.status === "interrupted" && current.startedAt === null)) this.options.store.transitionNativeSession(id, "failed", { failure, ended: true });
      if (dispatchDefinition.provider === "claude" || resumed) this.options.store.invalidateNativeSessionResume(id);
      if (purpose === "setup") {
        // The failed row and its browser-held recovery capability are the only
        // recovery surface. No terminal/MCP credential or process detail is
        // retained after a failed initial launch.
        return { row: this.options.store.getNativeSession(id)!, ...(recoveryCapability ? { recoveryCapability } : {}) };
      }
      // The HTTP route maps every internal failure through the public
      // classifier. Keeping the original error here preserves server-side
      // callers' typed stale/materialization distinctions.
      throw error;
    }
  }

  attach(id: string, capability: string): InteractiveTerminalSession | undefined {
    const row = this.get(id);
    const runtime = this.options.store.getNativeRuntimeBinding();
    const binding = this.options.getBinding();
    const currentScope = row?.scopeKind === "bootstrap"
      ? row.projectIdentity === null && row.bindingGeneration === null && row.projectRevision === null
      : row !== undefined && binding !== undefined && row.projectIdentity === binding.identity && row.bindingGeneration === binding.generation && row.projectRevision === binding.revision;
    if (!row || (row.status !== "running" && row.status !== "detached") || !currentScope || !runtime.configured || row.dispatchTarget !== runtime.target || row.runtimeGeneration !== runtime.generation) return undefined;
    const terminal = this.sessions.get(id);
    if (!terminal || !terminal.claim(capability)) return undefined;
    this.clearLease(id);
    this.options.store.transitionNativeSession(id, "running");
    return terminal;
  }
  detach(id: string): void {
    this.sessions.get(id)?.detach();
    if (this.sessions.has(id)) {
      this.options.store.transitionNativeSession(id, "detached");
      this.armLease(id, "native session idle TTL expired", this.idleTtlMs);
    }
  }
  stop(id: string, capability: string): boolean {
    const terminal = this.sessions.get(id);
    if (!terminal || terminal.capability !== capability) return false;
    const row = this.options.store.getNativeSession(id);
    if (row) this.captureCodexResumeHandle(row);
    if (!this.options.store.stopNativeSessionAndRevokeRecoveryAction(id)) return false;
    this.revokeCapabilities([id]);
    return true;
  }

  private revokeCapabilities(ids: readonly string[]): void {
    for (const id of ids) {
      const terminal = this.sessions.get(id);
      this.clearLease(id);
      this.clearStartSeparateReplaysForSession(id);
      this.recoveryCapabilities.delete(id);
      this.options.artifactService?.revoke(this.artifactCredentials.get(id));
      this.artifactCredentials.delete(id);
      this.sessions.delete(id);
      try {
        terminal?.close();
      } catch {
        // A process kill may fail after the durable session fence committed.
        // Capabilities are already unreachable; continue revoking every id.
        console.warn("[native-sessions] terminal close failed during capability revocation");
      }
    }
  }

  /** Called after the store's atomic runtime switch fence has committed. */
  revokeRuntimeCapabilities(ids: readonly string[]): void { this.revokeCapabilities(ids); }

  /** Called after the store advances the bound-project generation. */
  revokeBindingCapabilities(ids: readonly string[]): void { this.revokeCapabilities(ids); }

  /**
   * Records only the producer's closed redacted report. Completion remains a
   * host decision supplied by the canonical-artifact validator at the route.
   */
  reportSetupRecovery(sessionId: string, value: unknown, completionValidated: boolean): NativeSetupRecoveryRow {
    const session = this.options.store.getNativeSession(sessionId);
    if (!session || session.purpose !== "setup" || (session.status !== "running" && session.status !== "detached")) throw new NativeSetupRecoveryError("native setup session is unavailable", 409);
    const report = parseNativeSetupRecoveryReport(value);
    const recovery = this.options.store.recordNativeSetupRecovery({
      sessionId,
      phase: report.phase,
      state: report.state,
      code: report.code,
      sequence: report.sequence,
      decision: report.state === "needs_decision" ? "continue_or_stop" : null,
      completionValidated: report.state === "reported_complete" && completionValidated,
    });
    if (!recovery) throw new NativeSetupRecoveryError("native setup recovery report is stale", 409);
    return recovery;
  }

  /**
   * Recovery never resumes a process-owned PTY. Once a terminal session has
   * ended/interrupted, a fenced action creates a fresh Setup session and its
   * new terminal/MCP/recovery capabilities. Live terminals must be handled in
   * their owning browser tab and are rejected here.
   */
  async actOnSetupRecovery(input: { id: string; capability: string; expectedVersion: number; action: "retry" | "continue" | "stop" }): Promise<NativeSessionLaunch | undefined> {
    const session = this.options.store.getNativeSession(input.id);
    const recovery = this.options.store.getNativeSetupRecovery(input.id);
    const recoveryVersion = recovery?.version ?? 0;
    if (session?.status === "stopped") throw new NativeSetupRecoveryError("native setup recovery action is unavailable", 409);
    const terminalGone = session?.status === "exited" || session?.status === "interrupted" || session?.status === "failed" || session?.status === "stale";
    const recoveryAllows = input.action === "retry"
      ? recovery?.state === "retryable_failure" || session?.status === "interrupted" || session?.status === "failed" || session?.status === "exited"
      : input.action === "continue"
        ? recovery?.state === "needs_input" || recovery?.state === "needs_decision"
        : recovery?.state === "needs_decision";
    if (!session || session.purpose !== "setup" || !terminalGone || recoveryVersion !== input.expectedVersion || !recoveryAllows || recovery?.completionValidated) throw new NativeSetupRecoveryError("native setup recovery action is unavailable", 409);
    if (!this.options.store.claimNativeSetupRecoveryAction(input.id, input.capability, input.expectedVersion)) throw new NativeSetupRecoveryError("native setup recovery action is unauthorized or stale", 409);
    try {
      if (input.action === "stop") {
        this.options.store.stopNativeSessionAndRevokeRecoveryAction(input.id);
        return undefined;
      }
      return await this.create({ purpose: "setup", ...(this.legacyFixtureMode() ? { vendor: session.vendor } : {}) });
    } catch (error) {
      this.options.store.releaseNativeSetupRecoveryAction(input.id);
      throw error;
    }
  }

  private clearLease(id: string): void {
    const timer = this.leaseTimers.get(id);
    if (timer) clearTimeout(timer);
    this.leaseTimers.delete(id);
  }

  private armLease(id: string, reason: string, timeoutMs: number): void {
    this.clearLease(id);
    this.leaseTimers.set(id, setTimeout(() => {
      const terminal = this.sessions.get(id);
      if (!terminal) {
        this.leaseTimers.delete(id);
        return;
      }
      this.options.store.transitionNativeSession(id, "stopped", { failure: reason, ended: true });
      this.revokeCapabilities([id]);
    }, timeoutMs));
  }
}
