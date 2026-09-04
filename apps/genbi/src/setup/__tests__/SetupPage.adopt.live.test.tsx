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
const postSetupAdopt = vi.fn();
const postSetupCompileBind = vi.fn();
const postSetupConnectTurn = vi.fn();
const postSetupContextTurn = vi.fn();
const postSetupDecision = vi.fn();
const postSetupEnvValues = vi.fn();
const postSetupMode = vi.fn();
const postSetupReset = vi.fn();
const postSetupResume = vi.fn();
const putRuntimeSettings = vi.fn();

vi.mock('@/bff/client', async (importOriginal) => {
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
    postSetupAdopt: (...args: unknown[]) => postSetupAdopt(...args),
    postSetupCompileBind: (...args: unknown[]) => postSetupCompileBind(...args),
    postSetupConnectTurn: (...args: unknown[]) => postSetupConnectTurn(...args),
    postSetupContextTurn: (...args: unknown[]) => postSetupContextTurn(...args),
    postSetupDecision: (...args: unknown[]) => postSetupDecision(...args),
    postSetupEnvValues: (...args: unknown[]) => postSetupEnvValues(...args),
    postSetupMode: (...args: unknown[]) => postSetupMode(...args),
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
import type { SetupStreamHandlers } from '@/session/stream';

const initialConnectStream: ConnectStreamState = {
  workLog: [],
  streaming: false,
  needsInput: false,
  envFieldsLoading: false,
  submittingEnv: false,
};
const initialContextStream: ContextStreamState = { workLog: [], streaming: false, needsInput: false };

// The steps array right after the mode is *chosen*: only the connect/adopt
// step's key + title swap (per the server's `applySetupMode`) — `runtime`
// stays `current`, nothing else changes.
const modeAdoptSteps = fixtureSetupSteps.map((step) =>
  step.key === 'connect' ? { ...step, key: 'adopt' as const, title: 'Adopt an existing project' } : step,
);

// The steps array once the user has reached the adopt step itself: step 1
// done, step 2 (adopt) current — mirrors `connectStepSteps` in the sibling
// decision test file.
const adoptStepSteps = modeAdoptSteps.map((step) => {
  if (step.key === 'runtime') return { ...step, state: 'done' as const };
  if (step.key === 'adopt') return { ...step, state: 'current' as const };
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
  getSetupMode.mockResolvedValue({ mode: undefined });
  getSetupRecovery.mockReset();
  getSetupRecovery.mockResolvedValue({});
  getSetupSteps.mockReset();
  getSetupSteps.mockResolvedValue(fixtureSetupSteps);
  postSetupAdopt.mockReset();
  postSetupCompileBind.mockReset();
  postSetupConnectTurn.mockReset();
  postSetupContextTurn.mockReset();
  postSetupDecision.mockReset();
  postSetupEnvValues.mockReset();
  postSetupMode.mockReset();
  postSetupReset.mockReset();
  postSetupResume.mockReset();
  putRuntimeSettings.mockReset();
  setupStream.mockReset();
  setupStream.mockReturnValue(() => {});

  useSetupStore.setState(
    {
      steps: fixtureSetupSteps,
      selectedStepKey: 'runtime',
      runtimeSettings: fixtureRuntimeSettings,
      verifyGate: false,
      connectedSourceKey: undefined,
      messages: [fixtureInitialMessage],
      setupMode: undefined,
      setupModeLoading: false,
      setupModeChoosing: false,
      setupModeError: undefined,
      connectStream: initialConnectStream,
      contextStream: initialContextStream,
      adoptStream: { verifying: false, resolving: false },
    },
    false,
  );
});

// Same shape as the decision live tests: eleven SSE-driven cases, 15.3s locally.
// Not yet a CI failure, but the same distance from vitest's 5s default that made
// its sibling one, so it gets the same room rather than a later red build.
vi.setConfig({ testTimeout: 15_000 });

describe('Setup page — create/adopt mode choice (live mode)', () => {
  it('renders the mode choice when no mode is set, and hides the steps sidebar until one is picked', async () => {
    renderWithProviders(<AppRoutes />, { route: '/setup' });

    expect(await screen.findByRole('button', { name: 'Create new project' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adopt existing project' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Setup' })).not.toBeInTheDocument();
  });

  it('selecting "Create new project" POSTs the mode and reveals the unchanged create-flow sidebar', async () => {
    const user = userEvent.setup();
    postSetupMode.mockResolvedValueOnce({ mode: 'create', steps: fixtureSetupSteps });

    renderWithProviders(<AppRoutes />, { route: '/setup' });

    await user.click(await screen.findByRole('button', { name: 'Create new project' }));

    expect(postSetupMode).toHaveBeenCalledWith('create');
    await vi.waitFor(() => expect(useSetupStore.getState().setupMode).toBe('create'));
    expect(await screen.findByRole('navigation', { name: 'Setup' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create new project' })).not.toBeInTheDocument();
  });

  it('selecting "Adopt existing project" POSTs the mode and swaps the sidebar\'s second step to the adopt step', async () => {
    const user = userEvent.setup();
    postSetupMode.mockResolvedValueOnce({ mode: 'adopt', steps: modeAdoptSteps });

    renderWithProviders(<AppRoutes />, { route: '/setup' });

    await user.click(await screen.findByRole('button', { name: 'Adopt existing project' }));

    expect(postSetupMode).toHaveBeenCalledWith('adopt');
    await vi.waitFor(() => expect(useSetupStore.getState().setupMode).toBe('adopt'));
    const sidebar = await screen.findByRole('navigation', { name: 'Setup' });
    expect(within(sidebar).getByText('2. Adopt an existing project')).toBeInTheDocument();
  });
});

/**
 * These cases run long enough that vitest's 5s default made them a coin flip:
 * the suite failed roughly one run in twelve, always as `Test timed out in
 * 5000ms` and never on an assertion.
 *
 * The two heaviest cases measure ~4.5s with the machine otherwise idle, so
 * this is not contention — a loaded run only adds the last few hundred
 * milliseconds that tip them over. The cost is one interaction: picking a
 * candidate profile takes ~2.8s on its own.
 *
 * What that 2.8s is NOT, each ruled out by measurement rather than reasoning:
 * not character-by-character typing (pasting the path instead changed
 * nothing), not user-event's machinery (`fireEvent.click` costs the same
 * 2.8s), not its pointer-events check (disabling it changed nothing), and not
 * React rendering — a Profiler over the whole tree reports 12 commits
 * totalling 9ms of render work against 2812ms of wall clock. What remains is
 * jsdom/antd environment work in effects: style injection and CSSOM parsing,
 * which no amount of test restructuring makes cheaper.
 *
 * So the budget is raised to fit what these cases genuinely cost here, rather
 * than the tests being rewritten to hide it. A real hang still fails, just at
 * 20s. If this page's interaction cost ever becomes a product concern, the 9ms
 * of React work says to look at the environment, not at the components.
 */
describe('Setup page — adopt flow (live mode)', { timeout: 20_000 }, () => {
  beforeEach(() => {
    // `hydrate()`'s mode fetch has no `pristine()` guard (unlike the steps
    // fetch) — it always applies, so it must agree with the seeded state or
    // it races the manual `setState` below and flips back to "no mode".
    getSetupMode.mockResolvedValue({ mode: 'adopt' });
    useSetupStore.setState(
      {
        steps: adoptStepSteps,
        selectedStepKey: 'adopt',
        setupMode: 'adopt',
        adoptStream: { verifying: false, resolving: false },
      },
      false,
    );
  });

  it('a verified project with an already-built context ("ok") binds immediately and advances straight to bind', async () => {
    const user = userEvent.setup();
    postSetupAdopt.mockResolvedValueOnce({ status: 'ok', message: 'Project verified and bound.' });

    renderWithProviders(<AppRoutes />, { route: '/setup' });

    await user.type(screen.getByPlaceholderText('/path/to/my-project'), '/existing/project');
    await user.click(screen.getByRole('button', { name: 'Verify & adopt' }));

    expect(postSetupAdopt).toHaveBeenCalledWith('/existing/project', undefined);
    await vi.waitFor(() => expect(useSetupStore.getState().selectedStepKey).toBe('bind'));
    expect(useSetupStore.getState().steps.find((s) => s.key === 'adopt')?.state).toBe('done');
    expect(useSetupStore.getState().steps.find((s) => s.key === 'context')?.state).toBe('done');
  });

  it('a verified project with no built context ("needs_decision") shows a Build/Cancel prompt, and "Build" streams the context turn', async () => {
    const user = userEvent.setup();
    postSetupAdopt.mockResolvedValueOnce({
      sessionId: 's1',
      status: 'needs_decision',
      message: 'No built context found.',
      decision: {
        kind: 'build_context',
        options: [
          { id: 'build', label: 'Build' },
          { id: 'cancel', label: 'Cancel' },
        ],
        detail: 'This project has no built context yet. Build one now?',
      },
    });

    renderWithProviders(<AppRoutes />, { route: '/setup' });

    await user.type(screen.getByPlaceholderText('/path/to/my-project'), '/existing/project');
    await user.click(screen.getByRole('button', { name: 'Verify & adopt' }));

    expect(
      (await screen.findAllByText('This project has no built context yet. Build one now?')).length,
    ).toBeGreaterThan(0);
    const build = screen.getByRole('button', { name: 'Build' });

    postSetupDecision.mockResolvedValueOnce({ sessionId: 's1', turnId: 't1' });
    await user.click(build);

    expect(postSetupDecision).toHaveBeenCalledWith('s1', 'build');
    await vi.waitFor(() => expect(setupStream).toHaveBeenCalledWith('s1', 't1', expect.anything()));
    await vi.waitFor(() => expect(useSetupStore.getState().selectedStepKey).toBe('context'));
    expect(useSetupStore.getState().steps.find((s) => s.key === 'adopt')?.state).toBe('done');

    lastHandlers().onEvent?.({ id: 'e1', kind: 'setup_status', status: 'ok', message: 'Context built.' });
    await vi.waitFor(() => expect(useSetupStore.getState().steps.find((s) => s.key === 'context')?.state).toBe('done'));
  });

  it('"Cancel" on the build_context prompt drops the checkpoint and returns to the mode choice', async () => {
    const user = userEvent.setup();
    postSetupAdopt.mockResolvedValueOnce({
      sessionId: 's1',
      status: 'needs_decision',
      message: 'No built context found.',
      decision: {
        kind: 'build_context',
        options: [
          { id: 'build', label: 'Build' },
          { id: 'cancel', label: 'Cancel' },
        ],
        detail: 'This project has no built context yet. Build one now?',
      },
    });

    renderWithProviders(<AppRoutes />, { route: '/setup' });

    await user.type(screen.getByPlaceholderText('/path/to/my-project'), '/existing/project');
    await user.click(screen.getByRole('button', { name: 'Verify & adopt' }));

    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    postSetupDecision.mockResolvedValueOnce({ sessionId: 's1', action: 'cancel' });
    await user.click(cancel);

    expect(postSetupDecision).toHaveBeenCalledWith('s1', 'cancel');
    await vi.waitFor(() => expect(useSetupStore.getState().setupMode).toBeUndefined());
    expect(await screen.findByRole('button', { name: 'Create new project' })).toBeInTheDocument();
    expect(setupStream).not.toHaveBeenCalled();
  });

  it('a failed verification ("error") shows an inline message and leaves the path editable for a retry', async () => {
    const user = userEvent.setup();
    postSetupAdopt.mockResolvedValueOnce({ status: 'error', message: 'No connection profile found at that path.' });

    renderWithProviders(<AppRoutes />, { route: '/setup' });

    const pathInput = screen.getByPlaceholderText('/path/to/my-project');
    await user.type(pathInput, '/not/a/project');
    await user.click(screen.getByRole('button', { name: 'Verify & adopt' }));

    expect(await screen.findByText('No connection profile found at that path.')).toBeInTheDocument();
    expect(pathInput).toBeEnabled();
    expect(useSetupStore.getState().selectedStepKey).toBe('adopt');
  });

  it('a project with no profile: pinned but compatible candidates ("select_profile") lets the user pick one, then re-verifies with it bound', async () => {
    const user = userEvent.setup();
    postSetupAdopt.mockResolvedValueOnce({
      status: 'needs_decision',
      message: '"/existing/project" has no profile: pinned — choose a connection profile to use (data_source: duckdb)',
      decision: {
        kind: 'select_profile',
        options: [
          { id: 'demo', label: 'demo' },
          { id: 'staging', label: 'staging' },
        ],
        detail: '"/existing/project" has no profile: pinned — choose a connection profile to use (data_source: duckdb)',
      },
    });

    renderWithProviders(<AppRoutes />, { route: '/setup' });

    await user.type(screen.getByPlaceholderText('/path/to/my-project'), '/existing/project');
    await user.click(screen.getByRole('button', { name: 'Verify & adopt' }));

    expect(await screen.findByRole('button', { name: 'demo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'staging' })).toBeInTheDocument();

    // Choosing "demo" must NOT go through `postSetupDecision` — there is no
    // session-scoped checkpoint for this kind, just a re-POST carrying the
    // chosen profile.
    postSetupAdopt.mockResolvedValueOnce({ status: 'ok', message: 'Project verified and bound.' });
    await user.click(screen.getByRole('button', { name: 'demo' }));

    expect(postSetupAdopt).toHaveBeenLastCalledWith('/existing/project', 'demo');
    expect(postSetupDecision).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(useSetupStore.getState().selectedStepKey).toBe('bind'));
    expect(useSetupStore.getState().steps.find((s) => s.key === 'adopt')?.state).toBe('done');
  });

  it('choosing a profile off "select_profile" that still needs context built lands on the build_context prompt', async () => {
    const user = userEvent.setup();
    postSetupAdopt.mockResolvedValueOnce({
      status: 'needs_decision',
      message: 'no pin',
      decision: {
        kind: 'select_profile',
        options: [{ id: 'demo', label: 'demo' }],
        detail: 'choose a profile',
      },
    });
    postSetupAdopt.mockResolvedValueOnce({
      sessionId: 's2',
      status: 'needs_decision',
      message: 'No built context found.',
      decision: {
        kind: 'build_context',
        options: [
          { id: 'build', label: 'Build' },
          { id: 'cancel', label: 'Cancel' },
        ],
        detail: 'This project has no built context yet. Build one now?',
      },
    });

    renderWithProviders(<AppRoutes />, { route: '/setup' });

    await user.type(screen.getByPlaceholderText('/path/to/my-project'), '/existing/project');
    await user.click(screen.getByRole('button', { name: 'Verify & adopt' }));
    await user.click(await screen.findByRole('button', { name: 'demo' }));

    expect(await screen.findByRole('button', { name: 'Build' })).toBeInTheDocument();
    expect(postSetupAdopt).toHaveBeenLastCalledWith('/existing/project', 'demo');
  });

  it('choosing an incompatible profile off "select_profile" re-shows the same candidates alongside the error, instead of a dead-end', async () => {
    const user = userEvent.setup();
    const decision = {
      kind: 'select_profile' as const,
      options: [
        { id: 'demo', label: 'demo' },
        { id: 'staging', label: 'staging' },
      ],
      detail: '"/existing/project" has no profile: pinned — choose a connection profile to use (data_source: duckdb)',
    };
    postSetupAdopt.mockResolvedValueOnce({
      status: 'needs_decision',
      message: decision.detail,
      decision,
    });

    renderWithProviders(<AppRoutes />, { route: '/setup' });

    await user.type(screen.getByPlaceholderText('/path/to/my-project'), '/existing/project');
    await user.click(screen.getByRole('button', { name: 'Verify & adopt' }));

    expect(await screen.findByRole('button', { name: 'demo' })).toBeInTheDocument();

    // The server rejects "staging" (e.g. its data source doesn't match this
    // project's) and, per its own contract, restores the project to its
    // pre-pick, no-pin state — so the client should re-show the same
    // candidate list rather than stranding the user on a bare error.
    postSetupAdopt.mockResolvedValueOnce({
      status: 'error',
      message: 'profile "staging" is not a compatible candidate for "/existing/project" (data_source "duckdb")',
    });
    await user.click(screen.getByRole('button', { name: 'staging' }));

    expect(await screen.findByText(/not a compatible candidate/)).toBeInTheDocument();
    // Both candidates are still offered — the picker was not dropped.
    expect(screen.getByRole('button', { name: 'demo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'staging' })).toBeInTheDocument();

    // Picking the compatible one now succeeds, proving the retry path is live.
    postSetupAdopt.mockResolvedValueOnce({ status: 'ok', message: 'Project verified and bound.' });
    await user.click(screen.getByRole('button', { name: 'demo' }));

    expect(postSetupAdopt).toHaveBeenLastCalledWith('/existing/project', 'demo');
    await vi.waitFor(() => expect(useSetupStore.getState().selectedStepKey).toBe('bind'));
  });

  it('a project with no profile: pinned and no compatible candidate at all ("error") shows the clearer error message', async () => {
    const user = userEvent.setup();
    postSetupAdopt.mockResolvedValueOnce({
      status: 'error',
      message:
        'wren_project.yml at "/existing/project" has no profile: pinned, and no compatible profile (data_source "duckdb") was found in ~/.wren/profiles.yml — run `wren profile add` to create one, then retry.',
    });

    renderWithProviders(<AppRoutes />, { route: '/setup' });

    await user.type(screen.getByPlaceholderText('/path/to/my-project'), '/existing/project');
    await user.click(screen.getByRole('button', { name: 'Verify & adopt' }));

    expect(await screen.findByText(/no compatible profile/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('/path/to/my-project')).toBeEnabled();
  });
});
