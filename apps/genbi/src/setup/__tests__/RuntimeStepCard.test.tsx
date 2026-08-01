import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { AppRoutes } from '@/app/App';
import { useSetupStore } from '../useSetupStore';
import { fixtureInitialMessage, fixtureRuntimeSettings, fixtureSetupSteps } from '../fixtures';

beforeEach(() => {
  useSetupStore.setState(
    {
      steps: fixtureSetupSteps,
      selectedStepKey: 'runtime',
      runtimeSettings: { ...fixtureRuntimeSettings, authMode: 'byo', apiKeyAdapter: 'openai-compatible' },
      adapterEnvStatus: { anthropic: true, openaiCompatible: true },
      verifyGate: false,
      connectedSourceKey: undefined,
      messages: [fixtureInitialMessage],
    },
    false,
  );
});

describe('RuntimeStepCard — frozen API-key onboarding', () => {
  it('normalizes a legacy persisted BYO selection to subscription and hides the API-key form', async () => {
    renderWithProviders(<AppRoutes />, { route: '/setup' });

    await waitFor(() => expect(useSetupStore.getState().runtimeSettings.authMode).toBe('subscription'));
    expect(screen.getByRole('radio', { name: 'Claude Subscription' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: /API key \(BYO\).*temporarily unavailable/ })).toBeDisabled();
    expect(screen.queryByText('API key adapter')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('e.g. claude-sonnet-4-5-20250929')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('https://…')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save runtime settings' })).toBeEnabled();
  });
});
