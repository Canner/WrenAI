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

  it('keeps long English and CJK names primary while moving lifecycle tags to a secondary row', () => {
    const longEnglish = 'Quarterly revenue retention analysis for enterprise expansion opportunities across every regional sales team';
    const longCjk = '跨區域客戶留存與產品採用趨勢分析報告，協助辨識下一季的成長機會';
    useArtifactsStore.setState({
      selectedKey: 'a1',
      summaries: [
        { ...fixtureArtifacts[0], name: longEnglish },
        { ...fixtureArtifacts[1], name: longCjk },
      ],
    }, false);
    renderWithProviders(<ArtifactsSidebar />);
    const sidebar = screen.getByRole('navigation', { name: 'Artifacts' });
    const selected = within(sidebar).getByRole('button', { name: new RegExp(longEnglish) });
    const cjkName = within(sidebar).getByText(longCjk);

    expect(selected).toHaveAttribute('aria-current', 'true');
    expect(selected).toHaveClass('genbi-arow');
    expect(cjkName).toHaveClass('genbi-aname');
    expect(cjkName).toHaveAttribute('title', longCjk);
    expect(selected.querySelector('.genbi-abadges')).not.toBeNull();
    selected.focus();
    expect(selected).toHaveFocus();
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
