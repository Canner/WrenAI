import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { ArtifactsSidebar } from '../ArtifactsSidebar';
import { useArtifactsStore } from '../useArtifactsStore';
import { fixtureArtifacts } from '../fixtures';

// ECharts needs a real canvas; stub it in case selecting swaps in a chart tile.
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

describe('ArtifactsSidebar', () => {
  it('lists every artifact with a kind icon and its name', () => {
    renderWithProviders(<ArtifactsSidebar />);
    const sidebar = screen.getByRole('navigation', { name: 'Artifacts' });

    expect(within(sidebar).getByText('Revenue dashboard')).toBeInTheDocument();
    expect(within(sidebar).getByText('Q3 business review')).toBeInTheDocument();
    expect(within(sidebar).getByText('Monthly signups trend')).toBeInTheDocument();
    // Kind icon is an accessible label on its wrapping span, one per kind present.
    expect(within(sidebar).getByLabelText('Dashboard')).toBeInTheDocument();
    expect(within(sidebar).getByLabelText('Report')).toBeInTheDocument();
    expect(within(sidebar).getByLabelText('Chart')).toBeInTheDocument();
  });

  it('shows a verified indicator and a separate shared/published indicator per row', () => {
    renderWithProviders(<ArtifactsSidebar />);
    const sidebar = screen.getByRole('navigation', { name: 'Artifacts' });

    // All three fixtures are verified.
    expect(within(sidebar).getAllByText('Verified')).toHaveLength(3);
    // Only the dashboard (a1) is published; the report and chart are not.
    expect(within(sidebar).getAllByText('Shared')).toHaveLength(1);
    expect(within(sidebar).getAllByText('Not shared')).toHaveLength(2);
  });

  it('selecting an artifact drives useArtifactsStore.select and marks the row current', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ArtifactsSidebar />);
    const sidebar = screen.getByRole('navigation', { name: 'Artifacts' });

    await user.click(within(sidebar).getByText('Monthly signups trend'));

    expect(useArtifactsStore.getState().selectedKey).toBe('a3');
    expect(
      within(sidebar).getByRole('button', { name: /Monthly signups trend/ }),
    ).toHaveAttribute('aria-current', 'true');
  });
});
