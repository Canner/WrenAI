import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { AppRoutes } from '@/app/App';
import { useSetupStore } from '../useSetupStore';
import { fixtureInitialMessage, fixtureRuntimeSettings, fixtureSetupSteps } from '../fixtures';

beforeEach(() => {
  useSetupStore.setState(
    {
      steps: fixtureSetupSteps,
      selectedStepKey: 'runtime',
      runtimeSettings: {
        ...fixtureRuntimeSettings,
        subscriptionDriverModel: 'claude-opus',
        apiKeyModel: 'claude-sonnet',
        tierModels: [
          { tier: 'cheap', model: 'claude-haiku' },
          { tier: 'strong', model: 'claude-sonnet' },
        ],
      },
      runtimeTierNames: ['cheap', 'strong'],
      runtimeTierNamesError: undefined,
      adapterEnvStatus: { anthropic: true, openaiCompatible: true },
      subscriptionLoginStatus: { claude: true, codex: true },
      subscriptionModelCatalogs: {},
      subscriptionModelCatalogLoading: {},
      subscriptionModelCatalogErrors: {},
      verifyGate: false,
      connectedSourceKey: undefined,
      messages: [fixtureInitialMessage],
    },
    false,
  );
});

describe('RuntimeStepCard — compiled tier bindings', () => {
  it('renders only dynamic bundle tiers with free-form model controls and no hidden default fallback', () => {
    renderWithProviders(<AppRoutes />, { route: '/setup' });

    expect(screen.getByRole('combobox', { name: 'Model for cheap tier' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Model for strong tier' })).toBeInTheDocument();
    expect(screen.queryByText('orchestrator')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Adapter for cheap tier' })).not.toBeInTheDocument();
    expect(screen.queryByText('Hybrid limitations')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Base URL for cheap tier' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Default model' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Required unless a default model is set')).not.toBeInTheDocument();
  });

  it.each([
    { authMode: 'byo' as const, subscriptionDriverModel: '', subscriptionLoginStatus: { claude: true, codex: true } },
    { authMode: 'local' as const, subscriptionDriverModel: 'claude-opus', subscriptionLoginStatus: { claude: false, codex: true } },
  ])('projects hydrated $authMode settings into the subscription form and keeps the effective Setup gate closed', ({ authMode, subscriptionDriverModel, subscriptionLoginStatus }) => {
    useSetupStore.setState({
      runtimeSettings: {
        ...fixtureRuntimeSettings,
        authMode,
        subscriptionProvider: 'claude',
        subscriptionDriverModel,
        apiKeyModel: 'legacy-default',
        tierModels: [
          { tier: 'cheap', model: 'claude-haiku' },
          { tier: 'strong', model: 'claude-sonnet' },
        ],
      },
      subscriptionLoginStatus,
    });
    renderWithProviders(<AppRoutes />, { route: '/setup' });

    expect(screen.getByRole('radio', { name: 'Personal subscription' })).toBeChecked();
    expect(screen.getByRole('radiogroup', { name: 'Interactive CLI target' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Subscription driver model' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save runtime settings' })).toBeDisabled();
    // Rendering the Setup projection never changes the unsaved boot authority.
    expect(useSetupStore.getState().runtimeSettings.authMode).toBe(authMode);
  });

  it('keeps Codex driver model separate from cheap/strong bundle rows', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(<AppRoutes />, { route: '/setup' });

    await user.click(screen.getByRole('radio', { name: 'Codex CLI' }));
    expect(useSetupStore.getState().runtimeSettings.subscriptionProvider).toBe('codex');
    expect(screen.getByRole('combobox', { name: 'Subscription driver model' })).toBeInTheDocument();
    expect(useSetupStore.getState().runtimeSettings.tierModels.map((binding) => binding.tier)).toEqual(['cheap', 'strong']);
    expect(useSetupStore.getState().runtimeSettings.tierModels.every((binding) => binding.model === undefined)).toBe(true);
  });

  it('leaves every model control blank in the first-run fixture', () => {
    useSetupStore.setState({ runtimeSettings: fixtureRuntimeSettings });
    renderWithProviders(<AppRoutes />, { route: '/setup' });

    expect(screen.getByRole('combobox', { name: 'Subscription driver model' })).toHaveValue('');
    expect(screen.queryByRole('combobox', { name: 'Default model' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Model for cheap tier' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Model for strong tier' })).toHaveValue('');
    expect(screen.getAllByPlaceholderText('Search models or enter a required model ID')).toHaveLength(2);
    expect(screen.queryByPlaceholderText('Required unless a default model is set')).not.toBeInTheDocument();
  });

  it('requires every compiled tier model even when a hydrated legacy default is present', () => {
    useSetupStore.setState({
      runtimeSettings: {
        ...fixtureRuntimeSettings,
        subscriptionDriverModel: 'claude-opus',
        apiKeyModel: 'legacy-default',
        tierModels: [
          { tier: 'cheap', model: 'claude-haiku' },
          { tier: 'strong', model: '' },
        ],
      },
    });
    renderWithProviders(<AppRoutes />, { route: '/setup' });

    expect(screen.getByRole('button', { name: 'Save runtime settings' })).toBeDisabled();
  });

  it('enables saving only after every compiled tier has an explicit model', () => {
    useSetupStore.setState({
      runtimeSettings: {
        ...fixtureRuntimeSettings,
        subscriptionDriverModel: 'claude-opus',
        apiKeyModel: 'legacy-default',
        tierModels: [
          { tier: 'cheap', model: 'claude-haiku' },
          { tier: 'strong', model: 'claude-sonnet' },
        ],
      },
    });
    renderWithProviders(<AppRoutes />, { route: '/setup' });

    expect(screen.getByRole('button', { name: 'Save runtime settings' })).toBeEnabled();
  });

  it('never offers a Claude tier a catalog id the runtime validator rejects', async () => {
    const user = userEvent.setup();
    // The shape a real signed-in Claude account returns: `default` is present,
    // is marked recommended, and resolves to the most capable model — while
    // `opus` and `inherit`, which the validator does accept, are absent. Picking
    // the recommended entry used to fail the save outright.
    useSetupStore.setState({
      subscriptionModelCatalogs: {
        claude: {
          version: 1,
          status: 'ready',
          provider: 'claude',
          models: [
            { model: 'default', displayName: 'Default (recommended)', description: 'Opus 4.5 \u00b7 Most capable', isDefault: true },
            { model: 'sonnet', displayName: 'Sonnet', description: 'Sonnet 4.5 \u00b7 Best for everyday' },
            { model: 'haiku', displayName: 'Haiku', description: 'Haiku 4.5 \u00b7 Fastest for quick' },
          ],
        },
      },
    });
    renderWithProviders(<AppRoutes />, { route: '/setup' });

    const strong = screen.getByRole('combobox', { name: 'Model for strong tier' });
    await user.clear(strong);
    await user.type(strong, 'default');
    expect(screen.queryAllByRole('option').some((option) => (option.textContent ?? '').includes('default'))).toBe(false);
    expect((await screen.findAllByRole('alert')).some((alert) => (alert.textContent ?? '').includes('This tier will not save'))).toBe(true);

    // `opus` is accepted by the validator but absent from this account catalog,
    // so before the fix there was no way to pick the most capable model here.
    await user.clear(strong);
    await user.type(strong, 'opu');
    expect((await screen.findAllByRole('option')).some((option) => (option.textContent ?? '').includes('opus'))).toBe(true);

    // That the driver field still takes any catalog id is covered by
    // "uses provider catalog data without constraining arbitrary manual model ids".
  });

  it('uses provider catalog data without constraining arbitrary manual model ids', async () => {
    const user = userEvent.setup();
    useSetupStore.setState({
      subscriptionModelCatalogs: {
        claude: {
          version: 1,
          status: 'ready',
          provider: 'claude',
          models: [
            { model: 'claude-sonnet', displayName: 'Claude Sonnet', description: 'Balanced for daily work', isDefault: true },
            { model: 'claude-sonnet-pro', displayName: 'Claude Sonnet Pro', description: 'Extra reasoning capacity' },
          ],
        },
      },
    });
    renderWithProviders(<AppRoutes />, { route: '/setup' });

    const driver = screen.getByRole('combobox', { name: 'Subscription driver model' });
    await user.clear(driver);
    await user.type(driver, 'son');
    expect(driver).toHaveValue('son');
    expect((await screen.findAllByText('Claude Sonnet · Provider default')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('claude-sonnet')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Balanced for daily work')).length).toBeGreaterThan(0);
    expect((await screen.findAllByRole('option')).length).toBeGreaterThanOrEqual(2);
    driver.focus();
    fireEvent.keyDown(driver, { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40 });
    fireEvent.keyDown(driver, { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40 });
    fireEvent.keyDown(driver, { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40 });
    fireEvent.keyDown(driver, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });
    expect(driver).toHaveValue('claude-sonnet-pro');
    expect(useSetupStore.getState().subscriptionModelCatalogs.claude).toMatchObject({
      models: [
        { model: 'claude-sonnet', displayName: 'Claude Sonnet', description: 'Balanced for daily work', isDefault: true },
        { model: 'claude-sonnet-pro', displayName: 'Claude Sonnet Pro', description: 'Extra reasoning capacity' },
      ],
    });

    const cheap = screen.getByRole('combobox', { name: 'Model for cheap tier' });
    await user.clear(cheap);
    await user.type(cheap, 'future-provider-model');
    fireEvent.keyDown(cheap, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });
    expect(cheap).toHaveValue('future-provider-model');
    expect(useSetupStore.getState().runtimeSettings.tierModels.find((row) => row.tier === 'cheap')?.model).toBe('future-provider-model');
  });

  it('does not label values that match the ready provider catalog', () => {
    useSetupStore.setState({
      runtimeSettings: {
        ...fixtureRuntimeSettings,
        // Preserve the user's exact free-text value, but use its normalized
        // ID when deciding whether the ready catalog recognizes it.
        subscriptionDriverModel: ' claude-opus ',
        tierModels: [
          { tier: 'cheap', model: 'claude-haiku' },
          { tier: 'strong', model: 'claude-sonnet' },
        ],
      },
      subscriptionModelCatalogs: {
        claude: {
          version: 1,
          status: 'ready',
          provider: 'claude',
          models: [
            { model: 'claude-opus', displayName: 'Claude Opus' },
            { model: 'claude-sonnet', displayName: 'Claude Sonnet' },
            { model: 'claude-haiku', displayName: 'Claude Haiku' },
          ],
        },
      },
    });
    renderWithProviders(<AppRoutes />, { route: '/setup' });
    expect(screen.getByRole('combobox', { name: 'Subscription driver model' })).toHaveValue(' claude-opus ');
    expect(screen.queryByText('Custom / unverified model')).not.toBeInTheDocument();
  });

  it('labels a driver-field catalog mismatch as custom/unverified, and a tier mismatch as unsaveable', () => {
    useSetupStore.setState({
      runtimeSettings: {
        ...fixtureRuntimeSettings,
        subscriptionDriverModel: 'legacy-driver',
        tierModels: [
          { tier: 'cheap', model: 'legacy-cheap' },
          { tier: 'strong', model: 'legacy-strong' },
        ],
      },
      subscriptionModelCatalogs: {
        claude: { version: 1, status: 'ready', provider: 'claude', models: [] },
      },
    });
    renderWithProviders(<AppRoutes />, { route: '/setup' });
    // Only the driver field takes free-form ids, so it alone gets the soft
    // "we couldn't verify this" label. Both Claude tiers hold values outside
    // the SDK's per-step union, which is not unverified but plainly invalid —
    // the save would be rejected — so they say that instead.
    expect(screen.getAllByText('Custom / unverified model')).toHaveLength(1);
    expect(screen.getAllByRole('alert').filter((alert) => (alert.textContent ?? '').includes('This tier will not save'))).toHaveLength(2);
  });

  it('does not call model values unverified while the catalog is loading or unavailable', () => {
    useSetupStore.setState({
      subscriptionModelCatalogLoading: { claude: true },
      subscriptionModelCatalogs: {},
    });
    const { rerender } = renderWithProviders(<AppRoutes />, { route: '/setup' });
    expect(screen.queryByText('Custom / unverified model')).not.toBeInTheDocument();

    useSetupStore.setState({
      subscriptionModelCatalogLoading: {},
      subscriptionModelCatalogs: {
        claude: { version: 1, status: 'unavailable', provider: 'claude', code: 'runtime_unavailable', retryable: true },
      },
    });
    rerender(<AppRoutes />);
    expect(screen.queryByText('Custom / unverified model')).not.toBeInTheDocument();
  });

  it('shows catalog unavailability and keeps valid manual settings saveable', () => {
    useSetupStore.setState({ subscriptionModelCatalogErrors: { claude: 'runtime_unavailable' } });
    renderWithProviders(<AppRoutes />, { route: '/setup' });
    expect(screen.getByText('Model suggestions are unavailable')).toBeInTheDocument();
    expect(screen.getByText(/You can still enter a model ID manually/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save runtime settings' })).toBeEnabled();
  });

  it('hides hybrid limitations and blocks a logged-out subscription save', async () => {
    useSetupStore.setState({ subscriptionLoginStatus: { claude: false, codex: true } });
    renderWithProviders(<AppRoutes />, { route: '/setup' });

    expect(screen.queryByText(/Non-Anthropic render steps can wall-hit/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save runtime settings' })).toBeDisabled();
    expect(document.body.textContent).not.toMatch(/auth\.json|token|credential/i);
  });

  it('fails closed when compiled tier discovery fails instead of rendering fixture rows', () => {
    useSetupStore.setState({ runtimeTierNames: [], runtimeTierNamesError: 'warble compile failed' });
    renderWithProviders(<AppRoutes />, { route: '/setup' });

    expect(screen.getByText('Could not load compiled bundle tiers')).toBeInTheDocument();
    expect(screen.getByText('warble compile failed')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Model for .* tier/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save runtime settings' })).toBeDisabled();
  });

  it('does not expose persisted hybrid adapter settings in the subscription-only form', () => {
    useSetupStore.setState({
      runtimeSettings: {
        ...fixtureRuntimeSettings,
        authMode: 'byo',
        apiKeyAdapter: 'anthropic',
        tierModels: [
          { tier: 'cheap', adapter: 'local', model: 'local-small', baseURL: 'http://localhost:11434/v1' },
          { tier: 'strong', adapter: 'openai-compatible', model: 'gpt-4.1', baseURL: 'https://api.openai.com/v1' },
        ],
      },
      adapterEnvStatus: { anthropic: false, openaiCompatible: false },
    });
    renderWithProviders(<AppRoutes />, { route: '/setup' });

    expect(screen.queryByRole('combobox', { name: 'Adapter for cheap tier' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Base URL for cheap tier' })).not.toBeInTheDocument();
    expect(screen.queryByText(/OPENAI_API_KEY must be set/i)).not.toBeInTheDocument();
  });
});
