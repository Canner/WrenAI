import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { AppRoutes } from '@/app/App';
import { useEvalStore } from '../useEvalStore';
import { fixtureEvalRuns } from '../fixtures';

// The Eval page is deferred (`EVAL_UI_ENABLED` is off, so it has no nav entry
// or route in the shipped product). The page itself is complete, so these tests
// enable the flag to keep exercising it end-to-end through the real shell —
// coverage that must stay green for the phase that turns it back on.
vi.mock('@/app/features', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/features')>()),
  EVAL_UI_ENABLED: true,
}));

// ECharts needs a real canvas; stub it so the trend chart renders in jsdom.
vi.mock('echarts', () => ({
  init: () => ({ setOption() {}, resize() {}, dispose() {} }),
}));

beforeEach(() => {
  useEvalStore.setState({ selectedRunId: fixtureEvalRuns[0].id }, false);
});

describe('Eval page', () => {
  it('lists the last N eval runs in the sidebar', () => {
    renderWithProviders(<AppRoutes />, { route: '/eval' });

    const sidebar = screen.getByRole('navigation', { name: 'Runs' });
    for (const run of fixtureEvalRuns) {
      expect(within(sidebar).getByText(run.id)).toBeInTheDocument();
    }
  });

  it('shows the selected run KPIs: score, gate pass/fail (icon+label), regressions, cost, p50', () => {
    renderWithProviders(<AppRoutes />, { route: '/eval' });

    // Default selection is the newest run (gate pass, no regressions). AntD
    // Statistic splits numeric values into int/decimal spans, so read the
    // whole stat's text content rather than matching "0.93" as one node.
    // "Score" also labels the by-component table column, so pick the match
    // that lives inside a Statistic.
    const scoreStat = screen
      .getAllByText('Score')
      .map((el) => el.closest('.ant-statistic'))
      .find((el): el is HTMLElement => el !== null);
    expect(scoreStat?.textContent).toContain('0.93');
    expect(screen.getByText('Pass')).toBeInTheDocument();
    expect(screen.getByText('$0.84')).toBeInTheDocument();
    expect(screen.getByText('1.2s')).toBeInTheDocument();
    // Regressions value of 0 is shown as a KPI.
    const regressionsStat = screen.getByText('Regressions').closest('.ant-statistic');
    expect(regressionsStat).not.toBeNull();
    expect(within(regressionsStat as HTMLElement).getByText('0')).toBeInTheDocument();
  });

  it('selecting a different run swaps the detail, including a gate FAIL run with regressions', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { route: '/eval' });

    const sidebar = screen.getByRole('navigation', { name: 'Runs' });
    await user.click(within(sidebar).getByText('run-129'));

    const scoreStat = screen
      .getAllByText('Score')
      .map((el) => el.closest('.ant-statistic'))
      .find((el): el is HTMLElement => el !== null);
    expect(scoreStat?.textContent).toContain('0.88');
    expect(screen.getByText('Fail')).toBeInTheDocument();
    expect(screen.queryByText('Pass')).not.toBeInTheDocument();
    const regressionsStat = screen.getByText('Regressions').closest('.ant-statistic');
    expect(within(regressionsStat as HTMLElement).getByText('3')).toBeInTheDocument();

    // The previously selected run's KPIs are gone — the canvas actually swapped.
    expect(scoreStat?.textContent).not.toContain('0.93');
  });

  it('renders the by-component breakdown table for the selected run', () => {
    renderWithProviders(<AppRoutes />, { route: '/eval' });

    expect(screen.getByText('By component')).toBeInTheDocument();
    expect(screen.getByText('Schema retrieval')).toBeInTheDocument();
    expect(screen.getByText('SQL generation')).toBeInTheDocument();
    expect(screen.getByText('Verification')).toBeInTheDocument();
    expect(screen.getByText('Narrative')).toBeInTheDocument();
  });

  it('renders the score trend chart', () => {
    renderWithProviders(<AppRoutes />, { route: '/eval' });

    expect(screen.getByText('Score trend')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Eval score trend chart' })).toBeInTheDocument();
  });

  it('renders the by-question drill-down as disabled/greyed placeholders', () => {
    renderWithProviders(<AppRoutes />, { route: '/eval' });

    // The "Questions" tab placeholder is present but disabled.
    const questionsTab = screen.getByText('Questions');
    expect(questionsTab.closest('.ant-segmented-item-disabled')).not.toBeNull();

    // Single-question detail + per-question history are non-functional placeholders.
    expect(screen.getByRole('button', { name: /Question list/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Question detail/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Per-question score history/ })).toBeDisabled();
  });
});
