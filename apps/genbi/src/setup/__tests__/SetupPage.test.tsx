import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { AppRoutes } from '@/app/App';
import { useSetupStore } from '../useSetupStore';
import { fixtureInitialMessage, fixtureRuntimeSettings, fixtureSetupSteps } from '../fixtures';
import { SetupFailurePanel } from '../SetupFailurePanel';

function LocationProbe() { return <output data-testid="location-probe">{useLocation().pathname}</output>; }

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
  it('renders a friendly failure panel with collapsed technical details and an enabled retry', async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    renderWithProviders(
      <SetupFailurePanel
        step="context"
        retrying={false}
        onRetry={retry}
        failure={{
          attempt: 'context',
          projectName: 'acme',
          sourceType: 'postgres',
          error: 'host contract diagnostic PASSWORD=[REDACTED]',
          workLog: [{ id: 'failed', label: 'setup_execution', state: 'error', kind: 'tool', inspection: { error: 'PASSWORD=[REDACTED]' } }],
        }}
      />,
    );

    expect(screen.getByText("We couldn't finish building the data model.")).toBeInTheDocument();
    expect(screen.getByText('Your data source is still connected. Retry to let the setup agent continue building the data model from where it stopped.')).toBeInTheDocument();
    expect(screen.getByText('Project: acme · postgres')).toBeInTheDocument();
    const technicalDetails = screen.getByRole('button', { name: /Technical details/ });
    expect(technicalDetails).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('host contract diagnostic PASSWORD=[REDACTED]')).not.toBeInTheDocument();
    expect(screen.queryByText('setup_execution')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue & repair' }));
    expect(retry).toHaveBeenCalledTimes(1);
    await user.click(technicalDetails);
    expect(screen.getByText('host contract diagnostic PASSWORD=[REDACTED]')).toBeInTheDocument();
    expect(screen.getByText('setup_execution')).toBeInTheDocument();
  });

  it('connect failure renders its trace only inside Technical details, never as the standalone work log', async () => {
    const user = userEvent.setup();
    useSetupStore.setState({
      selectedStepKey: 'connect',
      connectStream: {
        workLog: [{ id: 'failed-connect', label: 'connect_execution', state: 'error', kind: 'tool', inspection: { error: 'safe detail' } }],
        streaming: false,
        needsInput: false,
        envFieldsLoading: false,
        submittingEnv: false,
        failure: {
          attempt: 'connect', projectName: 'acme', sourceType: 'postgres', error: 'safe error',
          workLog: [{ id: 'failed-connect', label: 'connect_execution', state: 'error', kind: 'tool', inspection: { error: 'safe detail' } }],
        },
      },
    }, false);
    renderWithProviders(<><AppRoutes /><LocationProbe /></>, { route: '/setup' });

    expect(screen.queryByText('connect_execution')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Technical details/ }));
    expect(screen.getAllByText('connect_execution')).toHaveLength(1);
  });

  it('lists the 5 onboarding steps with done/current/todo, but gates data steps on Runtime', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { route: '/setup' });

    const sidebar = screen.getByRole('navigation', { name: 'Setup' });
    expect(within(sidebar).getByText('1. Runtime & models')).toBeInTheDocument();
    expect(within(sidebar).getByText('2. Connect data source')).toBeInTheDocument();
    expect(within(sidebar).getByText('3. Build data model')).toBeInTheDocument();
    expect(within(sidebar).getByText('4. Bind profile')).toBeInTheDocument();
    expect(within(sidebar).getByText('5. Ask')).toBeInTheDocument();

    // First-run: step 1 current, the rest todo — shown by icon+label, not color alone.
    expect(within(sidebar).getByText('In progress')).toBeInTheDocument();
    expect(within(sidebar).getAllByText('Not started')).toHaveLength(4);

    const connect = within(sidebar).getByRole('button', { name: /2\. Connect data source/ });
    expect(connect).toBeDisabled();
    await user.click(connect);
    expect(screen.queryByText('Connect a data source')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Set up with a native session native session' })).not.toBeInTheDocument();
  });

  it('keeps Setup form-led after Runtime completion and reset, without a native session entry', async () => {
    const view = renderWithProviders(<AppRoutes />, { route: '/setup' });
    expect(screen.queryByRole('region', { name: 'Set up with a native session native session' })).not.toBeInTheDocument();

    useSetupStore.setState({
      steps: [
        { key: 'runtime', title: 'Runtime & models', state: 'done' },
        { key: 'connect', title: 'Connect data source', state: 'current' },
        { key: 'context', title: 'Build data model', state: 'todo' },
        { key: 'bind', title: 'Bind profile', state: 'todo' },
        { key: 'ask', title: 'Ask', state: 'todo' },
      ],
      selectedStepKey: 'connect',
    }, false);
    await waitFor(() => expect(screen.getByText('Connect a data source')).toBeInTheDocument());
    expect(screen.queryByRole('region', { name: 'Set up with a native session native session' })).not.toBeInTheDocument();

    useSetupStore.getState().resetSetup();
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Set up with a native session native session' })).not.toBeInTheDocument());
    expect(screen.getByText('Runtime & models')).toBeInTheDocument();
    view.unmount();
  });

  it('renders the canonical context label for an existing persisted step title without changing other stored labels', () => {
    useSetupStore.setState({
      steps: [
        { key: 'runtime', title: 'Runtime & models', state: 'done' },
        { key: 'connect', title: 'Connect data source', state: 'done' },
        { key: 'context', title: 'Build context', state: 'current' },
        { key: 'bind', title: 'Bind profile', state: 'todo' },
        { key: 'ask', title: 'Ask', state: 'todo' },
      ],
      selectedStepKey: 'context',
    }, false);
    renderWithProviders(<AppRoutes />, { route: '/setup' });

    const sidebar = screen.getByRole('navigation', { name: 'Setup' });
    expect(within(sidebar).getByText('3. Build data model')).toBeInTheDocument();
    expect(within(sidebar).queryByText('3. Build context')).not.toBeInTheDocument();
    expect(within(sidebar).getByText('2. Connect data source')).toBeInTheDocument();
  });

  it('step 1: limits authentication to subscription and exposes bundle-derived tier fields', async () => {
    // AntD Segmented renders its semantic `<input type="radio">` with
    // `pointer-events: none` (the visible click surface is a sibling label) —
    // real users click the label, not the hidden input, so disable
    // userEvent's pointer-events hit-test for this test.
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    useSetupStore.setState({
      runtimeSettings: {
        ...fixtureRuntimeSettings,
        subscriptionDriverModel: 'claude-opus',
        apiKeyModel: 'claude-sonnet',
        tierModels: [
          { tier: 'cheap', model: 'claude-haiku' },
          { tier: 'strong', model: 'claude-sonnet' },
        ],
      },
    });
    renderWithProviders(<AppRoutes />, { route: '/setup' });

    expect(screen.getByText('Runtime & models')).toBeInTheDocument();

    expect(screen.getByRole('radio', { name: 'Personal subscription' })).toBeEnabled();
    const apiKeyOption = screen.getByRole('radio', { name: 'API key (BYO)' });
    const localOption = screen.getByRole('radio', { name: 'Local' });
    expect(apiKeyOption).toBeDisabled();
    expect(localOption).toBeDisabled();
    expect(useSetupStore.getState().runtimeSettings.authMode).toBe('subscription');
    await user.click(apiKeyOption);
    await user.click(localOption);
    expect(useSetupStore.getState().runtimeSettings.authMode).toBe('subscription');

    expect(screen.getByRole('combobox', { name: 'Model for cheap tier' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Model for strong tier' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Default model' })).not.toBeInTheDocument();
    expect(screen.queryByText('orchestrator')).not.toBeInTheDocument();

    // Deployment remains out of this per-tier runtime form.
    expect(screen.queryByRole('radio', { name: /Hosted/ })).not.toBeInTheDocument();

    // Saving advances the flow: step 1 done, step 2 current, canvas switches.
    await user.click(screen.getByRole('button', { name: 'Save runtime settings' }));
    expect(useSetupStore.getState().steps.find((s) => s.key === 'runtime')?.state).toBe('done');
    expect(useSetupStore.getState().steps.find((s) => s.key === 'connect')?.state).toBe('current');
    expect(screen.getByText('Connect a data source')).toBeInTheDocument();
  });

  it('steps 2-4 show the connect / context / bind cards', async () => {
    const user = userEvent.setup();
    useSetupStore.setState({
      steps: [
        { key: 'runtime', title: 'Runtime & models', state: 'done' },
        { key: 'connect', title: 'Connect data source', state: 'current' },
        { key: 'context', title: 'Build data model', state: 'todo' },
        { key: 'bind', title: 'Bind profile', state: 'todo' },
        { key: 'ask', title: 'Ask', state: 'todo' },
      ],
      selectedStepKey: 'connect',
    }, false);
    renderWithProviders(<AppRoutes />, { route: '/setup' });

    const sidebar = screen.getByRole('navigation', { name: 'Setup' });

    await user.click(within(sidebar).getByText('2. Connect data source'));
    expect(screen.getByText('Connect a data source')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create project' })).toBeInTheDocument();

    await user.click(within(sidebar).getByText('3. Build data model'));
    // The card title and its action button share the same label, so assert on the card's unique description instead of the
    // (ambiguous) title text.
    expect(
      screen.getByText('Discover the connected schema and build its semantic model foundation.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Build data model' })).toBeInTheDocument();

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
          { key: 'context', title: 'Build data model', state: 'done' },
          { key: 'bind', title: 'Bind profile', state: 'current' },
          { key: 'ask', title: 'Ask', state: 'todo' },
        ],
        selectedStepKey: 'bind',
        verifyGate: false,
      },
      false,
    );
    renderWithProviders(<><AppRoutes /><LocationProbe /></>, { route: '/setup' });
    const sidebar = screen.getByRole('navigation', { name: 'Setup' });

    expect(screen.getByText('Off')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Compile and bind' }));

    expect(useSetupStore.getState().verifyGate).toBe(true);
    expect(useSetupStore.getState().steps.find((s) => s.key === 'bind')?.state).toBe('done');
    expect(useSetupStore.getState().steps.find((s) => s.key === 'ask')?.state).toBe('current');

    // The canvas advanced to the Ask card — a plain CTA, no verify-gate row
    // (that's a bind-time detail shown on the Bind step, not re-shown here).
    expect(screen.getByText('Setup is complete — ask a question about your data.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Go to Ask/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Go to Ask/ }));
    await waitFor(() => expect(screen.getByTestId('location-probe')).toHaveTextContent('/sessions/ask/structured-session-'));
    expect(screen.getByText('Ask anything about your data')).toBeInTheDocument();

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
