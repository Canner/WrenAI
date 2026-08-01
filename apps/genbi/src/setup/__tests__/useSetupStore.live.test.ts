import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Force the dispatcher down the live branch regardless of `VITE_BFF_URL`.
vi.mock('@/bff/env', () => ({
  isBffEnabled: () => true,
}));

const getAdapterEnvStatus = vi.fn();
const getContextOverview = vi.fn();
const getRuntimeSettings = vi.fn();
const getSetupEnvFields = vi.fn();
const getSetupMode = vi.fn();
const getSetupSteps = vi.fn();
const postSetupCompileBind = vi.fn();
const postSetupConnectTurn = vi.fn();
const postSetupContextTurn = vi.fn();
const postSetupDecision = vi.fn();
const postSetupEnvValues = vi.fn();
const postSetupReset = vi.fn();
const postSetupResume = vi.fn();
const putRuntimeSettings = vi.fn();

vi.mock('@/bff/client', async (importOriginal) => {
  // `SetupDecisionRequiredError` is a real class the store checks with
  // `instanceof` — re-export the actual implementation (rather than a
  // reimplemented stand-in) so that check keeps working against this mock.
  const actual = await importOriginal<typeof import('@/bff/client')>();
  return {
    getAdapterEnvStatus: (...args: unknown[]) => getAdapterEnvStatus(...args),
    getContextOverview: (...args: unknown[]) => getContextOverview(...args),
    getRuntimeSettings: (...args: unknown[]) => getRuntimeSettings(...args),
    getSetupEnvFields: (...args: unknown[]) => getSetupEnvFields(...args),
    getSetupMode: (...args: unknown[]) => getSetupMode(...args),
    getSetupSteps: (...args: unknown[]) => getSetupSteps(...args),
    postSetupCompileBind: (...args: unknown[]) => postSetupCompileBind(...args),
    postSetupConnectTurn: (...args: unknown[]) => postSetupConnectTurn(...args),
    postSetupContextTurn: (...args: unknown[]) => postSetupContextTurn(...args),
    postSetupDecision: (...args: unknown[]) => postSetupDecision(...args),
    postSetupEnvValues: (...args: unknown[]) => postSetupEnvValues(...args),
    postSetupReset: (...args: unknown[]) => postSetupReset(...args),
    postSetupResume: (...args: unknown[]) => postSetupResume(...args),
    putRuntimeSettings: (...args: unknown[]) => putRuntimeSettings(...args),
    SetupDecisionRequiredError: actual.SetupDecisionRequiredError,
  };
});

// The store drives its connect-step turn through `setupStream` directly (not
// through an EventSource we'd have to fake) — mocking this one function lets
// each test push `worklog` / `event` / `error` / `done` frames by hand.
const setupStream = vi.fn();
vi.mock('@/session/stream', () => ({
  setupStream: (...args: unknown[]) => setupStream(...args),
}));

import { useSetupStore, type ConnectStreamState, type ContextStreamState } from '../useSetupStore';
import { fixtureInitialMessage, fixtureRuntimeSettings, fixtureSetupSteps } from '../fixtures';
import type { SetupStreamHandlers } from '@/session/stream';
import { SetupDecisionRequiredError } from '@/bff/client';

const initialConnectStream: ConnectStreamState = {
  workLog: [],
  streaming: false,
  needsInput: false,
  envFieldsLoading: false,
  submittingEnv: false,
};
const initialContextStream: ContextStreamState = { workLog: [], streaming: false, needsInput: false };

/** Steps as they'd be once the user has reached the connect step: step 1 done, step 2 current. */
const connectStepSteps = fixtureSetupSteps.map((step) => {
  if (step.key === 'runtime') return { ...step, state: 'done' as const };
  if (step.key === 'connect') return { ...step, state: 'current' as const };
  return step;
});

/** Steps as they'd be once the user has reached the context step: steps 1-2 done, step 3 current. */
const contextStepSteps = fixtureSetupSteps.map((step) => {
  if (step.key === 'runtime') return { ...step, state: 'done' as const };
  if (step.key === 'connect') return { ...step, state: 'done' as const };
  if (step.key === 'context') return { ...step, state: 'current' as const };
  return step;
});

function resetStore() {
  useSetupStore.setState(
    {
      steps: connectStepSteps,
      selectedStepKey: 'connect',
      runtimeSettings: fixtureRuntimeSettings,
      verifyGate: false,
      connectedSourceKey: undefined,
      messages: [fixtureInitialMessage],
      connectStream: initialConnectStream,
      contextStream: initialContextStream,
    },
    false,
  );
}

/** Same as `resetStore`, but seeded at the context step (connect already done). */
function resetStoreAtContext() {
  useSetupStore.setState(
    {
      steps: contextStepSteps,
      selectedStepKey: 'context',
      runtimeSettings: fixtureRuntimeSettings,
      verifyGate: false,
      connectedSourceKey: 'postgres',
      messages: [fixtureInitialMessage],
      connectStream: initialConnectStream,
      contextStream: initialContextStream,
    },
    false,
  );
}

/** Captures the handlers `setupStream` was last called with. */
function lastHandlers(): SetupStreamHandlers {
  const call = setupStream.mock.calls.at(-1) as [string, string, SetupStreamHandlers];
  return call[2];
}

beforeEach(() => {
  getAdapterEnvStatus.mockReset();
  getAdapterEnvStatus.mockResolvedValue({ anthropic: false, openaiCompatible: false });
  getContextOverview.mockReset();
  // Default: an empty project — refreshContextSummary reads only these fields.
  getContextOverview.mockResolvedValue({ models: [], measures: [], knowledge: { verifiedPairCount: 0 } });
  getRuntimeSettings.mockReset();
  getSetupEnvFields.mockReset();
  getSetupMode.mockReset();
  getSetupMode.mockResolvedValue({ mode: 'create' });
  getSetupSteps.mockReset();
  postSetupCompileBind.mockReset();
  postSetupConnectTurn.mockReset();
  postSetupContextTurn.mockReset();
  postSetupDecision.mockReset();
  postSetupEnvValues.mockReset();
  postSetupReset.mockReset();
  postSetupResume.mockReset();
  putRuntimeSettings.mockReset();
  setupStream.mockReset();
  setupStream.mockReturnValue(() => {});
  resetStore();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Steps as they'd be for the adopt flow, at the runtime step: the second step is 'adopt', not 'connect'. */
const adoptModeRuntimeSteps = fixtureSetupSteps.map((step) =>
  step.key === 'connect' ? { ...step, key: 'adopt' as const, title: 'Adopt an existing project' } : step,
);

describe('useSetupStore (live mode) — saveRuntimeSettings step advance is mode-aware', () => {
  it('create mode: advances runtime → connect (steps + selectedStepKey)', async () => {
    putRuntimeSettings.mockResolvedValueOnce({ ...fixtureRuntimeSettings, warnings: [] });
    useSetupStore.setState({ steps: fixtureSetupSteps, selectedStepKey: 'runtime' }, false);

    useSetupStore.getState().saveRuntimeSettings();

    await vi.waitFor(() => {
      const state = useSetupStore.getState();
      expect(state.steps.find((s) => s.key === 'runtime')?.state).toBe('done');
      expect(state.steps.find((s) => s.key === 'connect')?.state).toBe('current');
      expect(state.selectedStepKey).toBe('connect');
    });
  });

  it('adopt mode: advances runtime → adopt (steps + selectedStepKey), not connect', async () => {
    putRuntimeSettings.mockResolvedValueOnce({ ...fixtureRuntimeSettings, warnings: [] });
    useSetupStore.setState({ steps: adoptModeRuntimeSteps, selectedStepKey: 'runtime' }, false);

    useSetupStore.getState().saveRuntimeSettings();

    await vi.waitFor(() => {
      const state = useSetupStore.getState();
      expect(state.steps.find((s) => s.key === 'runtime')?.state).toBe('done');
      expect(state.steps.find((s) => s.key === 'adopt')?.state).toBe('current');
      expect(state.selectedStepKey).toBe('adopt');
    });
  });
});

describe('useSetupStore (live mode) — connectDataSource terminal gating', () => {
  it('an "ok" terminal advances connect → context and records the connected source', async () => {
    postSetupConnectTurn.mockResolvedValueOnce({ sessionId: 's1', turnId: 't1' });

    useSetupStore.getState().connectDataSource('my-project', 'postgres');

    await vi.waitFor(() => expect(setupStream).toHaveBeenCalledWith('s1', 't1', expect.anything()));
    expect(useSetupStore.getState().connectStream.streaming).toBe(true);

    lastHandlers().onEvent?.({ id: 'e1', kind: 'setup_status', status: 'ok', message: 'Connected.' });

    const state = useSetupStore.getState();
    expect(state.steps.find((s) => s.key === 'connect')?.state).toBe('done');
    expect(state.steps.find((s) => s.key === 'context')?.state).toBe('current');
    expect(state.selectedStepKey).toBe('context');
    expect(state.connectedSourceKey).toBe('postgres');
    expect(state.connectStream.streaming).toBe(false);
    expect(state.connectStream.needsInput).toBe(false);
    expect(state.connectStream.terminal?.status).toBe('ok');
  });

  it('a "needs_input" terminal stays on connect and flags needsInput without advancing', async () => {
    postSetupConnectTurn.mockResolvedValueOnce({ sessionId: 's1', turnId: 't1' });

    useSetupStore.getState().connectDataSource('my-project', 'postgres');
    await vi.waitFor(() => expect(setupStream).toHaveBeenCalled());

    lastHandlers().onEvent?.({
      id: 'e1',
      kind: 'setup_status',
      status: 'needs_input',
      message: 'Fill in POSTGRES_PASSWORD in .env and continue.',
    });

    const state = useSetupStore.getState();
    expect(state.steps.find((s) => s.key === 'connect')?.state).toBe('current');
    expect(state.selectedStepKey).toBe('connect');
    expect(state.connectedSourceKey).toBeUndefined();
    expect(state.connectStream.needsInput).toBe(true);
    expect(state.connectStream.streaming).toBe(false);
    // The raw backend guidance is preserved verbatim in the transcript.
    expect(state.messages.at(-1)?.text).toBe('Fill in POSTGRES_PASSWORD in .env and continue.');
  });

  it('an error frame sets connectStream.error and does not advance the step', async () => {
    postSetupConnectTurn.mockResolvedValueOnce({ sessionId: 's1', turnId: 't1' });

    useSetupStore.getState().connectDataSource('my-project', 'postgres');
    await vi.waitFor(() => expect(setupStream).toHaveBeenCalled());

    lastHandlers().onError?.('The harness stream reported an error.');

    const state = useSetupStore.getState();
    expect(state.steps.find((s) => s.key === 'connect')?.state).toBe('current');
    expect(state.connectStream.error).toBe('The harness stream reported an error.');
    expect(state.connectStream.streaming).toBe(false);
    expect(state.connectStream.needsInput).toBe(false);
  });

  it('resumeConnect on "ok" clears needsInput and advances connect → context', async () => {
    postSetupConnectTurn.mockResolvedValueOnce({ sessionId: 's1', turnId: 't1' });
    useSetupStore.getState().connectDataSource('my-project', 'postgres');
    await vi.waitFor(() => expect(setupStream).toHaveBeenCalled());
    lastHandlers().onEvent?.({ id: 'e1', kind: 'setup_status', status: 'needs_input', message: 'Fill .env.' });
    expect(useSetupStore.getState().connectStream.needsInput).toBe(true);

    postSetupResume.mockResolvedValueOnce({ sessionId: 's1', turnId: 't2' });
    useSetupStore.getState().resumeConnect();

    await vi.waitFor(() => expect(setupStream).toHaveBeenCalledWith('s1', 't2', expect.anything()));
    lastHandlers().onEvent?.({ id: 'e2', kind: 'setup_status', status: 'ok', message: 'Connected.' });

    const state = useSetupStore.getState();
    expect(state.connectStream.needsInput).toBe(false);
    expect(state.steps.find((s) => s.key === 'connect')?.state).toBe('done');
    expect(state.selectedStepKey).toBe('context');
    expect(state.connectedSourceKey).toBe('postgres');
  });

  it('connectDataSource surfaces a failed POST as connectStream.error without advancing', async () => {
    postSetupConnectTurn.mockRejectedValueOnce(new Error('invalid projectName'));

    useSetupStore.getState().connectDataSource('../escape', 'postgres');

    await vi.waitFor(() => expect(useSetupStore.getState().connectStream.error).toBe('invalid projectName'));
    const state = useSetupStore.getState();
    expect(state.steps.find((s) => s.key === 'connect')?.state).toBe('current');
    expect(setupStream).not.toHaveBeenCalled();
  });

  it('resumeConnect immediately clears a stale needsInput/terminal from the prior pause', async () => {
    postSetupConnectTurn.mockResolvedValueOnce({ sessionId: 's1', turnId: 't1' });
    useSetupStore.getState().connectDataSource('my-project', 'postgres');
    await vi.waitFor(() => expect(setupStream).toHaveBeenCalled());
    lastHandlers().onEvent?.({ id: 'e1', kind: 'setup_status', status: 'needs_input', message: 'Fill .env.' });

    expect(useSetupStore.getState().connectStream.needsInput).toBe(true);
    expect(useSetupStore.getState().connectStream.terminal).toBeDefined();

    postSetupResume.mockResolvedValueOnce({ sessionId: 's1', turnId: 't2' });
    useSetupStore.getState().resumeConnect();

    // Synchronous, pre-await: the restart itself must reset needsInput/terminal
    // (not just error) so the UI doesn't show a stale "needs input" banner
    // while a fresh turn is already streaming.
    const state = useSetupStore.getState();
    expect(state.connectStream.streaming).toBe(true);
    expect(state.connectStream.needsInput).toBe(false);
    expect(state.connectStream.terminal).toBeUndefined();
    expect(state.connectStream.sourceType).toBe('postgres');
  });

  it('starting a new connect turn unsubscribes a still-open prior turn before opening its own', async () => {
    const unsubscribeFirst = vi.fn();
    const unsubscribeSecond = vi.fn();
    setupStream.mockReturnValueOnce(unsubscribeFirst).mockReturnValueOnce(unsubscribeSecond);

    postSetupConnectTurn.mockResolvedValueOnce({ sessionId: 's1', turnId: 't1' });
    useSetupStore.getState().connectDataSource('my-project', 'postgres');
    await vi.waitFor(() => expect(setupStream).toHaveBeenCalledTimes(1));
    expect(useSetupStore.getState().connectStream.activeUnsubscribe).toBe(unsubscribeFirst);

    // The first turn never reached a terminal (still "streaming") — a second
    // click/call must not leave it dangling to later stomp this new turn's
    // state; it must be torn down before the new turn starts.
    postSetupConnectTurn.mockResolvedValueOnce({ sessionId: 's2', turnId: 't3' });
    useSetupStore.getState().connectDataSource('my-project', 'postgres');

    expect(unsubscribeFirst).toHaveBeenCalledTimes(1);

    await vi.waitFor(() => expect(setupStream).toHaveBeenCalledTimes(2));
    expect(useSetupStore.getState().connectStream.activeUnsubscribe).toBe(unsubscribeSecond);
  });

  it('starting a new resumeConnect turn unsubscribes a still-open prior resume before opening its own', async () => {
    postSetupConnectTurn.mockResolvedValueOnce({ sessionId: 's1', turnId: 't1' });
    useSetupStore.getState().connectDataSource('my-project', 'postgres');
    await vi.waitFor(() => expect(setupStream).toHaveBeenCalledTimes(1));
    lastHandlers().onEvent?.({ id: 'e1', kind: 'setup_status', status: 'needs_input', message: 'Fill .env.' });

    const unsubscribeResume1 = vi.fn();
    const unsubscribeResume2 = vi.fn();
    setupStream.mockReturnValueOnce(unsubscribeResume1).mockReturnValueOnce(unsubscribeResume2);

    postSetupResume.mockResolvedValueOnce({ sessionId: 's1', turnId: 't2' });
    useSetupStore.getState().resumeConnect();
    await vi.waitFor(() => expect(setupStream).toHaveBeenCalledTimes(2));
    expect(useSetupStore.getState().connectStream.activeUnsubscribe).toBe(unsubscribeResume1);

    postSetupResume.mockResolvedValueOnce({ sessionId: 's1', turnId: 't4' });
    useSetupStore.getState().resumeConnect();

    expect(unsubscribeResume1).toHaveBeenCalledTimes(1);

    await vi.waitFor(() => expect(setupStream).toHaveBeenCalledTimes(3));
    expect(useSetupStore.getState().connectStream.activeUnsubscribe).toBe(unsubscribeResume2);
  });
});

describe('useSetupStore (live mode) — the in-UI credential form (fetchConnectEnvFields / submitConnectEnv)', () => {
  it('fetchConnectEnvFields populates connectStream.envFields on success', async () => {
    getSetupEnvFields.mockResolvedValueOnce({
      fields: [
        { key: 'PGHOST', secret: false },
        { key: 'PGPASSWORD', secret: true },
      ],
    });

    useSetupStore.getState().fetchConnectEnvFields();

    await vi.waitFor(() => expect(useSetupStore.getState().connectStream.envFields).toBeDefined());
    expect(useSetupStore.getState().connectStream.envFields).toEqual([
      { key: 'PGHOST', secret: false },
      { key: 'PGPASSWORD', secret: true },
    ]);
    expect(useSetupStore.getState().connectStream.envFieldsError).toBeUndefined();
  });

  it('fetchConnectEnvFields sets envFieldsError (not a hard error) when the GET fails', async () => {
    getSetupEnvFields.mockRejectedValueOnce(new Error('no connect turn is on record'));

    useSetupStore.getState().fetchConnectEnvFields();

    await vi.waitFor(() =>
      expect(useSetupStore.getState().connectStream.envFieldsError).toBe('no connect turn is on record'),
    );
    expect(useSetupStore.getState().connectStream.envFields).toBeUndefined();
  });

  it('submitConnectEnv POSTs the form values, then calls resumeConnect to continue the paused turn', async () => {
    postSetupEnvValues.mockResolvedValueOnce({ ok: true });
    postSetupResume.mockResolvedValueOnce({ sessionId: 's1', turnId: 't2' });

    useSetupStore.getState().submitConnectEnv({ PGHOST: 'localhost', PGPASSWORD: 'secret' });

    await vi.waitFor(() => expect(postSetupResume).toHaveBeenCalledTimes(1));
    expect(postSetupEnvValues).toHaveBeenCalledWith({ PGHOST: 'localhost', PGPASSWORD: 'secret' });
    await vi.waitFor(() => expect(useSetupStore.getState().connectStream.submittingEnv).toBe(false));
    expect(useSetupStore.getState().connectStream.streaming).toBe(true);
  });

  it('submitConnectEnv surfaces a failed POST as connectStream.error without calling resumeConnect', async () => {
    postSetupEnvValues.mockRejectedValueOnce(new Error('projectName resolves outside the workspace root'));

    useSetupStore.getState().submitConnectEnv({ PGHOST: 'localhost' });

    await vi.waitFor(() =>
      expect(useSetupStore.getState().connectStream.error).toBe('projectName resolves outside the workspace root'),
    );
    expect(useSetupStore.getState().connectStream.submittingEnv).toBe(false);
    expect(postSetupResume).not.toHaveBeenCalled();
  });
});

describe('useSetupStore (live mode) — buildContext terminal gating', () => {
  beforeEach(() => {
    resetStoreAtContext();
  });

  it('an "ok" terminal advances context → bind', async () => {
    postSetupContextTurn.mockResolvedValueOnce({ sessionId: 's1', turnId: 't1' });

    useSetupStore.getState().buildContext();

    await vi.waitFor(() => expect(setupStream).toHaveBeenCalledWith('s1', 't1', expect.anything()));
    expect(useSetupStore.getState().contextStream.streaming).toBe(true);

    lastHandlers().onEvent?.({ id: 'e1', kind: 'setup_status', status: 'ok', message: 'Context built.' });

    const state = useSetupStore.getState();
    expect(state.steps.find((s) => s.key === 'context')?.state).toBe('done');
    expect(state.steps.find((s) => s.key === 'bind')?.state).toBe('current');
    expect(state.selectedStepKey).toBe('bind');
    expect(state.contextStream.streaming).toBe(false);
    expect(state.contextStream.needsInput).toBe(false);
    expect(state.contextStream.terminal?.status).toBe('ok');
  });

  it('populates the context summary from the real project overview after a successful build (not fixture numbers)', async () => {
    postSetupContextTurn.mockResolvedValueOnce({ sessionId: 's1', turnId: 't1' });
    getContextOverview.mockResolvedValueOnce({
      models: [{}, {}, {}],
      measures: [{}, {}],
      knowledge: { verifiedPairCount: 1 },
    });
    // Before build: nothing discovered.
    expect(useSetupStore.getState().contextSummary).toEqual({ models: 0, measures: 0, knowledgeNotes: 0 });

    useSetupStore.getState().buildContext();
    await vi.waitFor(() => expect(setupStream).toHaveBeenCalled());
    lastHandlers().onEvent?.({ id: 'e1', kind: 'setup_status', status: 'ok', message: 'Context built.' });

    await vi.waitFor(() => {
      expect(useSetupStore.getState().contextSummary).toEqual({ models: 3, measures: 2, knowledgeNotes: 1 });
    });
  });

  it('a "needs_input" terminal stays on context and flags needsInput without advancing', async () => {
    postSetupContextTurn.mockResolvedValueOnce({ sessionId: 's1', turnId: 't1' });

    useSetupStore.getState().buildContext();
    await vi.waitFor(() => expect(setupStream).toHaveBeenCalled());

    lastHandlers().onEvent?.({
      id: 'e1',
      kind: 'setup_status',
      status: 'needs_input',
      message: 'Need more information before context can be built.',
    });

    const state = useSetupStore.getState();
    expect(state.steps.find((s) => s.key === 'context')?.state).toBe('current');
    expect(state.selectedStepKey).toBe('context');
    expect(state.contextStream.needsInput).toBe(true);
    expect(state.contextStream.streaming).toBe(false);
    expect(state.messages.at(-1)?.text).toBe('Need more information before context can be built.');
  });

  it('an error frame sets contextStream.error and does not advance the step', async () => {
    postSetupContextTurn.mockResolvedValueOnce({ sessionId: 's1', turnId: 't1' });

    useSetupStore.getState().buildContext();
    await vi.waitFor(() => expect(setupStream).toHaveBeenCalled());

    lastHandlers().onError?.('The harness stream reported an error.');

    const state = useSetupStore.getState();
    expect(state.steps.find((s) => s.key === 'context')?.state).toBe('current');
    expect(state.contextStream.error).toBe('The harness stream reported an error.');
    expect(state.contextStream.streaming).toBe(false);
    expect(state.contextStream.needsInput).toBe(false);
  });

  it('buildContext surfaces a failed POST as contextStream.error without advancing', async () => {
    postSetupContextTurn.mockRejectedValueOnce(new Error('setup not configured'));

    useSetupStore.getState().buildContext();

    await vi.waitFor(() => expect(useSetupStore.getState().contextStream.error).toBe('setup not configured'));
    const state = useSetupStore.getState();
    expect(state.steps.find((s) => s.key === 'context')?.state).toBe('current');
    expect(setupStream).not.toHaveBeenCalled();
  });

  it('starting a new context turn unsubscribes a still-open prior turn before opening its own', async () => {
    const unsubscribeFirst = vi.fn();
    const unsubscribeSecond = vi.fn();
    setupStream.mockReturnValueOnce(unsubscribeFirst).mockReturnValueOnce(unsubscribeSecond);

    postSetupContextTurn.mockResolvedValueOnce({ sessionId: 's1', turnId: 't1' });
    useSetupStore.getState().buildContext();
    await vi.waitFor(() => expect(setupStream).toHaveBeenCalledTimes(1));
    expect(useSetupStore.getState().contextStream.activeUnsubscribe).toBe(unsubscribeFirst);

    // The first turn never reached a terminal (still "streaming") — a second
    // click/call must not leave it dangling to later stomp this new turn's
    // state; it must be torn down before the new turn starts.
    postSetupContextTurn.mockResolvedValueOnce({ sessionId: 's2', turnId: 't3' });
    useSetupStore.getState().buildContext();

    expect(unsubscribeFirst).toHaveBeenCalledTimes(1);

    await vi.waitFor(() => expect(setupStream).toHaveBeenCalledTimes(2));
    expect(useSetupStore.getState().contextStream.activeUnsubscribe).toBe(unsubscribeSecond);
  });
});

describe('useSetupStore (live mode) — hydrate resumes the in-progress step', () => {
  it('restores selectedStepKey from the server steps so a reload does not snap back to runtime', async () => {
    // Pristine store, as after a full page reload mid-flow: runtime current,
    // the rest todo, showing the runtime card.
    useSetupStore.setState({ steps: fixtureSetupSteps, selectedStepKey: 'runtime' }, false);
    getSetupSteps.mockResolvedValueOnce(contextStepSteps);
    getRuntimeSettings.mockResolvedValueOnce(fixtureRuntimeSettings);

    useSetupStore.getState().hydrate();

    await vi.waitFor(() => {
      expect(useSetupStore.getState().selectedStepKey).toBe('context');
    });
    expect(useSetupStore.getState().steps).toEqual(contextStepSteps);
  });

  it('picks the LAST current step when the server reports runtime "current" alongside the real one (pre-fix double-current)', async () => {
    useSetupStore.setState({ steps: fixtureSetupSteps, selectedStepKey: 'runtime' }, false);
    // runtime stays 'current' (the server bug), connect done, context current.
    const doubleCurrent = fixtureSetupSteps.map((step) =>
      step.key === 'connect'
        ? { ...step, state: 'done' as const }
        : step.key === 'context'
          ? { ...step, state: 'current' as const }
          : step,
    );
    getSetupSteps.mockResolvedValueOnce(doubleCurrent);
    getRuntimeSettings.mockResolvedValueOnce(fixtureRuntimeSettings);

    useSetupStore.getState().hydrate();

    await vi.waitFor(() => {
      expect(useSetupStore.getState().selectedStepKey).toBe('context');
    });
  });
});

describe('useSetupStore (live mode) — connect step name_conflict decision (409 pre-dispatch)', () => {
  it('a 409 name_conflict rejection populates connectStream.decision without opening a stream', async () => {
    postSetupConnectTurn.mockRejectedValueOnce(
      new SetupDecisionRequiredError('s1', {
        kind: 'name_conflict',
        options: [
          { id: 'rename', label: 'Rename' },
          { id: 'clean', label: 'Start clean' },
          { id: 'cancel', label: 'Cancel' },
        ],
        detail: 'A project named "my-project" already exists.',
      }),
    );

    useSetupStore.getState().connectDataSource('my-project', 'postgres');

    await vi.waitFor(() => expect(useSetupStore.getState().connectStream.decision).toBeDefined());
    const state = useSetupStore.getState();
    expect(state.connectStream.decision?.kind).toBe('name_conflict');
    expect(state.connectStream.sessionId).toBe('s1');
    expect(state.connectStream.streaming).toBe(false);
    expect(state.steps.find((s) => s.key === 'connect')?.state).toBe('current');
    expect(setupStream).not.toHaveBeenCalled();
    expect(state.messages.at(-1)?.text).toBe('A project named "my-project" already exists.');
  });

  it('resolveConnectDecision("clean") posts the choice and streams the returned turn like a fresh connect', async () => {
    postSetupConnectTurn.mockRejectedValueOnce(
      new SetupDecisionRequiredError('s1', {
        kind: 'name_conflict',
        options: [
          { id: 'rename', label: 'Rename' },
          { id: 'clean', label: 'Start clean' },
          { id: 'cancel', label: 'Cancel' },
        ],
      }),
    );
    useSetupStore.getState().connectDataSource('my-project', 'postgres');
    await vi.waitFor(() => expect(useSetupStore.getState().connectStream.decision).toBeDefined());

    postSetupDecision.mockResolvedValueOnce({ sessionId: 's1', turnId: 't9' });
    useSetupStore.getState().resolveConnectDecision('clean');

    await vi.waitFor(() => expect(postSetupDecision).toHaveBeenCalledWith('s1', 'clean'));
    await vi.waitFor(() => expect(setupStream).toHaveBeenCalledWith('s1', 't9', expect.anything()));
    expect(useSetupStore.getState().connectStream.decision).toBeUndefined();

    lastHandlers().onEvent?.({ id: 'e1', kind: 'setup_status', status: 'ok', message: 'Connected.' });
    expect(useSetupStore.getState().connectedSourceKey).toBe('postgres');
  });

  it('resolveConnectDecision("rename") clears the decision and resets the form for a new name, without posting a turn', async () => {
    postSetupConnectTurn.mockRejectedValueOnce(
      new SetupDecisionRequiredError('s1', {
        kind: 'name_conflict',
        options: [
          { id: 'rename', label: 'Rename' },
          { id: 'cancel', label: 'Cancel' },
        ],
      }),
    );
    useSetupStore.getState().connectDataSource('my-project', 'postgres');
    await vi.waitFor(() => expect(useSetupStore.getState().connectStream.decision).toBeDefined());

    postSetupDecision.mockResolvedValueOnce({ sessionId: 's1', action: 'rename' });
    useSetupStore.getState().resolveConnectDecision('rename');

    await vi.waitFor(() => expect(useSetupStore.getState().connectStream.decision).toBeUndefined());
    const state = useSetupStore.getState();
    expect(state.connectStream.streaming).toBe(false);
    expect(state.connectStream.sourceType).toBe('postgres');
    expect(setupStream).not.toHaveBeenCalled();
  });

  it('resolveConnectDecision("cancel") fully resets the connect stream, without posting a turn', async () => {
    postSetupConnectTurn.mockRejectedValueOnce(
      new SetupDecisionRequiredError('s1', {
        kind: 'name_conflict',
        options: [
          { id: 'rename', label: 'Rename' },
          { id: 'cancel', label: 'Cancel' },
        ],
      }),
    );
    useSetupStore.getState().connectDataSource('my-project', 'postgres');
    await vi.waitFor(() => expect(useSetupStore.getState().connectStream.decision).toBeDefined());

    postSetupDecision.mockResolvedValueOnce({ sessionId: 's1', action: 'cancel' });
    useSetupStore.getState().resolveConnectDecision('cancel');

    await vi.waitFor(() => expect(useSetupStore.getState().connectStream.decision).toBeUndefined());
    const state = useSetupStore.getState();
    expect(state.connectStream.sourceType).toBeUndefined();
    expect(state.connectStream.streaming).toBe(false);
    expect(setupStream).not.toHaveBeenCalled();
  });
});

describe('useSetupStore (live mode) — context step max_turns_continue decision (mid-stream)', () => {
  beforeEach(() => {
    resetStoreAtContext();
  });

  it('a "needs_decision" frame populates contextStream.decision and stops streaming', async () => {
    postSetupContextTurn.mockResolvedValueOnce({ sessionId: 's1', turnId: 't1' });
    useSetupStore.getState().buildContext();
    await vi.waitFor(() => expect(setupStream).toHaveBeenCalled());

    lastHandlers().onEvent?.({
      id: 'e1',
      kind: 'setup_status',
      status: 'needs_decision',
      message: 'Hit the max-turns limit.',
      decision: {
        kind: 'max_turns_continue',
        options: [
          { id: 'continue', label: 'Continue' },
          { id: 'stop', label: 'Stop' },
        ],
        detail: 'The agent has used its turn budget. Continue or stop here?',
      },
    });

    const state = useSetupStore.getState();
    expect(state.contextStream.decision?.kind).toBe('max_turns_continue');
    expect(state.contextStream.sessionId).toBe('s1');
    expect(state.contextStream.streaming).toBe(false);
    expect(state.steps.find((s) => s.key === 'context')?.state).toBe('current');
    expect(state.messages.at(-1)?.text).toBe('The agent has used its turn budget. Continue or stop here?');
  });

  it('a terminal "ok" event finalizes any step still "running" in the persisted trace, so it never displays stuck "(running)"', async () => {
    postSetupContextTurn.mockResolvedValueOnce({ sessionId: 's1', turnId: 't1' });
    useSetupStore.getState().buildContext();
    await vi.waitFor(() => expect(setupStream).toHaveBeenCalled());

    // The terminal event arrives before this step's own closing `worklog`
    // frame — a real timing case, not a test artifact — leaving the live
    // slot with a step still marked 'running'.
    lastHandlers().onWorkLog?.([
      { id: 'step-1', label: 'Scanning models', state: 'done', kind: 'tool' },
      { id: 'step-2', label: 'Deriving measures', state: 'running', kind: 'tool' },
    ]);

    lastHandlers().onEvent?.({ id: 'e1', kind: 'setup_status', status: 'ok', message: 'Context built.' });

    const persistedWorkLog = useSetupStore.getState().messages.at(-1)?.workLog;
    expect(persistedWorkLog).toBeDefined();
    expect(persistedWorkLog?.some((step) => step.state === 'running')).toBe(false);
    expect(persistedWorkLog).toEqual([
      { id: 'step-1', label: 'Scanning models', state: 'done', kind: 'tool' },
      { id: 'step-2', label: 'Deriving measures', state: 'done', kind: 'tool' },
    ]);
  });

  it('a terminal "needs_decision" event finalizes any step still "running" in the persisted trace as errored', async () => {
    postSetupContextTurn.mockResolvedValueOnce({ sessionId: 's1', turnId: 't1' });
    useSetupStore.getState().buildContext();
    await vi.waitFor(() => expect(setupStream).toHaveBeenCalled());

    lastHandlers().onWorkLog?.([{ id: 'step-1', label: 'Scanning models', state: 'running', kind: 'tool' }]);

    lastHandlers().onEvent?.({
      id: 'e1',
      kind: 'setup_status',
      status: 'needs_decision',
      message: 'Hit the max-turns limit.',
      decision: {
        kind: 'max_turns_continue',
        options: [
          { id: 'continue', label: 'Continue' },
          { id: 'stop', label: 'Stop' },
        ],
        detail: 'The agent has used its turn budget. Continue or stop here?',
      },
    });

    const persistedWorkLog = useSetupStore.getState().messages.at(-1)?.workLog;
    expect(persistedWorkLog?.some((step) => step.state === 'running')).toBe(false);
    expect(persistedWorkLog?.[0]?.state).toBe('error');
  });

  it('resolveContextDecision("continue") posts the choice and streams the returned turn', async () => {
    postSetupContextTurn.mockResolvedValueOnce({ sessionId: 's1', turnId: 't1' });
    useSetupStore.getState().buildContext();
    await vi.waitFor(() => expect(setupStream).toHaveBeenCalled());
    lastHandlers().onEvent?.({
      id: 'e1',
      kind: 'setup_status',
      status: 'needs_decision',
      message: 'Hit the max-turns limit.',
      decision: {
        kind: 'max_turns_continue',
        options: [
          { id: 'continue', label: 'Continue' },
          { id: 'stop', label: 'Stop' },
        ],
      },
    });

    postSetupDecision.mockResolvedValueOnce({ sessionId: 's1', turnId: 't2' });
    useSetupStore.getState().resolveContextDecision('continue');

    await vi.waitFor(() => expect(postSetupDecision).toHaveBeenCalledWith('s1', 'continue'));
    await vi.waitFor(() => expect(setupStream).toHaveBeenCalledWith('s1', 't2', expect.anything()));
    expect(useSetupStore.getState().contextStream.decision).toBeUndefined();

    lastHandlers().onEvent?.({ id: 'e2', kind: 'setup_status', status: 'ok', message: 'Context built.' });
    expect(useSetupStore.getState().steps.find((s) => s.key === 'context')?.state).toBe('done');
  });

  it('resolveContextDecision("continue") resets contextStream.workLog before the resumed turn streams, so turn 1\'s finished steps don\'t linger beside turn 2\'s', async () => {
    postSetupContextTurn.mockResolvedValueOnce({ sessionId: 's1', turnId: 't1' });
    useSetupStore.getState().buildContext();
    await vi.waitFor(() => expect(setupStream).toHaveBeenCalled());

    // Turn 1 makes progress before hitting the turn budget.
    lastHandlers().onWorkLog?.([{ id: 'step-1', label: 'Scanning models', state: 'done', kind: 'tool' }]);
    expect(useSetupStore.getState().contextStream.workLog).toHaveLength(1);

    lastHandlers().onEvent?.({
      id: 'e1',
      kind: 'setup_status',
      status: 'needs_decision',
      message: 'Hit the max-turns limit.',
      decision: {
        kind: 'max_turns_continue',
        options: [
          { id: 'continue', label: 'Continue' },
          { id: 'stop', label: 'Stop' },
        ],
      },
    });
    // Turn 1's trace is persisted onto the needs_decision transcript message...
    expect(useSetupStore.getState().messages.at(-1)?.workLog).toHaveLength(1);

    postSetupDecision.mockResolvedValueOnce({ sessionId: 's1', turnId: 't2' });
    useSetupStore.getState().resolveContextDecision('continue');
    await vi.waitFor(() => expect(setupStream).toHaveBeenCalledWith('s1', 't2', expect.anything()));

    // ...and the live slot is reset to empty before turn 2's own frames arrive,
    // so it doesn't render turn 1's steps alongside turn 2's.
    expect(useSetupStore.getState().contextStream.workLog).toEqual([]);

    lastHandlers().onWorkLog?.([{ id: 'step-2', label: 'Deriving measures', state: 'running', kind: 'tool' }]);
    expect(useSetupStore.getState().contextStream.workLog).toEqual([
      { id: 'step-2', label: 'Deriving measures', state: 'running', kind: 'tool' },
    ]);
  });

  it('resolveContextDecision("stop") posts the choice and routes the returned stopped event through the normal needs_input path (no new stream)', async () => {
    postSetupContextTurn.mockResolvedValueOnce({ sessionId: 's1', turnId: 't1' });
    useSetupStore.getState().buildContext();
    await vi.waitFor(() => expect(setupStream).toHaveBeenCalled());
    lastHandlers().onEvent?.({
      id: 'e1',
      kind: 'setup_status',
      status: 'needs_decision',
      message: 'Hit the max-turns limit.',
      decision: {
        kind: 'max_turns_continue',
        options: [
          { id: 'continue', label: 'Continue' },
          { id: 'stop', label: 'Stop' },
        ],
      },
    });
    const streamCallsBeforeStop = setupStream.mock.calls.length;

    postSetupDecision.mockResolvedValueOnce({
      sessionId: 's1',
      status: 'stopped',
      event: { id: 'e2', kind: 'setup_status', status: 'needs_input', message: 'Stopped by user request.' },
    });
    useSetupStore.getState().resolveContextDecision('stop');

    await vi.waitFor(() => expect(useSetupStore.getState().contextStream.needsInput).toBe(true));
    const state = useSetupStore.getState();
    expect(state.contextStream.decision).toBeUndefined();
    expect(state.contextStream.streaming).toBe(false);
    expect(state.steps.find((s) => s.key === 'context')?.state).toBe('current');
    expect(state.messages.at(-1)?.text).toBe('Stopped by user request.');
    // No second stream was opened — the "stop" response is a plain event, not a new turn.
    expect(setupStream.mock.calls.length).toBe(streamCallsBeforeStop);
  });
});

describe('useSetupStore (live mode) — resetSetup', () => {
  it('tears down state to first-run, closes an in-flight stream, and calls postSetupReset', async () => {
    const unsub = vi.fn();
    postSetupReset.mockResolvedValueOnce({
      ok: true,
      steps: fixtureSetupSteps,
      runtimeSettings: fixtureRuntimeSettings,
    });
    // Dirty the store: advanced steps, a connected source, an open stream.
    useSetupStore.setState(
      {
        steps: contextStepSteps,
        selectedStepKey: 'context',
        verifyGate: true,
        connectedSourceKey: 'postgres',
        connectStream: { ...initialConnectStream, activeUnsubscribe: unsub },
      },
      false,
    );

    useSetupStore.getState().resetSetup();

    // Optimistic local reset is synchronous.
    const s = useSetupStore.getState();
    expect(unsub).toHaveBeenCalledTimes(1);
    expect(s.selectedStepKey).toBe('runtime');
    expect(s.verifyGate).toBe(false);
    expect(s.connectedSourceKey).toBeUndefined();
    expect(s.steps.some((st) => st.state === 'done')).toBe(false);
    expect(postSetupReset).toHaveBeenCalledTimes(1);
  });
});
