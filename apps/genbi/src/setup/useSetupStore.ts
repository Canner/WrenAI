import { create } from 'zustand';
import { isBffEnabled } from '@/bff/env';
import {
  getAdapterEnvStatus,
  getContextOverview,
  getSubscriptionModelCatalog,
  getRuntimeSettings,
  getRuntimeSettingsReadiness,
  getRuntimeTierNames,
  getSubscriptionLoginStatus,
  getSetupEnvFields,
  getSetupMode,
  getSetupRecovery,
  getSetupSourceCatalog,
  getSetupSteps,
  postSetupAdopt,
  postSetupCompileBind,
  postSetupConnectTurn,
  postSetupContextTurn,
  postSetupDecision,
  postSetupEnvValues,
  postSetupMode,
  postSetupReset,
  postSetupResume,
  putRuntimeSettings,
  SetupDecisionRequiredError,
} from '@/bff/client';
import type { SetupDecision, SetupEnvField, SetupMode, SetupSourceCatalogSource, SetupStatusEvent } from '@/bff/client';
import { setupStream } from '@/session/stream';
import type { SetupStreamHandlers, Unsubscribe } from '@/session/stream';
import type { ToolStep } from '@/session/types';
import { useNativeSessions } from '@/sessions/useNativeSessions';
import {
  fixtureContextSummary,
  fixtureInitialMessage,
  fixtureRuntimeSettings,
  fixtureSetupSteps,
} from './fixtures';
import type {
  AdapterEnvStatus,
  ContextSummary,
  ConversationMessage,
  NativeRuntimeBinding,
  RuntimeSettings,
  SetupFailureRecovery,
  SubscriptionModelCatalog,
  SubscriptionLoginStatus,
  SubscriptionProvider,
  SetupStep,
  StepKey,
} from './types';
import { t } from '@/i18n/strings';

let messageSeq = 1;
let catalogRequestSeq = 0;
function nextMessageId(): string {
  return `m${messageSeq++}`;
}

/** Marks `doneKey` done and `nextKey` current; every other step is unchanged. */
function advance(steps: SetupStep[], doneKey: StepKey, nextKey: StepKey): SetupStep[] {
  return steps.map((step) => {
    if (step.key === doneKey) return { ...step, state: 'done' };
    if (step.key === nextKey) return { ...step, state: 'current' };
    return step;
  });
}

/**
 * The step key immediately following `key` in `steps`, per the sequence the
 * BFF laid out for the active setup mode (e.g. 'adopt' after 'runtime' in
 * adopt mode, 'connect' after 'runtime' in create mode). Falls back to `key`
 * itself if it's last or not found, so callers never advance past the end.
 */
function stepAfter(steps: SetupStep[], key: StepKey): StepKey {
  const index = steps.findIndex((step) => step.key === key);
  if (index === -1 || index === steps.length - 1) return key;
  return steps[index + 1].key;
}

/**
 * Coerces any step still `'running'` in a terminal WorkLog snapshot to a
 * finished state. A turn's terminal event means nothing further will ever
 * update this trace — the live stream is done — so a step frozen at
 * `'running'` isn't real in-flight state, it's just the snapshot having been
 * captured mid-step (e.g. the terminal event arriving before that step's own
 * closing `worklog` frame). Persisted transcript copies of the trace must not
 * carry that forward, or they display "(running)" forever. `'ok'` finishes
 * the trailing step as `'done'`; every other outcome (error, needs_input,
 * needs_decision) finishes it as `'error'`, since the turn did not run to a
 * clean completion.
 */
function finalizeWorkLog(steps: ToolStep[], outcome: 'ok' | 'error'): ToolStep[] {
  if (!steps.some((step) => step.state === 'running')) return steps;
  const finishedState: ToolStep['state'] = outcome === 'ok' ? 'done' : 'error';
  return steps.map((step) => (step.state === 'running' ? { ...step, state: finishedState } : step));
}

/**
 * Streaming state for the connect step's live agentic turn (`connectDataSource`
 * / `resumeConnect`). Step-completion is gated on this stream's terminal, not
 * the click that started it — see the store actions below.
 */
export interface ConnectStreamState {
  /** Full WorkLog snapshot for the in-flight (or last) connect turn. */
  workLog: ToolStep[];
  streaming: boolean;
  /** Set when the stream broke (an `error` frame, or the initial POST failing). */
  error?: string;
  /** Safe retry data — raw diagnostics never become primary card copy. */
  failure?: SetupFailureRecovery;
  /** The turn's terminal `SetupStatusEvent`, once one arrives. */
  terminal?: SetupStatusEvent;
  /** `true` from a `needs_input` terminal until `resumeConnect` reaches `ok`. */
  needsInput: boolean;
  /** The data source type of the in-flight/last attempt — `resumeConnect` reuses it. */
  sourceType?: string;
  /** Preserved form value so a failure panel can identify the project before reload. */
  projectName?: string;
  /**
   * The setup session this stream belongs to — needed by `resolveConnectDecision`
   * to POST `/api/setup/decision`. Populated from every turn-creating response
   * (`postSetupConnectTurn`/`postSetupResume`) as well as from a
   * `SetupDecisionRequiredError` (the 409 `name_conflict` case, which has no
   * turn at all).
   */
  sessionId?: string;
  /**
   * A pending checkpoint this stream is blocked on — `name_conflict`, arriving
   * as a 409 from `postSetupConnectTurn` before any turn starts (see
   * `connectDataSource`'s catch). `undefined` once resolved via
   * `resolveConnectDecision`.
   */
  decision?: SetupDecision;
  /**
   * The scaffolded `.env` template's field KEYS (never values) once fetched
   * for the in-UI credential form — see `fetchConnectEnvFields`. `undefined`
   * until fetched (or fetch fails); the card falls back to the plain
   * "I've filled .env — continue" affordance when this is empty/undefined.
   */
  envFields?: SetupEnvField[];
  /** Set when `fetchConnectEnvFields` fails — the card shows a fallback, not a hard error. */
  envFieldsError?: string;
  /** True while `fetchConnectEnvFields`' GET is in flight — the card shows a spinner rather than flashing the fallback affordance before the real fields land. */
  envFieldsLoading: boolean;
  /** True while `submitConnectEnv`'s POST is in flight, before `resumeConnect` fires. */
  submittingEnv: boolean;
  /**
   * Closes the in-flight turn's `EventSource`. Captured from `setupStream`'s
   * return so a new `connectDataSource`/`resumeConnect` call can tear down a
   * still-open prior turn before opening its own — otherwise both turns'
   * handler closures write into this same slot and a late frame from the
   * abandoned turn can stomp the live one.
   */
  activeUnsubscribe?: Unsubscribe;
}

const initialConnectStream: ConnectStreamState = {
  workLog: [],
  streaming: false,
  needsInput: false,
  envFieldsLoading: false,
  submittingEnv: false,
};

/**
 * Streaming state for the context step's live agentic turn (`buildContext`).
 * Mirrors `ConnectStreamState` exactly, minus `sourceType` — context has no
 * form input to remember for a retry, it just re-runs against the already-
 * connected project.
 */
export interface ContextStreamState {
  /** Full WorkLog snapshot for the in-flight (or last) context turn. */
  workLog: ToolStep[];
  streaming: boolean;
  /** Set when the stream broke (an `error` frame, or the initial POST failing). */
  error?: string;
  /** Safe retry data — raw diagnostics never become primary card copy. */
  failure?: SetupFailureRecovery;
  /** The turn's terminal `SetupStatusEvent`, once one arrives. */
  terminal?: SetupStatusEvent;
  /** `true` from a `needs_input` terminal — unlikely for context (no credential handoff), but handled generically. */
  needsInput: boolean;
  /** The setup session this stream belongs to — needed by `resolveContextDecision`. Populated from `postSetupContextTurn`'s response. */
  sessionId?: string;
  /**
   * A pending checkpoint this stream is blocked on — `max_turns_continue`,
   * arriving mid-stream as a `needs_decision` terminal (the context turn hit
   * its turn budget). `undefined` once resolved via `resolveContextDecision`.
   */
  decision?: SetupDecision;
  /** Closes the in-flight turn's `EventSource` — same abandoned-turn guard as `ConnectStreamState.activeUnsubscribe`. */
  activeUnsubscribe?: Unsubscribe;
}

const initialContextStream: ContextStreamState = { workLog: [], streaming: false, needsInput: false };

/**
 * State for the adopt step's `POST /api/setup/adopt` verification call and,
 * when it reports `needs_decision`, the `build_context` checkpoint it hands
 * back. Unlike `ConnectStreamState`/`ContextStreamState`, `verifying` covers a
 * plain synchronous request, not a streamed turn — the adopt flow only starts
 * streaming once "Build" is chosen, and at that point it hands off to
 * `contextStream` (the same machinery `buildContext` uses), not to a field
 * here.
 */
export interface AdoptStreamState {
  /** True while `postSetupAdopt`'s verification request is in flight. */
  verifying: boolean;
  /** Set when verification failed, or resolving the decision failed. */
  error?: string;
  /** The pending `build_context` checkpoint, once verification reports `needs_decision`. */
  decision?: SetupDecision;
  /** The setup session the pending decision is scoped to — needed by `resolveAdoptDecision`. */
  sessionId?: string;
  /** True while `resolveAdoptDecision`'s POST is in flight. */
  resolving: boolean;
}

const initialAdoptStream: AdoptStreamState = { verifying: false, resolving: false };

/** Nothing discovered yet — the Build-context card's first-run state. */
const EMPTY_CONTEXT_SUMMARY: ContextSummary = { models: 0, relationships: 0 };

/** Nothing detected yet — the Runtime card's pre-fetch state (fixture mode never fetches this). */
const EMPTY_ADAPTER_ENV_STATUS: AdapterEnvStatus = { anthropic: false, openaiCompatible: false };
const EMPTY_SUBSCRIPTION_LOGIN_STATUS: SubscriptionLoginStatus = { claude: false, codex: false };
const INITIAL_SUBSCRIPTION_LOGIN_STATUS: SubscriptionLoginStatus = isBffEnabled()
  ? EMPTY_SUBSCRIPTION_LOGIN_STATUS
  : { claude: true, codex: false };

interface SetupStoreState {
  steps: SetupStep[];
  /** Which step's card the canvas currently shows (independent of progress). */
  selectedStepKey: StepKey;
  runtimeSettings: RuntimeSettings;
  /** Monotonic user-edit marker; protects the form from late initial hydration. */
  runtimeSettingsGeneration: number;
  /** True after a user changes the runtime form, until an explicit wizard reset. */
  runtimeSettingsDirty: boolean;
  /** Exact compiled-bundle tiers; independent of the subscription driver model. */
  /**
   * The data sources Setup may offer, from wren's registry via the BFF. Empty
   * until `fetchSourceCatalog` resolves; the picker falls back to the fixture
   * list only in fixture mode.
   */
  sourceCatalog: SetupSourceCatalogSource[];
  /** Set when the BFF could read no registry, so the picker can say the list is partial. */
  sourceCatalogDegradedReason?: string;
  sourceCatalogLoading: boolean;
  runtimeTierNames: string[];
  /** Loud tier-discovery failure; no fixture/DB rows may substitute in live mode. */
  runtimeTierNamesError?: string;
  /**
   * Whether each api-key adapter's required credential env var is present on
   * the BFF process — booleans only, fetched once via `hydrate()`. Fixture
   * mode never fetches this and leaves it at the all-`false` default (the
   * api-key adapter picker isn't wired to real dispatch there anyway).
   */
  adapterEnvStatus: AdapterEnvStatus;
  /** Boolean-only CLI login availability; no token details are exposed. */
  subscriptionLoginStatus: SubscriptionLoginStatus;
  /** Ephemeral, account-specific catalog suggestions; never included in runtime persistence. */
  subscriptionModelCatalogs: Partial<Record<SubscriptionProvider, SubscriptionModelCatalog>>;
  subscriptionModelCatalogLoading: Partial<Record<SubscriptionProvider, boolean>>;
  subscriptionModelCatalogErrors: Partial<Record<SubscriptionProvider, string>>;
  /** True while `PUT /api/config/runtime` is in flight. */
  runtimeSettingsSaving: boolean;
  /** Set when the live save was rejected (e.g. a missing env var, or a compliance error) — never set in fixture mode. */
  runtimeSettingsError?: string;
  /** Server-confirmed native CLI binding from the most recent Runtime save. */
  nativeSessionBinding?: NativeRuntimeBinding;
  /** Turned on by `compileAndBind` — mirrors the Harness page's verify gate. */
  verifyGate: boolean;
  /** Key of the connected data source, once step 2 completes. */
  connectedSourceKey?: string;
  messages: ConversationMessage[];
  /**
   * The wizard's entry-path choice (live mode only — fixture mode always
   * behaves as "create"). `undefined` before the initial `GET /api/setup/mode`
   * fetch resolves, or before the user has picked one.
   */
  setupMode?: SetupMode;
  /** True while the initial mode fetch is in flight — gates the choice screen so it doesn't flash before the fetch resolves. */
  setupModeLoading: boolean;
  /** True while `POST /api/setup/mode` (choosing a mode) is in flight. */
  setupModeChoosing: boolean;
  /** Set when choosing a mode failed. */
  setupModeError?: string;
  /** Live-mode-only streaming state for the connect step's agentic turn. */
  connectStream: ConnectStreamState;
  /** Live-mode-only streaming state for the context step's agentic turn. */
  contextStream: ContextStreamState;
  /** Live-mode-only state for the adopt step's verification call + build_context checkpoint. */
  adoptStream: AdoptStreamState;
  /**
   * Discovered context counts shown on the Build-context card. Starts at zero
   * (nothing is built yet); in live mode it's populated from the real project
   * after a successful build, in fixture mode from the demo summary on click.
   */
  contextSummary: ContextSummary;

  /** Select a step in the sidebar — shows its card in the canvas. */
  selectStep: (key: StepKey) => void;
  /**
   * Records the create/adopt choice: POSTs it to the BFF, which swaps the
   * `connect`/`adopt` step in place (see `StepKey`'s doc comment) — the
   * returned `steps` replaces local state so the wizard proceeds from step 1
   * exactly as before, just with the right second step. No-op in fixture mode
   * (the choice screen never renders there).
   */
  chooseSetupMode: (mode: SetupMode) => void;
  /**
   * Verifies (and, when already built, binds) an existing project directory —
   * a plain synchronous `POST /api/setup/adopt`, not a streamed turn. `'ok'`
   * marks adopt AND context both done, landing on bind (no context step
   * needed); `'needs_decision'` surfaces either checkpoint via
   * `adoptStream.decision` (see `SetupAdoptResponse`), staying on the adopt
   * step; `'error'` on a plain path verify shows the message inline for the
   * user to retry with a corrected path. Pass `profile` when re-calling this
   * after the user picks a candidate off a `select_profile` checkpoint — see
   * `AdoptStepCard`, which calls this directly (not `resolveAdoptDecision`)
   * for that kind. If THAT call comes back `'error'` (the pick was
   * incompatible, or connecting with it failed), the server has already
   * restored the project to its pre-pick, no-pin state, so this re-shows the
   * same candidate list alongside the failure message rather than stranding
   * the user on a dead-end error with no way back to picking again. No-op in
   * fixture mode.
   */
  adoptProject: (projectPath: string, profile?: string) => void;
  /**
   * Resolves `adoptStream.decision` when it's a `build_context` checkpoint,
   * by POSTing the chosen option's id to `/api/setup/decision`. `'build'`
   * dispatches the same context-build turn the create flow's context step
   * uses — streamed through the existing `contextStream`/`contextHandlers`
   * machinery, with the adopt step marked done and the canvas switched to the
   * context step's own card. `'cancel'` drops the checkpoint (nothing was
   * bound) and returns the user all the way back to the mode/path choice
   * screen. No-op in fixture mode or with no pending decision. NOT used for a
   * `select_profile` checkpoint — that one has no server-side session to
   * resolve, so `AdoptStepCard` calls `adoptProject(path, chosenProfile)`
   * directly instead of this action.
   */
  resolveAdoptDecision: (choiceId: string) => void;
  updateRuntimeSettings: (patch: Partial<RuntimeSettings>) => void;
  /** Selects a provider, clears its incompatible model values, and starts its catalog lookup. */
  selectSubscriptionProvider: (provider: SubscriptionProvider) => void;
  /** Loads or refreshes only the current provider's catalog; stale responses are discarded. */
  loadSubscriptionModelCatalog: (provider: SubscriptionProvider, refresh?: boolean) => void;
  /**
   * Step 1 (runtime) → done; the step that immediately follows it becomes
   * current — 'connect' in create mode, 'adopt' in adopt mode.
   */
  saveRuntimeSettings: () => void;
  /**
   * Starts a real agentic connect turn (live mode) and streams its WorkLog
   * into `connectStream`; step 2 → done / step 3 (context) → current ONLY
   * once the stream's terminal reports `status: 'ok'` — never on the click
   * itself. A `needs_input` terminal instead sets `connectStream.needsInput`
   * and leaves the flow on step 2 until `resumeConnect` succeeds. In fixture
   * mode (no BFF), this keeps the old synchronous optimistic advance.
   */
  connectDataSource: (projectName: string, sourceType: string, variant?: string) => void;
  /**
   * Starts a fresh turn on the same setup session after the user has filled
   * in `.env` credentials out-of-band, following a `needs_input` terminal.
   * No-op in fixture mode (there is no pending `needs_input` to resume).
   */
  resumeConnect: () => void;
  /** Repeats exactly the persisted failed connect route. */
  retryConnectFailure: () => void;
  /**
   * Fetches the scaffolded project's `.env` template field KEYS (never
   * values — see `SetupEnvField`) so the credential form can render one input
   * per field. Called once a `needs_input` terminal arrives. Never routes
   * credential VALUES anywhere — this only ever reads key names. No-op in
   * fixture mode.
   */
  fetchSourceCatalog: () => void;
  fetchConnectEnvFields: () => void;
  /**
   * Submits the filled-in credential form values: POSTs them to the BFF,
   * which writes them straight into the on-disk `.env` (never through this
   * store, a turn prompt, or the SSE stream — see `postSetupEnvValues`), then
   * calls `resumeConnect()` to continue the paused turn. No-op in fixture mode.
   */
  submitConnectEnv: (values: Record<string, string>) => void;
  /**
   * Resolves `connectStream.decision` (a `name_conflict` checkpoint) by
   * POSTing the chosen option's id to `/api/setup/decision`. `'clean'`
   * dispatches a fresh connect turn (streamed through the same
   * `connectHandlers` path as `connectDataSource`); `'rename'` clears the
   * decision and re-opens the project-name entry for a new name (no turn);
   * `'cancel'` clears the decision and resets the connect stream entirely (no
   * turn). No-op in fixture mode or with no pending decision.
   */
  resolveConnectDecision: (choiceId: string) => void;
  /**
   * Resolves `contextStream.decision` (a `max_turns_continue` checkpoint) by
   * POSTing the chosen option's id to `/api/setup/decision`. `'continue'`
   * resumes the context turn (streamed through `contextHandlers`, same as
   * `buildContext`); `'stop'` returns no turn — its `needs_input` event is
   * routed through the normal `contextHandlers().onEvent` path instead. No-op
   * in fixture mode or with no pending decision.
   */
  resolveContextDecision: (choiceId: string) => void;
  /**
   * Starts a real agentic context-build turn (live mode) and streams its
   * WorkLog into `contextStream`; step 3 → done / step 4 (bind) becomes
   * current ONLY once the stream's terminal reports `status: 'ok'` — never
   * on the click itself. A `needs_input` terminal instead sets
   * `contextStream.needsInput` and leaves the flow on step 3 (unlikely for
   * context — no credential handoff — but handled generically like connect).
   * In fixture mode (no BFF), this keeps the old synchronous optimistic
   * advance.
   */
  buildContext: () => void;
  /** Repeats the failed context route. */
  retryContextFailure: () => void;
  /** Step 4 → done, verify gate ON; step 5 (ask) becomes current. */
  compileAndBind: () => void;
  /** Live-only: hydrate steps + runtime settings from the BFF. No-op in fixture mode. */
  hydrate: () => void;
  /** Re-reads canonical setup/project state after returning from a native session. */
  refreshCanonical: () => void;
  /**
   * Resets the whole setup wizard to first-run state: tears down any in-flight
   * setup streams, clears local store state back to initial, and (live mode)
   * tells the BFF to reset server state + unbind the project. Non-destructive —
   * scaffolded project files on disk are kept.
   */
  resetSetup: () => void;
}

/**
 * Setup page state: the 5-step onboarding flow (done/current/todo), the
 * runtime settings form, the verify-gate flag flipped by `compileAndBind`,
 * and the guided conversation transcript. One store per feature module (per
 * the app's convention) — see `useHarnessStore` for the sibling pattern. With
 * no `VITE_BFF_URL` set, everything here is local/fixture-driven, unchanged.
 * When the BFF is enabled, the step-advancing actions stay optimistic (the
 * exact same local transition happens unconditionally) and additionally fire
 * a best-effort live REST call whose response corrects/re-confirms state;
 * `hydrate()` additionally seeds steps + runtime settings from the BFF on
 * mount. `buildContext` has no backing endpoint in this phase and stays
 * purely local either way.
 */
export const useSetupStore = create<SetupStoreState>()((set, get) => {
  /**
   * Shared terminal-handling for both `connectDataSource` and `resumeConnect`:
   * both start a turn and stream it through `setupStream`, and both gate the
   * connect→context advance on the exact same `ok` / `needs_input` / error
   * semantics, so the handler closure is built once and reused.
   */
  function connectHandlers(sourceType: string, projectName: string, attempt: 'connect' | 'connect_resume' = 'connect'): SetupStreamHandlers {
    return {
      onWorkLog: (steps) => set((s) => ({ connectStream: { ...s.connectStream, workLog: steps } })),
      onEvent: (event) => {
        // The terminal has arrived — nothing more will be read from this
        // turn's stream, so release it now rather than waiting on a trailing
        // `done` frame that may never come (e.g. a needs_input pause).
        get().connectStream.activeUnsubscribe?.();
        if (event.status === 'ok') {
          set((s) => ({
            steps: advance(s.steps, 'connect', 'context'),
            selectedStepKey: 'context',
            connectedSourceKey: sourceType,
            connectStream: {
              ...s.connectStream,
              streaming: false,
              terminal: event,
              needsInput: false,
              activeUnsubscribe: undefined,
            },
            messages: [
              ...s.messages,
              {
                id: nextMessageId(),
                role: 'assistant',
                text: t('setup.dataSourceConnectedMessage'),
                workLog: s.connectStream.workLog,
                terminal: event,
              },
            ],
          }));
        } else if (event.status === 'needs_decision' && event.decision) {
          const decision = event.decision;
          set((s) => ({
            connectStream: {
              ...s.connectStream,
              streaming: false,
              terminal: event,
              needsInput: false,
              decision,
              activeUnsubscribe: undefined,
            },
            messages: [
              ...s.messages,
              {
                id: nextMessageId(),
                role: 'assistant',
                text: decision.detail ?? event.message,
                workLog: s.connectStream.workLog,
                terminal: event,
              },
            ],
          }));
        } else {
          set((s) => ({
            connectStream: {
              ...s.connectStream,
              streaming: false,
              terminal: event,
              needsInput: true,
              activeUnsubscribe: undefined,
            },
            messages: [
              ...s.messages,
              {
                id: nextMessageId(),
                role: 'assistant',
                text: event.message,
                workLog: s.connectStream.workLog,
                terminal: event,
              },
            ],
          }));
        }
      },
      onError: (message) => {
        get().connectStream.activeUnsubscribe?.();
        set((s) => ({
          connectStream: {
            ...s.connectStream,
            streaming: false,
            error: message,
            failure: { attempt, projectName, sourceType, error: message, workLog: finalizeWorkLog(s.connectStream.workLog, 'error') },
            workLog: finalizeWorkLog(s.connectStream.workLog, 'error'),
            activeUnsubscribe: undefined,
          },
          messages: [
            ...s.messages,
            { id: nextMessageId(), role: 'assistant', text: t('setup.connectFailureHistoryMessage'), workLog: finalizeWorkLog(s.connectStream.workLog, 'error') },
          ],
        }));
      },
      onDone: () => {
        get().connectStream.activeUnsubscribe?.();
        set((s) => ({ connectStream: { ...s.connectStream, streaming: false, activeUnsubscribe: undefined } }));
      },
    };
  }

  /**
   * Same shared-handler shape as `connectHandlers`, for the context step's
   * `buildContext` turn. On `ok` it advances context→bind (mirroring
   * connect's connect→context advance); on `needs_input` it stays on step 3
   * and flags `needsInput` (unlikely for context, but handled generically).
   */
  // After a successful build, replace the zeroed summary with the real counts
  // from the freshly-built project (`wren context show` via the BFF). Best
  // effort — a failed fetch just leaves the last known summary.
  function refreshContextSummary(): void {
    getContextOverview()
      .then((overview) =>
        set({
          contextSummary: {
            models: overview.models.length,
            relationships: overview.relationships.length,
          },
        }),
      )
      .catch(() => {});
  }

  function contextHandlers(): SetupStreamHandlers {
    return {
      onWorkLog: (steps) => set((s) => ({ contextStream: { ...s.contextStream, workLog: steps } })),
      onEvent: (event) => {
        get().contextStream.activeUnsubscribe?.();
        if (event.status === 'ok') {
          set((s) => ({
            steps: advance(s.steps, 'context', 'bind'),
            selectedStepKey: 'bind',
            contextStream: {
              ...s.contextStream,
              streaming: false,
              terminal: event,
              needsInput: false,
              activeUnsubscribe: undefined,
            },
            messages: [
              ...s.messages,
              {
                id: nextMessageId(),
                role: 'assistant',
                text: t('setup.contextBuiltMessage'),
                workLog: finalizeWorkLog(s.contextStream.workLog, 'ok'),
                terminal: event,
              },
            ],
          }));
          refreshContextSummary();
        } else if (event.status === 'needs_decision' && event.decision) {
          const decision = event.decision;
          set((s) => ({
            contextStream: {
              ...s.contextStream,
              streaming: false,
              terminal: event,
              needsInput: false,
              decision,
              activeUnsubscribe: undefined,
            },
            messages: [
              ...s.messages,
              {
                id: nextMessageId(),
                role: 'assistant',
                text: decision.detail ?? event.message,
                workLog: finalizeWorkLog(s.contextStream.workLog, 'error'),
                terminal: event,
              },
            ],
          }));
        } else {
          set((s) => ({
            contextStream: {
              ...s.contextStream,
              streaming: false,
              terminal: event,
              needsInput: true,
              activeUnsubscribe: undefined,
            },
            messages: [
              ...s.messages,
              {
                id: nextMessageId(),
                role: 'assistant',
                text: event.message,
                workLog: finalizeWorkLog(s.contextStream.workLog, 'error'),
                terminal: event,
              },
            ],
          }));
        }
      },
      onError: (message) => {
        get().contextStream.activeUnsubscribe?.();
        set((s) => ({
          contextStream: {
            ...s.contextStream,
            streaming: false,
            error: message,
            failure: {
              attempt: 'context',
              projectName: s.connectStream.projectName ?? s.connectStream.failure?.projectName ?? '',
              sourceType: s.connectedSourceKey ?? s.connectStream.failure?.sourceType ?? '',
              error: message,
              workLog: finalizeWorkLog(s.contextStream.workLog, 'error'),
            },
            workLog: finalizeWorkLog(s.contextStream.workLog, 'error'),
            activeUnsubscribe: undefined,
          },
          messages: [
            ...s.messages,
            { id: nextMessageId(), role: 'assistant', text: t('setup.contextFailureHistoryMessage'), workLog: finalizeWorkLog(s.contextStream.workLog, 'error') },
          ],
        }));
      },
      onDone: () => {
        get().contextStream.activeUnsubscribe?.();
        set((s) => ({ contextStream: { ...s.contextStream, streaming: false, activeUnsubscribe: undefined } }));
      },
    };
  }

  return {
  steps: fixtureSetupSteps,
  selectedStepKey: 'runtime',
  runtimeSettings: fixtureRuntimeSettings,
  runtimeSettingsGeneration: 0,
  runtimeSettingsDirty: false,
  sourceCatalog: [],
  sourceCatalogDegradedReason: undefined,
  sourceCatalogLoading: false,
  runtimeTierNames: isBffEnabled() ? [] : fixtureRuntimeSettings.tierModels.map((binding) => binding.tier),
  runtimeTierNamesError: undefined,
  adapterEnvStatus: EMPTY_ADAPTER_ENV_STATUS,
  subscriptionLoginStatus: INITIAL_SUBSCRIPTION_LOGIN_STATUS,
  subscriptionModelCatalogs: {},
  subscriptionModelCatalogLoading: {},
  subscriptionModelCatalogErrors: {},
  runtimeSettingsSaving: false,
  runtimeSettingsError: undefined,
  verifyGate: false,
  connectedSourceKey: undefined,
  messages: [fixtureInitialMessage],
  setupMode: undefined,
  setupModeLoading: isBffEnabled(),
  setupModeChoosing: false,
  setupModeError: undefined,
  connectStream: initialConnectStream,
  contextStream: initialContextStream,
  adoptStream: initialAdoptStream,
  contextSummary: EMPTY_CONTEXT_SUMMARY,

  selectStep: (key) => set({ selectedStepKey: key }),

  chooseSetupMode: (mode) => {
    if (!isBffEnabled()) return;
    set({ setupModeChoosing: true, setupModeError: undefined });
    postSetupMode(mode)
      .then(({ mode: confirmedMode, steps }) => set({ setupMode: confirmedMode, steps, setupModeChoosing: false }))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : t('ask.streamErrorGeneric');
        set({ setupModeChoosing: false, setupModeError: message });
      });
  },

  adoptProject: (projectPath, profile) => {
    if (!isBffEnabled()) return;
    // Captured before the request clears `adoptStream` — only used on the
    // 'error' branch below, and only when this call was a profile pick (see
    // there for why).
    const { decision: priorDecision, sessionId: priorSessionId } = get().adoptStream;
    set({ adoptStream: { ...initialAdoptStream, verifying: true } });
    postSetupAdopt(projectPath, profile)
      .then((result) => {
        if (result.status === 'ok') {
          set((s) => ({
            steps: advance(advance(s.steps, 'adopt', 'context'), 'context', 'bind'),
            selectedStepKey: 'bind',
            adoptStream: initialAdoptStream,
            messages: [
              ...s.messages,
              { id: nextMessageId(), role: 'assistant', text: t('setup.adoptBoundMessage') },
            ],
          }));
          refreshContextSummary();
          return;
        }
        if (result.status === 'needs_decision' && result.decision) {
          const decision = result.decision;
          set((s) => ({
            adoptStream: { ...initialAdoptStream, decision, sessionId: result.sessionId },
            messages: [
              ...s.messages,
              { id: nextMessageId(), role: 'assistant', text: decision.detail ?? result.message },
            ],
          }));
          return;
        }
        // 'error'. If this was a `select_profile` pick, the server rejected
        // or failed to connect with the chosen profile and (per its own
        // contract) restored `wren_project.yml` to its pre-pick, no-pin
        // state — so the candidate list we already have is still valid.
        // Restore it alongside the failure message instead of dropping the
        // user onto a dead-end inline error with no way back to picking a
        // different profile.
        if (profile && priorDecision) {
          set({
            adoptStream: {
              ...initialAdoptStream,
              decision: priorDecision,
              sessionId: priorSessionId,
              error: result.message,
            },
          });
          return;
        }
        // Plain path verify failed — nothing was bound; leave the path input
        // in place for a retry.
        set({ adoptStream: { ...initialAdoptStream, error: result.message } });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : t('ask.streamErrorGeneric');
        if (profile && priorDecision) {
          set({
            adoptStream: {
              ...initialAdoptStream,
              decision: priorDecision,
              sessionId: priorSessionId,
              error: message,
            },
          });
          return;
        }
        set({ adoptStream: { ...initialAdoptStream, error: message } });
      });
  },

  resolveAdoptDecision: (choiceId) => {
    const { sessionId } = get().adoptStream;
    if (!isBffEnabled() || !sessionId) return;
    set((s) => ({ adoptStream: { ...s.adoptStream, resolving: true, error: undefined } }));
    postSetupDecision(sessionId, choiceId)
      .then((result) => {
        if ('turnId' in result) {
          // `build_context` + 'build' — a context-build turn was dispatched,
          // scoped to the adopted project. Mark adopt done and hand off to
          // the context step's own card/stream — same machinery as `buildContext`.
          set((s) => ({
            steps: advance(s.steps, 'adopt', 'context'),
            selectedStepKey: 'context',
            adoptStream: initialAdoptStream,
            contextStream: { ...initialContextStream, streaming: true },
          }));
          const activeUnsubscribe = setupStream(result.sessionId, result.turnId, contextHandlers());
          set((s) => ({ contextStream: { ...s.contextStream, sessionId: result.sessionId, activeUnsubscribe } }));
          return;
        }
        // `build_context` + 'cancel' — nothing was bound; go back to the mode/path choice.
        set({ setupMode: undefined, adoptStream: initialAdoptStream });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : t('ask.streamErrorGeneric');
        set((s) => ({ adoptStream: { ...s.adoptStream, resolving: false, error: message } }));
      });
  },

  updateRuntimeSettings: (patch) =>
    set((s) => ({
      runtimeSettings: { ...s.runtimeSettings, ...patch },
      runtimeSettingsGeneration: s.runtimeSettingsGeneration + 1,
      runtimeSettingsDirty: true,
    })),

  selectSubscriptionProvider: (provider) => {
    const current = get();
    if ((current.runtimeSettings.subscriptionProvider ?? 'claude') === provider) {
      current.loadSubscriptionModelCatalog(provider);
      return;
    }
    set((s) => ({
      runtimeSettings: {
        ...s.runtimeSettings,
        subscriptionProvider: provider,
        subscriptionDriverModel: '',
        apiKeyModel: '',
        tierModels: s.runtimeTierNames.map((tier) => ({ tier })),
      },
      runtimeSettingsGeneration: s.runtimeSettingsGeneration + 1,
      runtimeSettingsDirty: true,
    }));
    get().loadSubscriptionModelCatalog(provider);
  },

  loadSubscriptionModelCatalog: (provider, refresh = false) => {
    if (!isBffEnabled()) return;
    const requestSeq = ++catalogRequestSeq;
    set((s) => ({
      subscriptionModelCatalogLoading: { ...s.subscriptionModelCatalogLoading, [provider]: true },
      subscriptionModelCatalogErrors: { ...s.subscriptionModelCatalogErrors, [provider]: undefined },
    }));
    getSubscriptionModelCatalog(provider, refresh)
      .then((catalog) => {
        // A provider switch or a newer retry may have happened while this
        // request was in flight. Never let its result populate the active UI.
        if ((get().runtimeSettings.subscriptionProvider ?? 'claude') !== provider || requestSeq !== catalogRequestSeq) return;
        set((s) => ({
          subscriptionModelCatalogs: { ...s.subscriptionModelCatalogs, [provider]: catalog },
          subscriptionModelCatalogLoading: { ...s.subscriptionModelCatalogLoading, [provider]: false },
          subscriptionModelCatalogErrors: {
            ...s.subscriptionModelCatalogErrors,
            [provider]: catalog.status === 'unavailable' ? catalog.code : undefined,
          },
        }));
      })
      .catch(() => {
        if ((get().runtimeSettings.subscriptionProvider ?? 'claude') !== provider || requestSeq !== catalogRequestSeq) return;
        set((s) => ({
          subscriptionModelCatalogLoading: { ...s.subscriptionModelCatalogLoading, [provider]: false },
          subscriptionModelCatalogErrors: { ...s.subscriptionModelCatalogErrors, [provider]: 'runtime_unavailable' },
        }));
      });
  },

  saveRuntimeSettings: () => {
    if (!isBffEnabled()) {
      // Fixture mode has no PUT to reject the choice — keep the old
      // synchronous optimistic advance so local/non-BFF dev still works.
      set((s) => {
        const nextKey = stepAfter(s.steps, 'runtime');
        return {
          steps: advance(s.steps, 'runtime', nextKey),
          selectedStepKey: nextKey,
          messages: [
            ...s.messages,
            {
              id: nextMessageId(),
              role: 'assistant',
              text: t('setup.runtimeConfiguredMessage'),
            },
          ],
        };
      });
      return;
    }

    // Live mode: the PUT can now genuinely reject the choice (a missing
    // api-key env var, or a subscription+hosted compliance error) — gate the
    // step advance on its success instead of applying it optimistically, and
    // surface a rejection as `runtimeSettingsError` rather than swallowing it.
    const current = get();
    const tierModels = current.runtimeTierNames.map((tier) => {
      const binding = current.runtimeSettings.tierModels.find((entry) => entry.tier === tier);
      return { tier, ...(binding?.model !== undefined ? { model: binding.model } : {}) };
    });
    set((s) => ({
      runtimeSettingsSaving: true,
      runtimeSettingsError: undefined,
      runtimeSettingsGeneration: s.runtimeSettingsGeneration + 1,
      runtimeSettingsDirty: true,
    }));
    putRuntimeSettings({
      ...current.runtimeSettings,
      authMode: 'subscription',
      hybrid: false,
      // Setup requires an explicit model on every compiled tier. Clear any
      // hidden legacy default so it cannot silently influence runtime routing;
      // direct API/CLI callers retain the generic default-model contract.
      apiKeyModel: '',
      // The legacy adapter fallback is still consulted by Claude's models
      // config writer. Pin it to the provider's own adapter while hybrid is
      // unavailable; Codex ignores this field and consumes only model names.
      apiKeyAdapter: 'anthropic',
      tierModels,
    })
      .then(({ warnings, nativeSessionBinding, ...settings }) => {
        set((s) => {
          const nextKey = stepAfter(s.steps, 'runtime');
          return {
            runtimeSettings: settings,
            nativeSessionBinding,
            runtimeSettingsSaving: false,
            runtimeSettingsError: undefined,
            steps: advance(s.steps, 'runtime', nextKey),
            selectedStepKey: nextKey,
            messages: [
              ...s.messages,
              {
                id: nextMessageId(),
                role: 'assistant',
                text: t('setup.runtimeConfiguredMessage'),
              },
              ...warnings.map((warning) => ({
                id: nextMessageId(),
                role: 'assistant' as const,
                text: warning,
              })),
            ],
          };
        });
        void useNativeSessions.getState().refreshReadiness();
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : t('ask.streamErrorGeneric');
        set({ runtimeSettingsSaving: false, runtimeSettingsError: message });
      });
  },

  connectDataSource: (projectName, sourceType, variant) => {
    if (!isBffEnabled()) {
      // Fixture mode has no real turn to stream — keep the old synchronous
      // optimistic advance so local/non-BFF dev still works end to end.
      set((s) => ({
        steps: advance(s.steps, 'connect', 'context'),
        selectedStepKey: 'context',
        connectedSourceKey: sourceType,
        messages: [
          ...s.messages,
          {
            id: nextMessageId(),
            role: 'assistant',
            text: t('setup.dataSourceConnectedMessage'),
          },
        ],
      }));
      return;
    }

    // A prior turn may still be open (e.g. abandoned mid-stream) — close it
    // before starting a new one so its handler closure can't later `set(...)`
    // into this same slot and stomp the turn we're about to start.
    get().connectStream.activeUnsubscribe?.();
    set({ connectStream: { ...initialConnectStream, streaming: true, sourceType, projectName } });
    postSetupConnectTurn(projectName, sourceType, variant)
      .then(({ sessionId, turnId }) => {
        const activeUnsubscribe = setupStream(sessionId, turnId, connectHandlers(sourceType, projectName));
        set((s) => ({ connectStream: { ...s.connectStream, sessionId, activeUnsubscribe } }));
      })
      .catch((err: unknown) => {
        // A same-name project conflict — the BFF answered 409 with a
        // `name_conflict` decision instead of starting a turn. Surface the
        // decision card rather than a plain error message.
        if (err instanceof SetupDecisionRequiredError) {
          set((s) => ({
            connectStream: {
              ...s.connectStream,
              streaming: false,
              sessionId: err.sessionId,
              decision: err.decision,
            },
            messages: [
              ...s.messages,
              {
                id: nextMessageId(),
                role: 'assistant',
                text: err.decision.detail ?? err.message,
              },
            ],
          }));
          return;
        }
        const message = err instanceof Error ? err.message : t('ask.streamErrorGeneric');
        set((s) => ({ connectStream: { ...s.connectStream, streaming: false, error: message } }));
      });
  },

  resumeConnect: () => {
    if (!isBffEnabled()) return;

    const currentStream = get().connectStream;
    const previousFailure = currentStream.failure;
    const sourceType = currentStream.sourceType ?? previousFailure?.sourceType ?? '';
    const projectName = currentStream.projectName ?? previousFailure?.projectName ?? '';
    currentStream.activeUnsubscribe?.();
    set({
      connectStream: {
        ...initialConnectStream,
        streaming: true,
        sourceType,
        projectName,
      },
    });
    postSetupResume()
      .then(({ sessionId, turnId }) => {
        const activeUnsubscribe = setupStream(sessionId, turnId, connectHandlers(sourceType, projectName, 'connect_resume'));
        set((s) => ({ connectStream: { ...s.connectStream, sessionId, activeUnsubscribe } }));
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : t('ask.streamErrorGeneric');
        set((s) => ({ connectStream: { ...s.connectStream, streaming: false, error: message } }));
      });
  },

  retryConnectFailure: () => {
    const failure = get().connectStream.failure;
    if (!failure) return;
    if (failure.attempt === 'connect_resume') {
      get().resumeConnect();
      return;
    }
    get().connectDataSource(failure.projectName, failure.sourceType);
  },

  fetchSourceCatalog: () => {
    if (!isBffEnabled()) return;
    set({ sourceCatalogLoading: true });
    getSetupSourceCatalog()
      .then((catalog) =>
        set({
          sourceCatalog: catalog.sources,
          sourceCatalogDegradedReason: catalog.fromCli ? undefined : (catalog.degradedReason ?? t('setup.connectSourceCatalogPartial')),
          sourceCatalogLoading: false,
        }),
      )
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : t('setup.connectSourceCatalogPartial');
        set({ sourceCatalog: [], sourceCatalogDegradedReason: message, sourceCatalogLoading: false });
      });
  },

  fetchConnectEnvFields: () => {
    if (!isBffEnabled()) return;
    set((s) => ({ connectStream: { ...s.connectStream, envFieldsError: undefined, envFieldsLoading: true } }));
    getSetupEnvFields()
      .then(({ fields }) => set((s) => ({ connectStream: { ...s.connectStream, envFields: fields, envFieldsLoading: false } })))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : t('setup.connectEnvFieldsLoadError');
        set((s) => ({ connectStream: { ...s.connectStream, envFieldsError: message, envFieldsLoading: false } }));
      });
  },

  submitConnectEnv: (values) => {
    if (!isBffEnabled()) return;
    set((s) => ({ connectStream: { ...s.connectStream, submittingEnv: true } }));
    postSetupEnvValues(values)
      .then(() => {
        set((s) => ({ connectStream: { ...s.connectStream, submittingEnv: false } }));
        get().resumeConnect();
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : t('ask.streamErrorGeneric');
        set((s) => ({ connectStream: { ...s.connectStream, submittingEnv: false, error: message } }));
      });
  },

  resolveConnectDecision: (choiceId) => {
    const { sessionId, sourceType } = get().connectStream;
    if (!isBffEnabled() || !sessionId) return;
    set((s) => ({ connectStream: { ...s.connectStream, streaming: true, error: undefined } }));
    postSetupDecision(sessionId, choiceId)
      .then((result) => {
        if ('turnId' in result) {
          // `name_conflict` + 'clean' — a fresh connect turn was dispatched;
          // stream it through the same path as `connectDataSource`.
          const activeUnsubscribe = setupStream(result.sessionId, result.turnId, connectHandlers(sourceType ?? '', ''));
          set((s) => ({
            connectStream: {
              ...s.connectStream,
              sessionId: result.sessionId,
              decision: undefined,
              activeUnsubscribe,
            },
          }));
          return;
        }
        // `name_conflict` + 'rename' | 'cancel' — no turn, just an ack.
        if (choiceId === 'rename') {
          // Re-open the project-name entry for a NEW name: back to a clean,
          // pre-turn connect state, same source type.
          set({ connectStream: { ...initialConnectStream, sourceType } });
        } else {
          // 'cancel' — abort cleanly, fully reset.
          set({ connectStream: initialConnectStream });
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : t('ask.streamErrorGeneric');
        set((s) => ({ connectStream: { ...s.connectStream, streaming: false, error: message } }));
      });
  },

  resolveContextDecision: (choiceId) => {
    const { sessionId } = get().contextStream;
    if (!isBffEnabled() || !sessionId) return;
    set((s) => ({ contextStream: { ...s.contextStream, streaming: true, error: undefined } }));
    postSetupDecision(sessionId, choiceId)
      .then((result) => {
        if ('turnId' in result) {
          // `max_turns_continue` + 'continue' — the context turn resumed;
          // stream it through the same path as `buildContext`. Reset the
          // stale prior-turn `workLog` (already persisted onto the
          // `needs_decision` transcript message above) before the resumed
          // turn's own frames start arriving — same reset `buildContext`/
          // `connectDataSource` do for a brand-new turn — so the resumed
          // turn's live trace doesn't render with turn-1's finished steps
          // stuck alongside it.
          const activeUnsubscribe = setupStream(result.sessionId, result.turnId, contextHandlers());
          set((s) => ({
            contextStream: {
              ...s.contextStream,
              workLog: [],
              sessionId: result.sessionId,
              decision: undefined,
              activeUnsubscribe,
            },
          }));
          return;
        }
        if ('event' in result) {
          // `max_turns_continue` + 'stop' — no turn; route the returned
          // `needs_input` event through the normal terminal-handling path
          // rather than opening a stream for it.
          set((s) => ({ contextStream: { ...s.contextStream, streaming: false, decision: undefined } }));
          contextHandlers().onEvent?.(result.event);
          return;
        }
        // Unexpected shape for a context decision (a `name_conflict` action
        // response) — clear the decision and leave the stream idle rather
        // than crash on a field that doesn't exist here.
        set((s) => ({ contextStream: { ...s.contextStream, streaming: false, decision: undefined } }));
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : t('ask.streamErrorGeneric');
        set((s) => ({ contextStream: { ...s.contextStream, streaming: false, error: message } }));
      });
  },

  buildContext: () => {
    if (!isBffEnabled()) {
      // Fixture mode has no real turn to stream — keep the old synchronous
      // optimistic advance so local/non-BFF dev still works end to end.
      set((s) => ({
        steps: advance(s.steps, 'context', 'bind'),
        selectedStepKey: 'bind',
        contextSummary: fixtureContextSummary,
        messages: [
          ...s.messages,
          {
            id: nextMessageId(),
            role: 'assistant',
            text: t('setup.contextBuiltMessage'),
          },
        ],
      }));
      return;
    }

    // A prior turn may still be open (e.g. abandoned mid-stream) — close it
    // before starting a new one, same guard as `connectDataSource`.
    get().contextStream.activeUnsubscribe?.();
    set({ contextStream: { ...initialContextStream, streaming: true } });
    postSetupContextTurn()
      .then(({ sessionId, turnId }) => {
        const activeUnsubscribe = setupStream(sessionId, turnId, contextHandlers());
        set((s) => ({ contextStream: { ...s.contextStream, sessionId, activeUnsubscribe } }));
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : t('ask.streamErrorGeneric');
        set((s) => ({ contextStream: { ...s.contextStream, streaming: false, error: message } }));
      });
  },

  retryContextFailure: () => {
    if (get().contextStream.failure?.attempt !== 'context') return;
    get().buildContext();
  },

  compileAndBind: () => {
    set((s) => ({
      steps: advance(s.steps, 'bind', 'ask'),
      selectedStepKey: 'ask',
      verifyGate: true,
      messages: [
        ...s.messages,
        {
          id: nextMessageId(),
          role: 'assistant',
          text: t('setup.profileBoundMessage'),
        },
      ],
    }));

    if (!isBffEnabled()) return;
    postSetupCompileBind()
      .then(({ steps, verifyGatePassed }) => set({ steps, verifyGate: verifyGatePassed }))
      .catch(() => {
        // Best-effort — the optimistic local step transition already applied.
      });
  },

  refreshCanonical: () => {
    if (!isBffEnabled()) return;
    getSetupSteps()
      .then((steps) => {
        const resume = [...steps].reverse().find((step) => step.state === 'current')?.key
          ?? steps.find((step) => step.state !== 'done')?.key;
        set(resume ? { steps, selectedStepKey: resume } : { steps });
      })
      .catch(() => {});
    getSetupMode()
      .then(({ mode }) => set({ setupMode: mode, setupModeLoading: false }))
      .catch(() => set({ setupModeLoading: false }));
    // A native session's raw terminal bytes are never read here. The overview
    // is the canonical project-artifact snapshot when a project is bound.
    getContextOverview()
      .then((overview) => set({ contextSummary: { models: overview.models.length, relationships: overview.relationships.length } }))
      .catch(() => {});
  },

  hydrate: () => {
    if (!isBffEnabled()) return;

    // Only seed from the BFF while the flow is still pristine. These GETs race
    // the step-advancing actions (which also fire on user clicks); once the
    // user has advanced a step, a late hydrate must not revert their progress.
    const pristine = () => !get().steps.some((st) => st.state === 'done');
    const runtimeSettingsGeneration = get().runtimeSettingsGeneration;
    const canSeedRuntimeSettings = () =>
      pristine()
      && !get().runtimeSettingsDirty
      && get().runtimeSettingsGeneration === runtimeSettingsGeneration;

    getSetupMode()
      .then(({ mode }) => set({ setupMode: mode, setupModeLoading: false }))
      .catch(() => set({ setupModeLoading: false }));
    getSetupRecovery()
      .then(({ failure, needsInput, sessionId, decision }) => {
        // A reload after connect has progressed naturally has `done` steps,
        // so this cannot use the generic pristine gate used by initial form
        // hydration. Only an active replacement turn supersedes recovery.
        if (get().connectStream.streaming || get().contextStream.streaming) return;
        if ((decision?.kind === 'max_turns_continue' || decision?.kind === 'schema_discovery_retry') && sessionId) {
          set({
            selectedStepKey: 'context',
            contextStream: { ...initialContextStream, sessionId, decision },
          });
          return;
        }
        if (needsInput && sessionId) {
          const terminal: SetupStatusEvent = {
            id: `recovery-needs-input-${sessionId}`,
            kind: 'setup_status',
            status: 'needs_input',
            message: needsInput.message,
          };
          if (needsInput.attempt === 'context') {
            set({
              selectedStepKey: 'context',
              contextStream: { ...initialContextStream, sessionId, terminal, needsInput: true, workLog: needsInput.workLog },
            });
            return;
          }
          set({
            selectedStepKey: 'connect',
            connectStream: {
              ...initialConnectStream,
              sessionId,
              terminal,
              needsInput: true,
              sourceType: needsInput.sourceType,
              projectName: needsInput.projectName,
              workLog: needsInput.workLog,
              failure,
            },
          });
          return;
        }
        if (!failure) return;
        if (failure.attempt === 'context') {
          set({
            selectedStepKey: 'context',
            contextStream: { ...initialContextStream, error: failure.error, failure, workLog: failure.workLog },
          });
          return;
        }
        set({
          selectedStepKey: 'connect',
          connectStream: {
            ...initialConnectStream,
            error: failure.error,
            failure,
            sourceType: failure.sourceType,
            projectName: failure.projectName,
            workLog: failure.workLog,
          },
        });
      })
      .catch(() => {
        // Recovery is best-effort; starting a fresh setup remains available.
      });
    getSetupSteps()
      .then((steps) => {
        // Only seed while pristine (see above). On a fresh mount — including
        // after a full page reload mid-flow — restore BOTH the step states and
        // which card is shown: resume on the furthest step the user had
        // reached (the last `current` step; else the first not-yet-`done`
        // one), so a reload no longer snaps the wizard back to step 1. Falling
        // back to the last `current` (not the first) tolerates a server that
        // still reports an early step as `current` alongside the real one.
        if (!pristine()) return;
        const resume =
          [...steps].reverse().find((st) => st.state === 'current')?.key ??
          steps.find((st) => st.state !== 'done')?.key;
        set(resume ? { steps, selectedStepKey: resume } : { steps });
      })
      .catch(() => {
        // Best-effort — keep the fixture steps already in state.
      });
    getRuntimeSettings()
      .then((runtimeSettings) => {
        // The runtime form is independently editable while these initial GETs
        // are in flight. Do not replace a just-selected provider (or start an
        // old-provider catalog request) merely because no wizard step is done.
        if (!canSeedRuntimeSettings()) return;
        set({ runtimeSettings });
        get().loadSubscriptionModelCatalog(runtimeSettings.subscriptionProvider ?? 'claude');
      })
      .catch(() => {
        // Best-effort — keep the fixture runtime settings already in state.
      });
    getRuntimeSettingsReadiness()
      .then((readiness) => {
        if (!canSeedRuntimeSettings() || readiness.valid) return;
        set({ runtimeSettingsError: readiness.correction });
      })
      .catch(() => {
        // Settings remain editable even if this auxiliary health projection is unavailable.
      });
    // Unlike the fetches above, tier names are NOT pristine-gated: they are a
    // server-owned compiled contract constant (from the bound profile), not
    // user-editable form state, so a late response can never clobber
    // in-progress user input. Gating this one silently discarded both the
    // success and error branches on a mid-flow mount, leaving the Runtime
    // card with an empty tier list and no visible error.
    getRuntimeTierNames()
      .then((runtimeTierNames) => set({ runtimeTierNames, runtimeTierNamesError: undefined }))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : t('ask.streamErrorGeneric');
        set({ runtimeTierNames: [], runtimeTierNamesError: message });
      });
    getAdapterEnvStatus()
      .then((adapterEnvStatus) => set({ adapterEnvStatus }))
      .catch(() => {
        // Best-effort — keep the all-`false` default; the Runtime card treats
        // that identically to "not detected".
      });
    getSubscriptionLoginStatus()
      .then((subscriptionLoginStatus) => set({ subscriptionLoginStatus }))
      .catch(() => {
        // Best-effort: all-false produces an actionable logged-out state.
      });
  },

  resetSetup: () => {
    // Close any in-flight connect/context stream before wiping their state, so
    // a late frame from an abandoned turn can't write into the reset store.
    get().connectStream.activeUnsubscribe?.();
    get().contextStream.activeUnsubscribe?.();
    set((s) => ({
      steps: fixtureSetupSteps,
      selectedStepKey: 'runtime',
      runtimeSettings: fixtureRuntimeSettings,
      runtimeSettingsGeneration: s.runtimeSettingsGeneration + 1,
      runtimeSettingsDirty: false,
      subscriptionLoginStatus: INITIAL_SUBSCRIPTION_LOGIN_STATUS,
      subscriptionModelCatalogs: {},
      subscriptionModelCatalogLoading: {},
      subscriptionModelCatalogErrors: {},
      runtimeSettingsSaving: false,
      runtimeSettingsError: undefined,
      nativeSessionBinding: undefined,
      verifyGate: false,
      connectedSourceKey: undefined,
      messages: [fixtureInitialMessage],
      // Reset also clears the mode server-side (`resetSetup` in db.ts) — no
      // fetch needed, this optimistic value already matches server truth.
      setupMode: undefined,
      setupModeLoading: false,
      setupModeChoosing: false,
      setupModeError: undefined,
      connectStream: initialConnectStream,
      contextStream: initialContextStream,
      adoptStream: initialAdoptStream,
      contextSummary: EMPTY_CONTEXT_SUMMARY,
    }));
    if (!isBffEnabled()) return;
    // Authoritative server reset (also unbinds the project); apply its returned
    // steps/runtimeSettings over the optimistic local reset above.
    postSetupReset()
      .then(({ steps, runtimeSettings }) => {
        set({ steps, runtimeSettings });
        // Reset does not alter CLI authentication. The optimistic reset must
        // clear its stale state, then re-read the BFF's boolean-only status so
        // a still-authenticated provider is not shown as logged out until a
        // full page reload. A failed probe deliberately leaves the safe
        // all-false reset state in place.
        const loginProbe = getSubscriptionLoginStatus()
          .then((subscriptionLoginStatus) => set({ subscriptionLoginStatus }))
          .catch(() => {});
        // The optimistic reset above does not touch runtimeTierNames, so a
        // reset after hydrate's failure path would otherwise leave a stale
        // empty list + error in place with no re-fetch. Re-run the same
        // ungated success/error semantics as hydrate() (see above) so the
        // post-reset Runtime card shows real compiled tiers without a full
        // page reload.
        const tierProbe = getRuntimeTierNames()
          .then((runtimeTierNames) => set({ runtimeTierNames, runtimeTierNamesError: undefined }))
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : t('ask.streamErrorGeneric');
            set({ runtimeTierNames: [], runtimeTierNamesError: message });
          });
        return Promise.all([loginProbe, tierProbe]).then(() => useNativeSessions.getState().refreshReadiness());
      })
      .catch(() => {
        // Best-effort — the optimistic local reset already applied.
      });
  },
  };
});
