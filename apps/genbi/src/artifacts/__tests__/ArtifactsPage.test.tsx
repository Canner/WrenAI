import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { AppRoutes } from '@/app/App';
import { useArtifactsStore } from '../useArtifactsStore';
import { fixtureArtifacts } from '../fixtures';

// ECharts needs a real canvas; stub it so dashboard/chart tiles render in jsdom.
vi.mock('echarts', () => ({
  init: () => ({ setOption() {}, resize() {}, dispose() {} }),
}));

beforeEach(() => {
  useArtifactsStore.setState(
    {
      selectedKey: fixtureArtifacts[0].key,
      summaries: fixtureArtifacts,
      detailsByKey: Object.fromEntries(fixtureArtifacts.map((a) => [a.key, a])),
    },
    false,
  );
});

describe('Artifacts page', () => {
  it('dashboard: renders a tile grid with multiple envelope-backed tiles, each with a source', () => {
    renderWithProviders(<AppRoutes />, { route: '/artifacts' });

    // Tiles built from the dashboard envelope's KPI / chart / table blocks. Each
    // KPI tile's title doubles as the block's own Statistic label, so it appears
    // twice (the Panel header + the rendered block) — assert presence, not count.
    expect(screen.getAllByText('Revenue (MTD)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('New customers').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Churn').length).toBeGreaterThan(0);
    expect(screen.getByText('Revenue trend')).toBeInTheDocument();
    expect(screen.getByText('MRR by plan')).toBeInTheDocument();

    // Every tile carries a source attribution, and each tile is independently verified.
    expect(screen.getAllByText(/Source:/).length).toBeGreaterThanOrEqual(5);
    expect(screen.getAllByText('Verified').length).toBeGreaterThanOrEqual(5);

    // Publishing is unimplemented, so `PUBLISH_UI_ENABLED` hides the whole
    // Publish card — no share link, no access scope, no CTA — even for an
    // artifact the fixtures mark as already published. Restore these to
    // positive assertions when the flag flips.
    expect(screen.queryByText('https://share.genbi.example/revenue-dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText('Share link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Publish/ })).not.toBeInTheDocument();
  });

  it('report: shows the file location, publish status, and a safe HTML preview', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { route: '/artifacts' });

    const sidebar = screen.getByRole('navigation', { name: 'Artifacts' });
    await user.click(within(sidebar).getByText('Q3 business review'));

    expect(screen.getByText('artifacts/q3-business-review.html')).toBeInTheDocument();
    // Source is rendered as "Source: <label>" within one text node.
    expect(screen.getByText(/Compiled from 12 verified Q3 answers/)).toBeInTheDocument();

    // No publish affordance at all: `PUBLISH_UI_ENABLED` hides the card, so
    // neither the "not published" state nor the CTA is offered.
    expect(screen.queryByText('Not published yet.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Publish/ })).not.toBeInTheDocument();

    // HTML preview renders as literal, escaped text — never executed as markup.
    expect(screen.getByText(/Shown as a safe, non-executable text preview/)).toBeInTheDocument();
    expect(screen.getByText(/Q3 Business Review/)).toBeInTheDocument();
    expect(document.querySelector('h1')).toBeNull();

    // The store action the (now hidden) CTA drove is still exercised directly,
    // so hiding the UI doesn't silently drop its coverage. Go back to driving
    // it through the button when the flag flips.
    useArtifactsStore.getState().publish('a2');
    expect(useArtifactsStore.getState().detailsByKey.a2.publish?.scope).toBe('workspace');
  });

  it('chart: shows a single verified result via EnvelopeView plus its source', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { route: '/artifacts' });

    const sidebar = screen.getByRole('navigation', { name: 'Artifacts' });
    await user.click(within(sidebar).getByText('Monthly signups trend'));

    expect(screen.getByText('New signups by month, last 6 months.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'line chart' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Structured Ask · Monthly signups trend' })).toHaveAttribute('href', '/sessions/ask/s2');
    expect(screen.queryByRole('button', { name: /Publish/ })).not.toBeInTheDocument();
  });

  it('unpinning the selected artifact removes it from the sidebar and selects another remaining one (fixture mode)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { route: '/artifacts' });

    const sidebar = screen.getByRole('navigation', { name: 'Artifacts' });
    await user.click(within(sidebar).getByText('Monthly signups trend'));
    expect(screen.getByRole('link', { name: 'Structured Ask · Monthly signups trend' })).toBeInTheDocument();

    // Unlike Publish, Unpin is not gated by `PUBLISH_UI_ENABLED` — it's always
    // reachable, so this drives it through the real button rather than the
    // store action directly.
    await user.click(screen.getByRole('button', { name: /unpin/i }));

    expect(within(sidebar).queryByText('Monthly signups trend')).not.toBeInTheDocument();
    // Selection falls back to a remaining artifact instead of an empty canvas.
    expect(useArtifactsStore.getState().summaries.map((a) => a.key)).toEqual(['a1', 'a2']);
    expect(useArtifactsStore.getState().selectedKey).not.toBe('a3');
  });

  it('unpinning the last remaining artifact leaves the page in the same empty state as never having any', async () => {
    const user = userEvent.setup();
    useArtifactsStore.setState(
      { selectedKey: 'a2', summaries: [fixtureArtifacts[1]], detailsByKey: { a2: fixtureArtifacts[1] } },
      false,
    );
    renderWithProviders(<AppRoutes />, { route: '/artifacts' });

    await user.click(screen.getByRole('button', { name: /unpin/i }));

    expect(screen.getByText('No artifacts yet')).toBeInTheDocument();
    expect(useArtifactsStore.getState().summaries).toEqual([]);
    expect(useArtifactsStore.getState().selectedKey).toBe('');
  });

  it('shows an empty state when there are no artifacts', () => {
    useArtifactsStore.setState({ selectedKey: '', summaries: [], detailsByKey: {} }, false);
    renderWithProviders(<AppRoutes />, { route: '/artifacts' });

    expect(screen.getByText('No artifacts yet')).toBeInTheDocument();
    expect(
      screen.getByText('Save a dashboard, report, or chart from an Ask session to see it here.'),
    ).toBeInTheDocument();
  });
});
