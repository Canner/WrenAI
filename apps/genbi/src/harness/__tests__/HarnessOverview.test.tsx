import { describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { HarnessOverview } from '../HarnessOverview';
import { fixtureHarnessView, fixtureHarnessViews } from '../fixtures';

describe('HarnessOverview', () => {
  it('presents compiled dispatch and native session targets separately in the primary execution path', () => {
    renderWithProviders(<HarnessOverview harness={fixtureHarnessView} />);

    const execution = screen.getByText('Execution path').closest('.ant-card') as HTMLElement;
    expect(execution).toHaveTextContent('analysis');
    expect(execution).toHaveTextContent('genbi-default');
    expect(execution).toHaveTextContent('Compiled dispatch target');
    expect(execution).toHaveTextContent(fixtureHarnessView.profile.dispatchTarget);
    expect(execution).toHaveTextContent('Native session target');
    expect(execution).toHaveTextContent('Claude CLI');
    expect(execution).toHaveTextContent('Ready');
    expect(screen.getByText('Answer Query')).toBeInTheDocument();
    expect(screen.queryByText('Compiled bundle')).not.toBeInTheDocument();
    expect(screen.queryByText('Authentication back-end')).not.toBeInTheDocument();
    expect(screen.queryByText('Active runtime target')).not.toBeInTheDocument();
  });

  it('presents the form-led Setup runner instead of a native session target for Setup', () => {
    renderWithProviders(<HarnessOverview harness={fixtureHarnessViews.setup} />);

    const execution = screen.getByText('Execution path').closest('.ant-card') as HTMLElement;
    expect(execution).toHaveTextContent('setup');
    expect(execution).toHaveTextContent('Setup runner');
    expect(execution).toHaveTextContent('Claude Setup runner');
    expect(execution).not.toHaveTextContent('Native session target');
  });

  it('keeps implementation detail in expandable diagnostics and distinguishes backend from dispatcher', () => {
    renderWithProviders(<HarnessOverview harness={fixtureHarnessView} />);

    const runtimeToggle = screen.getByRole('button', { name: /Runtime and model binding/ });
    expect(runtimeToggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(runtimeToggle);
    expect(screen.getByText('Authentication back-end')).toBeInTheDocument();
    expect(screen.getByText('Subscription (claude)')).toBeInTheDocument();
    expect(screen.getByText('Dispatcher implementation')).toBeInTheDocument();
    expect(screen.getByText('Claude Agent SDK')).toBeInTheDocument();
    expect(screen.getByText('claude-haiku')).toBeInTheDocument();
    expect(screen.queryByText(/in-process/)).not.toBeInTheDocument();
    expect(screen.queryByText(/dispatched/)).not.toBeInTheDocument();
  });

  it('shows an unavailable component and its reason in the primary table without an executable expander', () => {
    const unavailable = {
      ...fixtureHarnessView,
      components: [{ ...fixtureHarnessView.components[0], status: 'unavailable', unavailableReason: 'runtime capability is not configured' }],
    };
    renderWithProviders(<HarnessOverview harness={unavailable} />);

    const row = screen.getAllByRole('row').find((candidate) => within(candidate).queryByText('Explore Model'));
    expect(row).toBeDefined();
    expect(within(row!).getByText('Unavailable: runtime capability is not configured')).toBeInTheDocument();
    expect(within(row!).queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps bundle, connection, capabilities, and guardrails collapsed until requested', () => {
    renderWithProviders(<HarnessOverview harness={fixtureHarnessView} />);

    expect(screen.queryByText('analytics-prod')).not.toBeInTheDocument();
    expect(screen.queryByText('read_only_execution')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Profile and compiled bundle/ }));
    expect(screen.getByText('Compiled bundle')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Data source · connection/ }));
    expect(screen.getByText('analytics-prod')).toBeInTheDocument();
  });
});
