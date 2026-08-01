import { describe, it, expect, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
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
      runtimeSettings: fixtureRuntimeSettings,
      verifyGate: false,
      connectedSourceKey: undefined,
      messages: [fixtureInitialMessage],
    },
    false,
  );
});

describe('Setup page', () => {
  it('lists the 5 onboarding steps with done/current/todo shown as icon+label, and is selectable', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { route: '/setup' });

    const sidebar = screen.getByRole('navigation', { name: 'Setup' });
    expect(within(sidebar).getByText('1. Runtime & models')).toBeInTheDocument();
    expect(within(sidebar).getByText('2. Connect data source')).toBeInTheDocument();
    expect(within(sidebar).getByText('3. Build context')).toBeInTheDocument();
    expect(within(sidebar).getByText('4. Bind profile')).toBeInTheDocument();
    expect(within(sidebar).getByText('5. Ask')).toBeInTheDocument();

    // First-run: step 1 current, the rest todo — shown by icon+label, not color alone.
    expect(within(sidebar).getByText('In progress')).toBeInTheDocument();
    expect(within(sidebar).getAllByText('Not started')).toHaveLength(4);

    // Selecting a step shows its card in the canvas.
    await user.click(within(sidebar).getByText('2. Connect data source'));
    expect(screen.getByText('Connect a data source')).toBeInTheDocument();
  });

  it('step 1: subscription auth stays selectable; API key, Local, and hybrid are visibly unavailable', async () => {
    // AntD Segmented renders its semantic `<input type="radio">` with
    // `pointer-events: none` (the visible click surface is a sibling label) —
    // real users click the label, not the hidden input, so disable
    // userEvent's pointer-events hit-test for this test.
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(<AppRoutes />, { route: '/setup' });

    expect(screen.getByText('Runtime & models')).toBeInTheDocument();

    // Agentic onboarding currently supports only the persistent subscription
    // session. API key remains visible but cannot be selected or advance setup.
    expect(screen.getByRole('radio', { name: 'Claude Subscription' })).toBeEnabled();
    const apiKeyOption = screen.getByRole('radio', { name: /API key \(BYO\).*temporarily unavailable/ });
    expect(apiKeyOption).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Local/ })).toBeDisabled();
    expect(useSetupStore.getState().runtimeSettings.authMode).toBe('subscription');
    await user.click(screen.getByText(/API key \(BYO\).*temporarily unavailable/));
    expect(useSetupStore.getState().runtimeSettings.authMode).toBe('subscription');
    expect(screen.queryByText('API key adapter')).not.toBeInTheDocument();

    // Tier → model, disambiguated per tier via a per-instance aria-label.
    const orchestratorTier = screen.getByRole('radiogroup', { name: 'Model for orchestrator tier' });
    await user.click(within(orchestratorTier).getByRole('radio', { name: 'claude-sonnet' }));
    expect(
      useSetupStore.getState().runtimeSettings.tierModels.find((b) => b.tier === 'orchestrator')?.model,
    ).toBe('claude-sonnet');

    const cheapTier = screen.getByRole('radiogroup', { name: 'Model for cheap tier' });
    await user.click(within(cheapTier).getByRole('radio', { name: 'claude-opus' }));
    expect(
      useSetupStore.getState().runtimeSettings.tierModels.find((b) => b.tier === 'cheap')?.model,
    ).toBe('claude-opus');

    // Hybrid routing is greyed until it's wired into setup — disabled, stays off.
    const hybridSwitch = screen.getByRole('switch', { name: 'Hybrid routing' });
    expect(hybridSwitch).toBeDisabled();
    expect(useSetupStore.getState().runtimeSettings.hybrid).toBe(false);

    // No deployment control — the flow is always personal, single-operator
    // subscription use; instead the subscription ToS notice is surfaced.
    expect(screen.queryByRole('radio', { name: /Hosted/ })).not.toBeInTheDocument();
    expect(screen.getByText(/personal, single-operator use only/)).toBeInTheDocument();

    // Saving advances the flow: step 1 done, step 2 current, canvas switches.
    await user.click(screen.getByRole('button', { name: 'Save runtime settings' }));
    expect(useSetupStore.getState().steps.find((s) => s.key === 'runtime')?.state).toBe('done');
    expect(useSetupStore.getState().steps.find((s) => s.key === 'connect')?.state).toBe('current');
    expect(screen.getByText('Connect a data source')).toBeInTheDocument();
  });

  it('steps 2-4 show the connect / context / bind cards', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { route: '/setup' });

    const sidebar = screen.getByRole('navigation', { name: 'Setup' });

    await user.click(within(sidebar).getByText('2. Connect data source'));
    expect(screen.getByText('Connect a data source')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create project' })).toBeInTheDocument();

    await user.click(within(sidebar).getByText('3. Build context'));
    // The card title and its action button share the same label ("Build
    // context"), so assert on the card's unique description instead of the
    // (ambiguous) title text.
    expect(
      screen.getByText('Discover models, cubes, and knowledge from the connected source.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Build context' })).toBeInTheDocument();

    await user.click(within(sidebar).getByText('4. Bind profile'));
    expect(screen.getByText('Bind profile')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compile and bind' })).toBeInTheDocument();
  });

  it('compiling and binding turns the verify gate on and advances current from bind to ask', async () => {
    const user = userEvent.setup();
    useSetupStore.setState(
      {
        steps: [
          { key: 'runtime', title: 'Runtime & models', state: 'done' },
          { key: 'connect', title: 'Connect data source', state: 'done' },
          { key: 'context', title: 'Build context', state: 'done' },
          { key: 'bind', title: 'Bind profile', state: 'current' },
          { key: 'ask', title: 'Ask', state: 'todo' },
        ],
        selectedStepKey: 'bind',
        verifyGate: false,
      },
      false,
    );
    renderWithProviders(<AppRoutes />, { route: '/setup' });
    const sidebar = screen.getByRole('navigation', { name: 'Setup' });

    expect(screen.getByText('Off')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Compile and bind' }));

    expect(useSetupStore.getState().verifyGate).toBe(true);
    expect(useSetupStore.getState().steps.find((s) => s.key === 'bind')?.state).toBe('done');
    expect(useSetupStore.getState().steps.find((s) => s.key === 'ask')?.state).toBe('current');

    // The canvas advanced to the Ask card — a plain CTA, no verify-gate row
    // (that's a bind-time detail shown on the Bind step, not re-shown here).
    expect(screen.getByText('Setup is complete — ask a question about your data.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Go to Ask/ })).toBeInTheDocument();

    // `ask` is the terminal step — once it's current, setup is done, so its
    // sidebar row shows no "In progress" tag (the four prior steps are "Done").
    expect(within(sidebar).queryByText('In progress')).not.toBeInTheDocument();
  });

  it('shows the guided assistant conversation without a free-text composer (setup is card-driven)', async () => {
    renderWithProviders(<AppRoutes />, { route: '/setup' });

    expect(screen.getByText(/Let's get your workspace ready/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Ask a question' })).not.toBeInTheDocument();
  });
});
