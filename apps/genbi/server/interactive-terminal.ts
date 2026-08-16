/**
 * Native interactive enrichment is intentionally a very small boundary:
 * Warble materializes a versioned launch file and the BFF validates it before
 * a PTY starts a vendor-owned TUI.  Nothing supplied by a browser becomes a
 * command, argument, cwd, prompt, or environment value.
 */
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawn as spawnProcess } from "node:child_process";
import type { EnrichmentBinding } from "./enrichment.js";
export { InteractiveLaunchError, legacyInteractiveWorkspace } from "./native-session-workspace.js";
import { InteractiveLaunchError, nativeSessionStateBaseAvailable, validateLegacyInteractiveWorkspace } from "./native-session-workspace.js";
import type { NativeSessionStateBase } from "./native-session-workspace.js";

export const INTERACTIVE_TARGETS = ["claude-code:interactive", "codex:interactive"] as const;
export type InteractiveTarget = (typeof INTERACTIVE_TARGETS)[number];
const EXECUTABLE: Record<InteractiveTarget, "claude" | "codex"> = {
  "claude-code:interactive": "claude",
  "codex:interactive": "codex",
};

export interface InteractiveLaunchSpec {
  readonly version: "1" | "2" | "3" | "4";
  readonly target: InteractiveTarget;
  readonly executable: "claude" | "codex";
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly artifact_root: string;
  readonly handoff_path: string;
  /** Present only for native Setup after the BFF revalidates its sealed root. */
  readonly bootstrap_root?: string;
}

export interface PtyProcess {
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void };
  write(data: string): void;
  resize(columns: number, rows: number): void;
  kill(): void;
}

export interface PtyFactory {
  spawn(file: "claude" | "codex", args: readonly string[], options: { cwd: string; cols: number; rows: number; env?: NodeJS.ProcessEnv }): PtyProcess;
}

/**
 * The embedded terminal is a color-capable product surface, not a reflection
 * of a browser or caller preference. Keep this at the server/PTTY boundary so
 * every native launch receives the same contract.
 *
 * `NO_COLOR` is deliberately removed. It is a useful convention for ordinary
 * command output, but honoring an inherited value here would make our
 * advertised xterm ANSI palette silently optional and allow a caller to
 * weaken the native-terminal contract.
 */
export function nativeTerminalEnvironment(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const { NO_COLOR: _noColor, ...inherited } = base;
  return { ...inherited, TERM: "xterm-256color", COLORTERM: "truecolor" };
}

/**
 * Mirrors the PATH lookup a shell-free PTY launch relies on. A shell alias or
 * function is deliberately not accepted: node-pty cannot execute either.
 */
export function interactiveExecutableAvailable(executable: "claude" | "codex", pathValue = process.env["PATH"]): boolean {
  if (!pathValue) return false;
  return pathValue.split(path.delimiter).some((directory) => {
    if (!directory) return false;
    try {
      const candidate = path.join(directory, executable);
      const stat = statSync(candidate);
      return stat.isFile() && (stat.mode & 0o111) !== 0;
    } catch {
      return false;
    }
  });
}

export interface InteractiveTerminalSession {
  readonly id: string;
  readonly capability: string;
  readonly target: InteractiveTarget;
  readonly handoffPath: string;
  readonly fallbackCommand: string;
  claim(capability: string): boolean;
  detach(): void;
  close(): void;
  write(data: string): void;
  resize(columns: number, rows: number): void;
  /**
   * Subscribe to terminal output. The optional callback is called exactly once
   * before this attachment's replay, and makes any retained-output truncation
   * explicit to transports that can surface it to their users.
   */
  onData(listener: (data: string) => void, onReplay?: (metadata: TerminalReplayMetadata) => void): () => void;
  onExit(listener: (exitCode: number) => void): () => void;
}

/** Public replay contract for a terminal attachment. */
export interface TerminalReplayMetadata {
  /** True when output older than the retained tail was omitted. */
  readonly truncated: boolean;
  /** UTF-8 bytes available in this attachment's retained replay. */
  readonly retainedBytes: number;
  /** Hard upper bound for the process-local retained tail. */
  readonly retentionLimitBytes: number;
}

/**
 * The legacy Context terminal owns a short local lease. Durable native
 * Sessions deliberately pass `NO_INTERACTIVE_TERMINAL_LEASES`: their service
 * owns both the initial-attachment and post-claim lifecycle transitions.
 */
export interface InteractiveTerminalLeasePolicy {
  readonly initialAttachmentTimeoutMs?: number;
  readonly postClaimDetachTimeoutMs?: number;
}

export const LEGACY_INTERACTIVE_TERMINAL_LEASES: InteractiveTerminalLeasePolicy = {
  initialAttachmentTimeoutMs: 15_000,
  postClaimDetachTimeoutMs: 15_000,
};

export const NO_INTERACTIVE_TERMINAL_LEASES: InteractiveTerminalLeasePolicy = {};
const TERMINAL_EXIT_RETENTION_MS = 15_000;
/**
 * Terminal output is process-local and deliberately bounded. Attachments get
 * only this UTF-8 tail; `TerminalReplayMetadata.truncated` says when the
 * beginning was omitted instead of silently presenting an incomplete log.
 */
export const TERMINAL_OUTPUT_RETENTION_LIMIT_BYTES = 64 * 1024;
export interface PreparedInteractiveHandoff { readonly target: InteractiveTarget; readonly fallbackCommand: string; }
export interface InteractiveTargetReadiness {
  readonly copyAvailable: boolean;
  readonly embeddedTerminalAvailable: boolean;
  readonly copyReason?: string;
  readonly embeddedTerminalReason?: string;
}

export function unavailableInteractiveReadiness(reason: string): Record<InteractiveTarget, InteractiveTargetReadiness> {
  return Object.fromEntries(INTERACTIVE_TARGETS.map((target) => [target, { copyAvailable: false, embeddedTerminalAvailable: false, copyReason: reason, embeddedTerminalReason: reason }])) as Record<InteractiveTarget, InteractiveTargetReadiness>;
}

/** Clipboard-only text. It is never passed to a shell or subprocess. */
export function launchFallbackCommand(spec: Pick<InteractiveLaunchSpec, "cwd" | "executable" | "argv">): string {
  const quote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;
  return `cd -- ${quote(spec.cwd)} && ${spec.executable}${spec.argv.map((arg) => ` ${quote(arg)}`).join("")}`;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function isTarget(value: unknown): value is InteractiveTarget {
  return typeof value === "string" && (INTERACTIVE_TARGETS as readonly string[]).includes(value);
}

function contained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Parse exactly the public v1 producer contract; unknown fields fail closed. */
export function readInteractiveLaunchSpec(boundProject: string, requestedTarget: InteractiveTarget, materializationRoot?: string, materializationState?: NativeSessionStateBase): InteractiveLaunchSpec {
  const canonicalProject = realpathSync(boundProject);
  const canonicalArtifactRoot = materializationRoot === undefined
    ? canonicalProject
    : materializationState === undefined
      ? realpathSync(materializationRoot)
      : validateLegacyInteractiveWorkspace(materializationState, canonicalProject, materializationRoot);
  if (materializationState === undefined && canonicalArtifactRoot !== canonicalProject) throw new InteractiveLaunchError("interactive enrichment launch paths are outside the bound project");
  const specPath = path.join(canonicalArtifactRoot, ".warble", "interactive-launch.json");
  if (!existsSync(specPath)) throw new InteractiveLaunchError("interactive enrichment artifacts are not available yet");
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(specPath, "utf8")); } catch { throw new InteractiveLaunchError("interactive enrichment launch specification is invalid"); }
  const value = record(raw);
  const expectedKeys = ["version", "target", "executable", "argv", "cwd", "artifact_root", "handoff_path"];
  if (!value || Object.keys(value).length !== expectedKeys.length || !expectedKeys.every((key) => Object.hasOwn(value, key))) {
    throw new InteractiveLaunchError("interactive enrichment launch specification is invalid");
  }
  if (value.version !== "1" || !isTarget(value.target) || value.target !== requestedTarget || value.executable !== EXECUTABLE[requestedTarget] || !Array.isArray(value.argv) || value.argv.length !== 0 || typeof value.cwd !== "string" || typeof value.artifact_root !== "string" || typeof value.handoff_path !== "string") {
    throw new InteractiveLaunchError("interactive enrichment launch specification is incompatible");
  }
  let cwd: string;
  let artifactRoot: string;
  let handoffPath: string;
  try {
    cwd = realpathSync(value.cwd);
    artifactRoot = realpathSync(value.artifact_root);
    handoffPath = realpathSync(value.handoff_path);
  } catch { throw new InteractiveLaunchError("interactive enrichment launch paths are unavailable"); }
  if (cwd !== canonicalArtifactRoot || artifactRoot !== canonicalArtifactRoot || !contained(artifactRoot, handoffPath)) {
    throw new InteractiveLaunchError("interactive enrichment launch paths are outside the bound project");
  }
  return { version: "1", target: requestedTarget, executable: EXECUTABLE[requestedTarget], argv: [], cwd, artifact_root: artifactRoot, handoff_path: handoffPath };
}

export async function dispatchInteractiveArtifacts(input: { readonly warbleBin: string; readonly irPath: string; readonly target: InteractiveTarget; readonly cwd: string; readonly boundProject?: string; readonly materializationState?: NativeSessionStateBase }): Promise<void> {
  // Structured hardcoded argv only. In particular, never append browser or
  // proposal text to this invocation and never use a shell.
  if ((input.boundProject === undefined) !== (input.materializationState === undefined)) throw new InteractiveLaunchError("interactive enrichment materialization failed");
  if (input.boundProject && input.materializationState) validateLegacyInteractiveWorkspace(input.materializationState, input.boundProject, input.cwd);
  await new Promise<void>((resolve, reject) => {
    const child = spawnProcess(input.warbleBin, ["dispatch", input.irPath, "--target", input.target, "--out", input.cwd], { cwd: input.cwd, shell: false, stdio: "ignore" });
    child.once("error", () => reject(new InteractiveLaunchError("interactive enrichment materialization failed")));
    child.once("exit", (code) => code === 0 ? resolve() : reject(new InteractiveLaunchError("interactive enrichment materialization failed")));
  });
}

export interface InteractivePreparationInput {
  readonly target: InteractiveTarget;
  readonly binding: EnrichmentBinding;
  /** A BFF-owned external root, never browser-supplied. */
  readonly artifactRoot?: string;
  /** Required whenever artifactRoot is external to the bound project. */
  readonly materializationState?: NativeSessionStateBase;
  readonly materialize: () => Promise<void>;
}

export interface InteractivePreparationDeps {
  readonly getCurrentBinding: () => EnrichmentBinding | undefined;
  readonly executableAvailable?: (executable: "claude" | "codex") => boolean;
}

/**
 * Materializes and validates the clipboard/launch contract without loading a
 * PTY implementation or creating a process. This is deliberately shared by
 * copy and embedded-terminal paths so their binding fence cannot drift.
 */
export async function prepareInteractiveHandoff(input: InteractivePreparationInput, deps: InteractivePreparationDeps): Promise<{ readonly spec: InteractiveLaunchSpec; readonly handoff: PreparedInteractiveHandoff }> {
  const executableAvailable = deps.executableAvailable ?? interactiveExecutableAvailable;
  if (!executableAvailable(EXECUTABLE[input.target])) {
    throw new InteractiveLaunchError(`the ${EXECUTABLE[input.target]} interactive CLI is not available on this machine`);
  }
  await input.materialize();
  const current = deps.getCurrentBinding();
  if (!current || current.path !== input.binding.path || current.identity !== input.binding.identity || current.generation !== input.binding.generation || current.revision !== input.binding.revision) {
    throw new InteractiveLaunchError("interactive enrichment is stale because the bound project changed");
  }
  const spec = readInteractiveLaunchSpec(input.binding.path, input.target, input.artifactRoot, input.materializationState);
  return { spec, handoff: { target: spec.target, fallbackCommand: launchFallbackCommand(spec) } };
}

/**
 * Evaluates copy and optional embedded-host capability separately per target.
 *
 * This must stay a pure probe: the producer owns a shared output root and can
 * materialize only one target there at a time.  Reading Context must never
 * create, replace, or inspect target artifacts, because doing so would make
 * one target's availability depend on whichever target readiness happened to
 * probe first.  Artifact materialization remains exclusively in the selected
 * Copy or embedded Launch action via `prepareInteractiveHandoff`.
 */
export async function getInteractiveTerminalReadiness(input: {
  readonly getCurrentBinding: () => EnrichmentBinding | undefined;
  readonly terminalHostAvailable: () => Promise<boolean>;
  readonly executableAvailable?: (executable: "claude" | "codex") => boolean;
  /** BFF-owned base; validation is non-mutating and never reads the project root. */
  readonly materializationState?: NativeSessionStateBase;
}): Promise<Record<InteractiveTarget, InteractiveTargetReadiness>> {
  const binding = input.getCurrentBinding();
  if (!binding) return unavailableInteractiveReadiness("interactive enrichment requires a current bound project");
  if (input.materializationState && !nativeSessionStateBaseAvailable(input.materializationState)) return unavailableInteractiveReadiness("interactive enrichment workspace is unavailable");
  const hostAvailable = await input.terminalHostAvailable();
  const executableAvailable = input.executableAvailable ?? interactiveExecutableAvailable;
  const result = {} as Record<InteractiveTarget, InteractiveTargetReadiness>;
  for (const target of INTERACTIVE_TARGETS) {
    if (!executableAvailable(EXECUTABLE[target])) {
      const reason = `the ${EXECUTABLE[target]} interactive CLI is not available on this machine`;
      result[target] = { copyAvailable: false, embeddedTerminalAvailable: false, copyReason: reason, embeddedTerminalReason: reason };
      continue;
    }
    result[target] = hostAvailable
      ? { copyAvailable: true, embeddedTerminalAvailable: true }
      : { copyAvailable: true, embeddedTerminalAvailable: false, embeddedTerminalReason: "interactive terminal host cannot spawn local processes on this machine" };
  }
  return result;
}

export class InteractiveTerminalManager {
  private readonly sessions = new Map<string, InteractiveTerminalSession>();
  constructor(private readonly pty: PtyFactory) {}

  start(
    spec: InteractiveLaunchSpec,
    identity?: { readonly id: string; readonly capability: string },
    env?: NodeJS.ProcessEnv,
    leasePolicy: InteractiveTerminalLeasePolicy = LEGACY_INTERACTIVE_TERMINAL_LEASES,
  ): InteractiveTerminalSession {
    const process = this.pty.spawn(spec.executable, spec.argv, {
      cwd: spec.cwd,
      cols: 100,
      rows: 30,
      env: nativeTerminalEnvironment(env),
    });
    const dataListeners = new Set<(data: string) => void>();
    const exitListeners = new Set<(exitCode: number) => void>();
    const id = identity?.id ?? randomUUID();
    const capability = identity?.capability ?? randomUUID();
    let claimed = false;
    let exited: number | undefined;
    let buffer = "";
    let outputTruncated = false;
    let leaseTimer: ReturnType<typeof setTimeout> | undefined;
    const clearLease = () => {
      if (leaseTimer) clearTimeout(leaseTimer);
      leaseTimer = undefined;
    };
    const close = () => {
      clearLease();
      try {
        if (exited === undefined) process.kill();
      } finally {
        this.sessions.delete(id);
      }
    };
    const armLease = (timeoutMs: number | undefined) => {
      clearLease();
      if (timeoutMs !== undefined) leaseTimer = setTimeout(close, timeoutMs);
    };
    const session: InteractiveTerminalSession = {
      id, capability, target: spec.target, handoffPath: spec.handoff_path, fallbackCommand: launchFallbackCommand(spec),
      claim: (presented) => {
        if (presented !== capability || claimed) return false;
        claimed = true;
        clearLease();
        return true;
      },
      detach: () => {
        if (!claimed || exited !== undefined) return;
        claimed = false;
        armLease(leasePolicy.postClaimDetachTimeoutMs);
      },
      close,
      write: (data) => process.write(data),
      resize: (columns, rows) => process.resize(columns, rows),
      onData: (listener) => { dataListeners.add(listener); return () => dataListeners.delete(listener); },
      onExit: (listener) => { exitListeners.add(listener); return () => exitListeners.delete(listener); },
    };
    process.onData((data) => {
      const next = `${buffer}${data}`;
      const retained = retainTerminalOutput(next);
      if (retained.length !== next.length) outputTruncated = true;
      buffer = retained;
      dataListeners.forEach((listener) => listener(data));
    });
    process.onExit(({ exitCode }) => { exited = exitCode; exitListeners.forEach((listener) => listener(exitCode)); clearLease(); setTimeout(() => this.sessions.delete(id), TERMINAL_EXIT_RETENTION_MS); });
    this.sessions.set(session.id, session);
    // A legacy PTY must not survive if the browser never completes its WS
    // upgrade. Native Sessions opt out: their durable service records the
    // timeout state and revokes browser/MCP/recovery capabilities atomically.
    armLease(leasePolicy.initialAttachmentTimeoutMs);
    // An attachment receives one replay followed by live data. Register its
    // live listener before invoking either callback, then queue any
    // synchronous re-entrant data until the replay has completed. This closes
    // the snapshot/listener gap without duplicating output on reconnect.
    const originalOnData = session.onData;
    const originalOnExit = session.onExit;
    session.onData = (listener, onReplay) => {
      const replay = buffer;
      const metadata: TerminalReplayMetadata = {
        truncated: outputTruncated,
        retainedBytes: Buffer.byteLength(replay, "utf8"),
        retentionLimitBytes: TERMINAL_OUTPUT_RETENTION_LIMIT_BYTES,
      };
      const queued: string[] = [];
      let nextQueued = 0;
      let replaying = true;
      const remove = originalOnData((data) => {
        if (replaying) queued.push(data);
        else listener(data);
      });
      try {
        onReplay?.(metadata);
        if (replay) listener(replay);
        // Keep replay mode active until the queue is empty. A transport
        // callback can synchronously cause more PTY output; index-based
        // draining consumes those additions after the already queued bytes.
        while (nextQueued < queued.length) listener(queued[nextQueued++]!);
      } finally {
        replaying = false;
        queued.length = 0;
      }
      return remove;
    };
    session.onExit = (listener) => { if (exited !== undefined) listener(exited); return originalOnExit(listener); };
    return session;
  }

  get(id: string): InteractiveTerminalSession | undefined { return this.sessions.get(id); }

  /** Runtime changes revoke every non-durable compatibility terminal immediately. */
  closeAll(): void {
    for (const session of [...this.sessions.values()]) session.close();
  }
}

/** Retain a UTF-8-safe tail without splitting a Unicode code point. */
function retainTerminalOutput(value: string): string {
  if (Buffer.byteLength(value, "utf8") <= TERMINAL_OUTPUT_RETENTION_LIMIT_BYTES) return value;
  let retainedBytes = 0;
  let start = value.length;
  while (start > 0) {
    let next = start - 1;
    const code = value.charCodeAt(next);
    if (code >= 0xdc00 && code <= 0xdfff && next > 0) {
      const previous = value.charCodeAt(next - 1);
      if (previous >= 0xd800 && previous <= 0xdbff) next -= 1;
    }
    const bytes = Buffer.byteLength(value.slice(next, start), "utf8");
    if (retainedBytes + bytes > TERMINAL_OUTPUT_RETENTION_LIMIT_BYTES) break;
    retainedBytes += bytes;
    start = next;
  }
  return value.slice(start);
}
