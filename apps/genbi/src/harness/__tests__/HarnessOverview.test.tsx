import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { t } from '@/i18n/strings';
import { HarnessOverview } from '../HarnessOverview';
import { fixtureHarnessView } from '../fixtures';

describe('HarnessOverview — Runtime · back-end panel', () => {
  it('leads with the active back-end label and shows no internal Mode A/B terminology', () => {
    const harness = {
      ...fixtureHarnessView,
      runtime: { ...fixtureHarnessView.runtime, backend: 'subscription' as const, label: 'Subscription (claude)' },
    };
    renderWithProviders(<HarnessOverview harness={harness} />);

    expect(screen.getByText('Subscription (claude)')).toBeInTheDocument();
    expect(screen.queryByText(/Mode A/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Mode B/)).not.toBeInTheDocument();
  });

  it('hides the api-key "Also available" row when the active back-end is subscription', () => {
    const harness = {
      ...fixtureHarnessView,
      runtime: { ...fixtureHarnessView.runtime, backend: 'subscription' as const, label: 'Subscription (claude)' },
    };
    renderWithProviders(<HarnessOverview harness={harness} />);

    expect(screen.queryByText('Also available')).not.toBeInTheDocument();
  });

  it('shows the "Also available" subscription hint when the active back-end is api-key', () => {
    const harness = {
      ...fixtureHarnessView,
      runtime: { ...fixtureHarnessView.runtime, backend: 'api-key' as const, label: 'API key (anthropic)' },
    };
    renderWithProviders(<HarnessOverview harness={harness} />);

    expect(screen.getByText('Also available')).toBeInTheDocument();
    expect(screen.getByText('Subscription (Claude Agent SDK)')).toBeInTheDocument();
  });

  it('shows the "Also available" subscription hint when the active back-end is local', () => {
    const harness = {
      ...fixtureHarnessView,
      runtime: { ...fixtureHarnessView.runtime, backend: 'local' as const, label: 'Local (ollama)' },
    };
    renderWithProviders(<HarnessOverview harness={harness} />);

    expect(screen.getByText('Also available')).toBeInTheDocument();
    expect(screen.getByText('Subscription (Claude Agent SDK)')).toBeInTheDocument();
  });

  it('shows the real tier→model bindings from the DTO, not the auth label', () => {
    renderWithProviders(<HarnessOverview harness={fixtureHarnessView} />);

    const runtimePanel = screen.getByText('Runtime · back-end').closest('.ant-card') as HTMLElement;
    expect(within(runtimePanel).getByText('claude-haiku')).toBeInTheDocument();
    expect(within(runtimePanel).getByText('claude-sonnet')).toBeInTheDocument();
  });

  it('renders the Claude Agent SDK dispatcher label alongside the auth back-end, with no Mode A/B terminology', () => {
    const harness = {
      ...fixtureHarnessView,
      runtime: {
        ...fixtureHarnessView.runtime,
        backend: 'subscription' as const,
        label: 'Subscription (claude)',
        dispatcher: 'claude-agent-sdk' as const,
      },
    };
    renderWithProviders(<HarnessOverview harness={harness} />);

    expect(screen.getByText('Subscription (claude)')).toBeInTheDocument();
    expect(screen.getByText('Claude Agent SDK')).toBeInTheDocument();
    expect(screen.queryByText(/Mode A/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Mode B/)).not.toBeInTheDocument();
  });

  it('renders the in-process dispatcher label', () => {
    const harness = {
      ...fixtureHarnessView,
      runtime: {
        ...fixtureHarnessView.runtime,
        backend: 'local' as const,
        label: 'Local (ollama)',
        dispatcher: 'in-process' as const,
      },
    };
    renderWithProviders(<HarnessOverview harness={harness} />);

    expect(screen.getByText('In-process')).toBeInTheDocument();
  });

  it('omits the dispatcher line when the DTO does not send one (older BFF)', () => {
    const { dispatcher: _dispatcher, ...runtimeWithoutDispatcher } = fixtureHarnessView.runtime;
    const harness = { ...fixtureHarnessView, runtime: runtimeWithoutDispatcher };
    renderWithProviders(<HarnessOverview harness={harness} />);

    expect(screen.queryByText(t('harness.dispatcher'))).not.toBeInTheDocument();
  });
});
