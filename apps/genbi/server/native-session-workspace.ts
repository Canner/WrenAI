/**
 * BFF-owned native interactive materialization roots. Bound projects retain
 * their identity and remain Warble's authorization root, but vendor-owned
 * discovery files are emitted only under the BFF state directory. This keeps
 * user project files out of the producer's ownership plan.
 */
import { createHash } from "node:crypto";
import { accessSync, chmodSync, constants, lstatSync, mkdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { InteractiveTarget } from "./interactive-terminal.js";

export class InteractiveLaunchError extends Error {}

const NATIVE_NAMESPACE = "native";
const LEGACY_NAMESPACE = "legacy";
const MODE = 0o700;

export interface NativeSessionStateBase {
  /** Canonical BFF-owned state root, initialized from the configured DB path. */
  readonly root: string;
}

function unavailable(): never {
  throw new InteractiveLaunchError("native session workspace is unavailable");
}

function contained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function canonicalDirectory(directory: string, requirePrivateMode: boolean, requireWritable = true): string {
  try {
    const entry = lstatSync(directory);
    if (!entry.isDirectory() || entry.isSymbolicLink() || (requirePrivateMode && (entry.mode & 0o777) !== MODE)) unavailable();
    accessSync(directory, requireWritable ? constants.W_OK | constants.X_OK : constants.X_OK);
    const canonical = realpathSync(directory);
    const canonicalEntry = lstatSync(canonical);
    if (!canonicalEntry.isDirectory() || canonicalEntry.isSymbolicLink() || (requirePrivateMode && (canonicalEntry.mode & 0o777) !== MODE)) unavailable();
    accessSync(canonical, requireWritable ? constants.W_OK | constants.X_OK : constants.X_OK);
    return canonical;
  } catch (error) {
    if (error instanceof InteractiveLaunchError) throw error;
    return unavailable();
  }
}

function privateChild(parent: string, segment: string, create: boolean): string {
  const candidate = path.join(parent, segment);
  if (!contained(parent, candidate) || path.basename(candidate) !== segment) return unavailable();
  if (create) {
    try {
      mkdirSync(candidate, { mode: MODE });
      // mkdir honors umask; make the freshly-created component exact before
      // validating it. Existing components are never repaired silently.
      chmodSync(candidate, MODE);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") return unavailable();
    }
  }
  const canonical = canonicalDirectory(candidate, true);
  if (!contained(parent, canonical)) return unavailable();
  return canonical;
}

function exclusivePrivateChild(parent: string, segment: string): string {
  const candidate = path.join(parent, segment);
  if (!contained(parent, candidate) || path.basename(candidate) !== segment) return unavailable();
  try {
    mkdirSync(candidate, { mode: MODE });
    chmodSync(candidate, MODE);
  } catch {
    return unavailable();
  }
  return privateChild(parent, segment, false);
}

function verifyOutsideProject(stateRoot: string, projectRoot: string): void {
  const project = canonicalDirectory(projectRoot, false, false);
  if (contained(project, stateRoot)) unavailable();
}

/**
 * Initializes the only persistent materialization base for this BFF. The
 * fixed digest makes it stable per configured SQLite state path without
 * deriving any path from a browser-selected project.
 */
export function initializeNativeSessionStateBase(dbPath: string): NativeSessionStateBase {
  if (!dbPath || dbPath === ":memory:") return unavailable();
  const absoluteDbPath = path.resolve(dbPath);
  const parent = canonicalDirectory(path.dirname(absoluteDbPath), false);
  const digest = createHash("sha256").update(absoluteDbPath).digest("hex").slice(0, 24);
  const root = privateChild(parent, `.genbi-native-state-${digest}`, true);
  // Initialize both namespaces at startup so readiness can stay non-mutating.
  privateChild(root, NATIVE_NAMESPACE, true);
  privateChild(root, LEGACY_NAMESPACE, true);
  return { root };
}

/** Non-mutating validation used by readiness and every launch boundary. */
export function validateNativeSessionStateBase(state: NativeSessionStateBase): NativeSessionStateBase {
  const root = canonicalDirectory(state.root, true);
  privateChild(root, NATIVE_NAMESPACE, false);
  privateChild(root, LEGACY_NAMESPACE, false);
  return { root };
}

export function nativeSessionStateBaseAvailable(state: NativeSessionStateBase | undefined): boolean {
  if (!state) return false;
  try { validateNativeSessionStateBase(state); return true; } catch { return false; }
}

/**
 * Non-mutating readiness validation for a specific authorized project root.
 * This intentionally shares create-time's canonical containment check, so a
 * valid BFF state base nested below a project is still unavailable before a
 * session row or vendor artifact can be created.
 */
export function nativeSessionStateBaseAvailableForProject(state: NativeSessionStateBase | undefined, projectRoot: string): boolean {
  if (!state) return false;
  try {
    verifyOutsideProject(validateNativeSessionStateBase(state).root, projectRoot);
    return true;
  } catch {
    return false;
  }
}

/** Creates one atomic, private bound-session root outside the user project. */
export function createNativeSessionWorkspace(state: NativeSessionStateBase, projectRoot: string, sessionId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/.test(sessionId)) return unavailable();
  const root = validateNativeSessionStateBase(state).root;
  verifyOutsideProject(root, projectRoot);
  return exclusivePrivateChild(privateChild(root, NATIVE_NAMESPACE, false), sessionId);
}

/**
 * Revalidates a native root immediately before dispatch, spec parsing, or PTY
 * spawn. A same-UID actor can still replace a path after this last check and
 * therefore has equivalent local authority to the BFF; that post-check race
 * is outside this boundary's threat model. Symlink, mode, and containment
 * replacement at every checked boundary fail closed.
 */
export function validateNativeSessionWorkspace(state: NativeSessionStateBase, projectRoot: string, workspace: string): string {
  const root = validateNativeSessionStateBase(state).root;
  verifyOutsideProject(root, projectRoot);
  const native = privateChild(root, NATIVE_NAMESPACE, false);
  const canonical = canonicalDirectory(workspace, true);
  if (!contained(native, canonical) || canonical === native) return unavailable();
  return canonical;
}

/**
 * The compatibility terminal has no durable session ID. Its target is
 * server-bound, and it is materialized under the distinct legacy namespace.
 */
export function legacyInteractiveWorkspace(state: NativeSessionStateBase, projectRoot: string, target: InteractiveTarget): string {
  const root = validateNativeSessionStateBase(state).root;
  verifyOutsideProject(root, projectRoot);
  const targetRoot = target === "claude-code:interactive" ? "claude" : "codex";
  return privateChild(privateChild(root, LEGACY_NAMESPACE, false), targetRoot, true);
}

/** Revalidates the legacy root with the same post-check threat-model boundary. */
export function validateLegacyInteractiveWorkspace(state: NativeSessionStateBase, projectRoot: string, workspace: string): string {
  const root = validateNativeSessionStateBase(state).root;
  verifyOutsideProject(root, projectRoot);
  const legacy = privateChild(root, LEGACY_NAMESPACE, false);
  const canonical = canonicalDirectory(workspace, true);
  if (!contained(legacy, canonical) || canonical === legacy) return unavailable();
  return canonical;
}
