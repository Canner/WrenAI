import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { AppRoutes } from '@/app/App';

// Force the dispatcher down the live branch regardless of `VITE_BFF_URL`.
vi.mock('@/bff/env', () => ({
  isBffEnabled: () => true,
}));

const getAdapterEnvStatus = vi.fn();
const getSubscriptionLoginStatus = vi.fn();
const getSubscriptionModelCatalog = vi.fn();
const getContextOverview = vi.fn();
const getRuntimeSettings = vi.fn();
const getRuntimeSettingsReadiness = vi.fn();
const getRuntimeTierNames = vi.fn();
const getSetupEnvFields = vi.fn();
const getSetupSourceCatalog = vi.fn();
const getSetupMode = vi.fn();
const getSetupRecovery = vi.fn();
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
  // `instanceof` — re-export the actual implementation so that check keeps
  // working against this mock (see the sibling store-level test file).
  const actual = await importOriginal<typeof import('@/bff/client')>();
  return {
    getAdapterEnvStatus: (...args: unknown[]) => getAdapterEnvStatus(...args),
    getSubscriptionLoginStatus: (...args: unknown[]) => getSubscriptionLoginStatus(...args),
    getSubscriptionModelCatalog: (...args: unknown[]) => getSubscriptionModelCatalog(...args),
    getContextOverview: (...args: unknown[]) => getContextOverview(...args),
    getRuntimeSettings: (...args: unknown[]) => getRuntimeSettings(...args),
    getRuntimeSettingsReadiness: (...args: unknown[]) => getRuntimeSettingsReadiness(...args),
    getRuntimeTierNames: (...args: unknown[]) => getRuntimeTierNames(...args),
    getSetupEnvFields: (...args: unknown[]) => getSetupEnvFields(...args),
    getSetupSourceCatalog: (...args: unknown[]) => getSetupSourceCatalog(...args),
    getSetupMode: (...args: unknown[]) => getSetupMode(...args),
    getSetupRecovery: (...args: unknown[]) => getSetupRecovery(...args),
    getSetupSteps: (...args: unknown[]) => getSetupSteps(...args),
    postSetupCompileBind: (...args: unknown[]) => postSetupCompileBind(...args),
    postSetupConnectTurn: (...args: unknown[]) => postSetupConnectTurn(...args),
    postSetupContextTurn: (...args: unknown[]) => postSetupContextTurn(...args),
    postSetupDecision: (...args: unknown[]) => postSetupDecision(...args),
    postSetupEnvValues: (...args: unknown[]) => postSetupEnvValues(...args),
    postSetupReset: (...args: unknown[]) => postSetupReset(...args),
    postSetupResume: (...args: unknown[]) => postSetupResume(...args),
    putRuntimeSettings: (...args: unknown[]) => putRuntimeSettings(...args),
    getNativeSessionReadiness: vi.fn().mockResolvedValue({ setup: { scopeKind: 'bootstrap', available: false, reason: 'native sessions are unavailable in this test', vendors: { claude: { available: false }, codex: { available: false } } } }),
    createNativeSession: vi.fn(),
    SetupDecisionRequiredError: actual.SetupDecisionRequiredError,
  };
});

const setupStream = vi.fn();
vi.mock('@/session/stream', () => ({
  setupStream: (...args: unknown[]) => setupStream(...args),
}));

import { useSetupStore, type ConnectStreamState, type ContextStreamState } from '../useSetupStore';
import { fixtureInitialMessage, fixtureRuntimeSettings, fixtureSetupSteps } from '../fixtures';
import { SetupDecisionRequiredError } from '@/bff/client';
import type { SetupStreamHandlers } from '@/session/stream';

const initialConnectStream: ConnectStreamState = {
  workLog: [],
  streaming: false,
  needsInput: false,
  envFieldsLoading: false,
  submittingEnv: false,
};
const initialContextStream: ContextStreamState = { workLog: [], streaming: false, needsInput: false };

const connectStepSteps = fixtureSetupSteps.map((step) => {
  if (step.key === 'runtime') return { ...step, state: 'done' as const };
  if (step.key === 'connect') return { ...step, state: 'current' as const };
  return step;
});

const contextStepSteps = fixtureSetupSteps.map((step) => {
  if (step.key === 'runtime') return { ...step, state: 'done' as const };
  if (step.key === 'connect') return { ...step, state: 'done' as const };
  if (step.key === 'context') return { ...step, state: 'current' as const };
  return step;
});

function lastHandlers(): SetupStreamHandlers {
  const call = setupStream.mock.calls.at(-1) as [string, string, SetupStreamHandlers];
  return call[2];
}

beforeEach(() => {
  getAdapterEnvStatus.mockReset();
  getAdapterEnvStatus.mockResolvedValue({ anthropic: false, openaiCompatible: false });
  getSubscriptionLoginStatus.mockReset();
  getSubscriptionLoginStatus.mockResolvedValue({ claude: true, codex: false });
  getSubscriptionModelCatalog.mockReset();
  getSubscriptionModelCatalog.mockResolvedValue({ version: 1, status: 'ready', provider: 'claude', models: [] });
  getContextOverview.mockReset();
  getContextOverview.mockResolvedValue({ models: [], relationships: [], measures: [], knowledge: { verifiedPairCount: 0 } });
  getRuntimeSettings.mockReset();
  getRuntimeSettings.mockResolvedValue(fixtureRuntimeSettings);
  getRuntimeSettingsReadiness.mockReset();
  getRuntimeSettingsReadiness.mockResolvedValue({ valid: true });
  getRuntimeTierNames.mockReset();
  getRuntimeTierNames.mockResolvedValue(['cheap', 'strong']);
  getSetupEnvFields.mockReset();
  getSetupSourceCatalog.mockReset();
  // The connect card loads the catalog on mount; these cases are about the
  // decision/adopt flows, so a bare live-shaped response is enough.
  getSetupSourceCatalog.mockResolvedValue({ sources: [{ key: 'postgres', label: 'PostgreSQL', variants: [] }], fromCli: true });
  getSetupMode.mockReset();
  getSetupMode.mockResolvedValue({ mode: 'create' });
  getSetupRecovery.mockReset();
  getSetupRecovery.mockResolvedValue({});
  getSetupSteps.mockReset();
  // hydrate() always fires this GET on mount; the `pristine()` guard inside
  // it means it only applies once the store is still first-run, so a stale
  // resolved value here is harmless for tests that seed a later step.
  getSetupSteps.mockResolvedValue(connectStepSteps);
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

  useSetupStore.setState(
    {
      steps: connectStepSteps,
      selectedStepKey: 'connect',
      runtimeSettings: fixtureRuntimeSettings,
      verifyGate: false,
      connectedSourceKey: undefined,
      messages: [fixtureInitialMessage],
      setupMode: 'create',
      connectStream: initialConnectStream,
      contextStream: initialContextStream,
    },
    false,
  );
});

describe('Setup page — decision checkpoint (live mode)', () => {
  it('connect: a 409 name_conflict renders the decision card, and "Start clean" streams a fresh turn to completion', async () => {
    const user = userEvent.setup();
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

    renderWithProviders(<AppRoutes />, { route: '/setup' });

    await user.type(screen.getByPlaceholderText('my-project'), 'my-project');
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    // The detail line is echoed both in the conversation transcript and the
    // decision card itself — assert at least one rendering exists.
    expect((await screen.findAllByText('A project named "my-project" already exists.')).length).toBeGreaterThan(0);
    const rename = screen.getByRole('button', { name: 'Rename' });
    const clean = screen.getByRole('button', { name: 'Start clean' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    // The name-entry form stays locked while the decision is unresolved.
    expect(screen.getByPlaceholderText('my-project')).toBeDisabled();

    postSetupDecision.mockResolvedValueOnce({ sessionId: 's1', turnId: 't9' });
    await user.click(clean);

    expect(postSetupDecision).toHaveBeenCalledWith('s1', 'clean');
    await vi.waitFor(() => expect(setupStream).toHaveBeenCalledWith('s1', 't9', expect.anything()));
    // The decision card is gone once the new turn has started.
    expect(screen.queryByRole('button', { name: 'Start clean' })).not.toBeInTheDocument();
    expect(rename).not.toBeInTheDocument();
    expect(cancel).not.toBeInTheDocument();

    lastHandlers().onEvent?.({ id: 'e1', kind: 'setup_status', status: 'ok', message: 'Connected.' });

    await vi.waitFor(() => expect(useSetupStore.getState().connectedSourceKey).toBe('postgres'));
    expect(screen.getByText('Discover the connected schema and build its semantic model foundation.')).toBeInTheDocument();
  });

  it('connect: "Rename" clears the decision and re-opens the (now-empty) project name field for a new attempt', async () => {
    const user = userEvent.setup();
    postSetupConnectTurn.mockRejectedValueOnce(
      new SetupDecisionRequiredError('s1', {
        kind: 'name_conflict',
        options: [
          { id: 'rename', label: 'Rename' },
          { id: 'cancel', label: 'Cancel' },
        ],
      }),
    );

    renderWithProviders(<AppRoutes />, { route: '/setup' });

    await user.type(screen.getByPlaceholderText('my-project'), 'my-project');
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    const rename = await screen.findByRole('button', { name: 'Rename' });
    postSetupDecision.mockResolvedValueOnce({ sessionId: 's1', action: 'rename' });
    await user.click(rename);

    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument());
    const nameField = screen.getByPlaceholderText('my-project') as HTMLInputElement;
    expect(nameField).toBeEnabled();
    expect(nameField.value).toBe('');
    expect(setupStream).not.toHaveBeenCalled();
  });

  it('context: a mid-stream "needs_decision" renders the decision card, and "Continue" streams the returned turn to completion', async () => {
    const user = userEvent.setup();
    useSetupStore.setState(
      {
        steps: contextStepSteps,
        selectedStepKey: 'context',
        connectedSourceKey: 'postgres',
        connectStream: initialConnectStream,
        contextStream: initialContextStream,
      },
      false,
    );
    postSetupContextTurn.mockResolvedValueOnce({ sessionId: 's1', turnId: 't1' });

    renderWithProviders(<AppRoutes />, { route: '/setup' });

    await user.click(screen.getByRole('button', { name: 'Build data model' }));
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

    // Echoed both in the transcript and the decision card itself.
    expect(
      (await screen.findAllByText('The agent has used its turn budget. Continue or stop here?')).length,
    ).toBeGreaterThan(0);
    const continueButton = screen.getByRole('button', { name: 'Continue' });

    postSetupDecision.mockResolvedValueOnce({ sessionId: 's1', turnId: 't2' });
    await user.click(continueButton);

    expect(postSetupDecision).toHaveBeenCalledWith('s1', 'continue');
    await vi.waitFor(() => expect(setupStream).toHaveBeenCalledWith('s1', 't2', expect.anything()));
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();

    lastHandlers().onEvent?.({ id: 'e2', kind: 'setup_status', status: 'ok', message: 'Context built.' });

    await vi.waitFor(() => expect(useSetupStore.getState().steps.find((s) => s.key === 'context')?.state).toBe('done'));
    const sidebar = screen.getByRole('navigation', { name: 'Setup' });
    expect(within(sidebar).getByText('4. Bind profile')).toBeInTheDocument();
  });

  it('context: the build_context trace is shown only once — the live view while streaming, the persisted (collapsed) copy once done — never both, and no step is left stuck "(running)"', async () => {
    const user = userEvent.setup();
    useSetupStore.setState(
      {
        steps: contextStepSteps,
        selectedStepKey: 'context',
        connectedSourceKey: 'postgres',
        connectStream: initialConnectStream,
        contextStream: initialContextStream,
      },
      false,
    );
    postSetupContextTurn.mockResolvedValueOnce({ sessionId: 's1', turnId: 't1' });

    renderWithProviders(<AppRoutes />, { route: '/setup' });

    await user.click(screen.getByRole('button', { name: 'Build data model' }));
    await vi.waitFor(() => expect(setupStream).toHaveBeenCalled());

    // Terminal event arrives before this step's own closing `worklog` frame
    // (a real timing case) — the live snapshot still has a 'running' step.
    lastHandlers().onWorkLog?.([
      { id: 'scan', label: 'Scanning models', state: 'running', kind: 'tool' },
    ]);

    // While streaming: exactly one rendering of the step (the live view).
    expect(await screen.findAllByText('Scanning models')).toHaveLength(1);
    expect(screen.getByText('(running)')).toBeInTheDocument();

    lastHandlers().onEvent?.({ id: 'e1', kind: 'setup_status', status: 'ok', message: 'Context built.' });
    await vi.waitFor(() => expect(useSetupStore.getState().steps.find((s) => s.key === 'context')?.state).toBe('done'));

    // Once done: the live view is gone (gated on `streaming`), and the
    // persisted transcript copy starts collapsed behind a single toggle — so
    // the step row itself isn't rendered twice (or at all) until expanded.
    expect(screen.queryByText('Scanning models')).not.toBeInTheDocument();
    const traceToggles = screen.getAllByText('Execution trace');
    expect(traceToggles).toHaveLength(1);

    await user.click(traceToggles[0]);

    // Expanded: the step shows exactly once, and its state was finalized to
    // 'done' — never stuck at "(running)" — since the turn completed 'ok'.
    expect(screen.getAllByText('Scanning models')).toHaveLength(1);
    expect(screen.queryByText('(running)')).not.toBeInTheDocument();
    expect(screen.getByText('(done)')).toBeInTheDocument();
  });
});
