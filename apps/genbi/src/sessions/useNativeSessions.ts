import { create } from 'zustand';
import { createNativeSession, getNativeSession, getNativeSessionReadiness, isNativeSessionLaunchActionStale, listNativeSessions, postNativeSetupRecoveryAction, type NativeSession, type NativeSessionPurpose, type NativeSessionReadiness } from '@/bff/client';
import { clearNativeSessionCapability, clearNativeSetupRecoveryCapability, nativeSessionReturnSource, saveNativeSessionCapability, saveNativeSessionReturnSource, saveNativeSetupRecoveryCapability, type NativeSessionReturnSource } from './capability';
import { createNativeSessionLaunchId } from './launchId';

interface NativeSessionsState {
  sessions: NativeSession[];
  loading: boolean;
  error?: string;
  readiness?: NativeSessionReadiness;
  readinessLoading: boolean;
  readinessError?: string;
  load: () => Promise<void>;
  refreshReadiness: () => Promise<NativeSessionReadiness | undefined>;
  refresh: (id: string) => Promise<NativeSession | undefined>;
  createSession: (purpose: NativeSessionPurpose, returnSource: NativeSessionReturnSource | undefined, actionOwner: NativeSessionCreateOwner) => Promise<NativeSession>;
  openSession: (purpose: NativeSessionPurpose, id: string, returnSource?: NativeSessionReturnSource) => Promise<NativeSession>;
  resumeSession: (source: NativeSession, returnSource?: NativeSessionReturnSource, signal?: AbortSignal) => Promise<NativeSession>;
  restartSession: (source: NativeSession, returnSource?: NativeSessionReturnSource, signal?: AbortSignal) => Promise<NativeSession>;
  actOnSetupRecovery: (id: string, capability: string, expectedVersion: number, action: 'retry' | 'continue' | 'stop') => Promise<NativeSession | undefined>;
  replace: (session: NativeSession) => void;
}

let readinessRequestGeneration = 0;
let sessionsRequestGeneration = 0;

/**
 * A response can be lost after the BFF has already created a replacement PTY.
 * Keep that click's UUID only in this browser process so the retry reaches the
 * BFF's existing start-separate replay instead of creating a second terminal.
 *
 * The source row's durable identity and authorization scope fence the key. No
 * browser capability, MCP credential, transcript, or provider handle belongs
 * here, and the registry intentionally disappears on a browser reload.
 */
interface RestartAction {
  readonly scope: string;
  readonly idempotencyKey: string;
}

const restartActions = new Map<string, RestartAction>();
const resumeActions = new Map<string, RestartAction>();
const refreshes = new Map<string, Promise<NativeSession | undefined>>();

function terminalAttachable(session: NativeSession): boolean {
  return session.status === 'creating' || session.status === 'running' || session.status === 'detached';
}

/** A stale browser capability must never keep offering a dead PTY. */
function reconcileTerminalCapability(session: NativeSession): void {
  if (!terminalAttachable(session)) clearNativeSessionCapability(session.id);
}

/**
 * Creating a new session has no durable source row to key against, but it has
 * the same response-loss risk as a restart. Keep one action per caller-owned
 * surface and purpose while it is in flight (and after an ambiguous failure)
 * so double-clicks and a retry cannot create a second PTY. A successful
 * delivery clears it, making a later intentional start a new action.
 */
interface CreateAction {
  readonly idempotencyKey: string;
  request?: Promise<NativeSession>;
}

/** A caller-owned key distinguishes intentional starts from different surfaces. */
export type NativeSessionCreateOwner = 'sessions-new' | NativeSessionReturnSource;

const createActions = new Map<string, CreateAction>();

function createActionKey(purpose: NativeSessionPurpose, owner: NativeSessionCreateOwner): string {
  return `${owner}:${purpose}`;
}

function createActionFor(key: string): CreateAction {
  const existing = createActions.get(key);
  if (existing) return existing;
  const action = { idempotencyKey: createNativeSessionLaunchId() };
  createActions.set(key, action);
  return action;
}

function clearCreateAction(key: string, action?: CreateAction): void {
  const current = createActions.get(key);
  if (current && (!action || current === action)) createActions.delete(key);
}

function restartActionScope(session: NativeSession): string {
  return JSON.stringify([
    session.purpose,
    session.vendor,
    session.scopeKind,
    session.scopeId,
    session.projectIdentity,
    session.bindingGeneration,
    session.projectRevision,
    session.runtimeGeneration ?? null,
  ]);
}

function restartActionFor(session: NativeSession): RestartAction {
  const scope = restartActionScope(session);
  const existing = restartActions.get(session.id);
  if (existing?.scope === scope) return existing;
  const action = { scope, idempotencyKey: createNativeSessionLaunchId() };
  restartActions.set(session.id, action);
  return action;
}

function clearRestartAction(session: NativeSession, action?: RestartAction): void {
  const current = restartActions.get(session.id);
  if (current && (!action || current === action)) restartActions.delete(session.id);
}

function resumeActionFor(session: NativeSession): RestartAction {
  const scope = restartActionScope(session);
  const existing = resumeActions.get(session.id);
  if (existing?.scope === scope) return existing;
  const action = { scope, idempotencyKey: createNativeSessionLaunchId() };
  resumeActions.set(session.id, action);
  return action;
}

function clearResumeAction(session: NativeSession, action?: RestartAction): void {
  const current = resumeActions.get(session.id);
  if (current && (!action || current === action)) resumeActions.delete(session.id);
}

function reconcileRestartActions(sessions: readonly NativeSession[]): void {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  for (const [id, action] of restartActions) {
    const session = byId.get(id);
    if (!session || action.scope !== restartActionScope(session)) restartActions.delete(id);
  }
  for (const [id, action] of resumeActions) {
    const session = byId.get(id);
    if (!session || action.scope !== restartActionScope(session)) resumeActions.delete(id);
  }
}

function ordered(items: NativeSession[]): NativeSession[] {
  return [...items].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export const useNativeSessions = create<NativeSessionsState>((set, get) => ({
  sessions: [],
  loading: false,
  readinessLoading: false,
  async load() {
    const requestGeneration = ++sessionsRequestGeneration;
    set({ loading: true, error: undefined });
    try {
      const { sessions } = await listNativeSessions();
      // The sidebar's initial load and the New Session popover refresh can
      // overlap.  Only the newest authoritative list may replace the current
      // session projection; an older detached snapshot must not restore an
      // expired "Open existing" choice after the popover has removed it.
      if (requestGeneration !== sessionsRequestGeneration) return;
      reconcileRestartActions(sessions);
      sessions.forEach(reconcileTerminalCapability);
      set({ sessions: ordered(sessions), loading: false });
    } catch (error) {
      if (requestGeneration !== sessionsRequestGeneration) return;
      set({ loading: false, error: error instanceof Error ? error.message : 'Sessions are unavailable.' });
    }
  },
  refresh(id) {
    const pending = refreshes.get(id);
    if (pending) return pending;
    let request!: Promise<NativeSession | undefined>;
    request = getNativeSession(id)
      .then(({ session }) => {
        reconcileTerminalCapability(session);
        get().replace(session);
        return session;
      })
      .catch(() => undefined)
      .finally(() => { if (refreshes.get(id) === request) refreshes.delete(id); });
    refreshes.set(id, request);
    return request;
  },
  async refreshReadiness() {
    const requestGeneration = ++readinessRequestGeneration;
    // A previous binding must never remain launchable while a replacement
    // Runtime snapshot is in flight or cannot be read.
    set({ readiness: undefined, readinessLoading: true, readinessError: undefined });
    try {
      const readiness = await getNativeSessionReadiness();
      if (requestGeneration !== readinessRequestGeneration) return get().readiness;
      const currentGeneration = get().readiness?.runtime?.generation;
      const nextGeneration = readiness.runtime?.generation;
      if (currentGeneration !== undefined && nextGeneration !== undefined && nextGeneration < currentGeneration) {
        set({ readinessLoading: false });
        return get().readiness;
      }
      set({ readiness, readinessLoading: false, readinessError: undefined });
      return readiness;
    } catch (error) {
      if (requestGeneration !== readinessRequestGeneration) return get().readiness;
      set({ readiness: undefined, readinessLoading: false, readinessError: error instanceof Error ? error.message : 'Native terminal hosting is unavailable.' });
      return undefined;
    }
  },
  createSession(purpose, returnSource, actionOwner) {
    const actionKey = createActionKey(purpose, actionOwner);
    const action = createActionFor(actionKey);
    if (action.request) return action.request;
    const request = createNativeSession(purpose, { intent: 'start_separate', idempotencyKey: action.idempotencyKey })
      .then(({ session, capability, recoveryCapability }) => {
        clearCreateAction(actionKey, action);
        if (capability) saveNativeSessionCapability(session.id, capability);
        if (recoveryCapability) saveNativeSetupRecoveryCapability(session.id, recoveryCapability);
        if (returnSource) saveNativeSessionReturnSource(session.id, returnSource);
        get().replace(session);
        return session;
      })
      .catch((error: unknown) => {
        // A typed stale fence proves this retained action belongs to a prior
        // Runtime/binding scope. Any other error may be a lost response, so
        // keep the UUID for a deliberate retry at the BFF replay boundary.
        if (isNativeSessionLaunchActionStale(error)) clearCreateAction(actionKey, action);
        throw error;
      })
      .finally(() => {
        if (createActions.get(actionKey) === action) action.request = undefined;
      });
    action.request = request;
    return request;
  },
  async openSession(purpose, id, returnSource) {
    try {
      const { session, capability, recoveryCapability } = await createNativeSession(purpose, { intent: 'open_existing', sessionId: id });
      if (capability) saveNativeSessionCapability(session.id, capability);
      if (recoveryCapability) saveNativeSetupRecoveryCapability(session.id, recoveryCapability);
      if (returnSource) saveNativeSessionReturnSource(session.id, returnSource);
      get().replace(session);
      return session;
    } catch (error) {
      // The selected row may have expired since the last sidebar list.  One
      // authoritative read removes its stale launch affordance; never retry a
      // failed open automatically.
      void get().refresh(id);
      throw error;
    }
  },
  async restartSession(source, returnSource, signal) {
    // A restart intentionally goes through the isolated start-separate path.
    // It never sends an old browser capability, transcript, or alleged vendor
    // resume handle back to the BFF. Retaining just this action UUID makes an
    // ambiguous response-loss retry idempotent at the BFF process seam.
    const action = restartActionFor(source);
    try {
      const launch = { intent: 'start_separate' as const, idempotencyKey: action.idempotencyKey };
      const { session, capability, recoveryCapability } = signal
        ? await createNativeSession(source.purpose, launch, signal)
        : await createNativeSession(source.purpose, launch);
      clearRestartAction(source, action);
      if (capability) saveNativeSessionCapability(session.id, capability);
      if (recoveryCapability) saveNativeSetupRecoveryCapability(session.id, recoveryCapability);
      if (returnSource) saveNativeSessionReturnSource(session.id, returnSource);
      get().replace(session);
      return session;
    } catch (error) {
      // A typed stale fence proves this UUID belongs to a prior Runtime/binding
      // scope. Clear it for the next explicit click; never auto-retry, because
      // that could launch a duplicate after an ambiguous response loss.
      if (isNativeSessionLaunchActionStale(error)) clearRestartAction(source, action);
      // Keep the key on any failure, including AbortError: the BFF might have
      // completed after the browser gave up waiting, and a retry must replay it.
      throw error;
    }
  },
  async resumeSession(source, returnSource, signal) {
    // The browser owns only an idempotency UUID. The BFF resolves the sealed
    // provider handle and refuses any provider/session value from this client.
    const action = resumeActionFor(source);
    try {
      const launch = { intent: 'resume' as const, sessionId: source.id, idempotencyKey: action.idempotencyKey };
      const { session, capability, recoveryCapability } = signal
        ? await createNativeSession(source.purpose, launch, signal)
        : await createNativeSession(source.purpose, launch);
      clearResumeAction(source, action);
      if (capability) saveNativeSessionCapability(session.id, capability);
      if (recoveryCapability) saveNativeSetupRecoveryCapability(session.id, recoveryCapability);
      if (returnSource) saveNativeSessionReturnSource(session.id, returnSource);
      get().replace(session);
      return session;
    } catch (error) {
      if (isNativeSessionLaunchActionStale(error)) clearResumeAction(source, action);
      // A failed-closed/corrupt capsule is reflected by one authoritative
      // read, which leaves the UI offering only Restart when appropriate.
      void get().refresh(source.id);
      throw error;
    }
  },
  async actOnSetupRecovery(id, capability, expectedVersion, action) {
    const returnSource = nativeSessionReturnSource(id);
    const result = await postNativeSetupRecoveryAction(id, capability, expectedVersion, action);
    clearNativeSetupRecoveryCapability(id);
    if (!result) {
      clearNativeSessionCapability(id);
      await get().refresh(id);
      return undefined;
    }
    clearNativeSessionCapability(id);
    if (result.capability) saveNativeSessionCapability(result.session.id, result.capability);
    if (result.recoveryCapability) saveNativeSetupRecoveryCapability(result.session.id, result.recoveryCapability);
    if (returnSource) saveNativeSessionReturnSource(result.session.id, returnSource);
    get().replace(result.session);
    return result.session;
  },
  replace(session) {
    reconcileTerminalCapability(session);
    const action = restartActions.get(session.id);
    if (action && action.scope !== restartActionScope(session)) clearRestartAction(session, action);
    const resumeAction = resumeActions.get(session.id);
    if (resumeAction && resumeAction.scope !== restartActionScope(session)) clearResumeAction(session, resumeAction);
    set((state) => ({ sessions: ordered([session, ...state.sessions.filter((item) => item.id !== session.id)]) }));
  },
}));
