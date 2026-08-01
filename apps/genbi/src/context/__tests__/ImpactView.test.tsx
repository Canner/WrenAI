import { describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { ImpactView } from '../ImpactView';
import { useContextStore } from '../useContextStore';

beforeEach(() => {
  useContextStore.setState(
    { viewMode: 'overview', selectedFileKey: undefined, impactSeedKey: undefined },
    false,
  );
});

describe('ImpactView', () => {
  it('shows an empty state when there is no impact seed selected', () => {
    renderWithProviders(<ImpactView />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('lists downstream dependents grouped by kind, with severity as icon + label (not color alone)', () => {
    useContextStore.setState({ impactSeedKey: 'model.orders' }, false);
    renderWithProviders(<ImpactView />);

    // Seed entity.
    expect(screen.getAllByText(/orders/).length).toBeGreaterThan(0);

    // Severity is text (a non-color a11y channel) — orders is the worst case
    // (a silent downstream measure shift), so it must read "Semantic".
    expect(screen.getByText('Semantic')).toBeInTheDocument();

    // Grouped by kind: 2 relationships, 1 measure, 1 view for `orders`.
    expect(screen.getByText('Relationship: 2')).toBeInTheDocument();
    expect(screen.getByText('Measure: 1')).toBeInTheDocument();
    expect(screen.getByText('View: 1')).toBeInTheDocument();

    // The raw downstream list itself.
    expect(screen.getAllByText('revenue').length).toBeGreaterThan(0);
    expect(screen.getAllByText('top_customers').length).toBeGreaterThan(0);

    // Broken verified pairs (fixture mode) — one resolves to a downstream
    // node's name, the other falls back to raw hit keys.
    expect(screen.getByText('Broken verified pairs')).toBeInTheDocument();
    expect(screen.getByText('Which plan has the most churn by revenue?')).toBeInTheDocument();
    expect(
      screen.getByText('What is total revenue by customer this quarter?'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('revenue').length).toBeGreaterThan(1); // resolved downstream name, reused as a tag
    expect(screen.getByText('total_revenue')).toBeInTheDocument(); // raw key fallback
  });

  it('shows an empty state for broken pairs when the seed has none', () => {
    useContextStore.setState({ impactSeedKey: 'measure.churn_rate' }, false);
    renderWithProviders(<ImpactView />);

    expect(screen.getByText('No verified pairs affected.')).toBeInTheDocument();
  });

  it('shows "None" severity with an icon + label when there are no downstream dependents', () => {
    useContextStore.setState({ impactSeedKey: 'measure.churn_rate' }, false);
    renderWithProviders(<ImpactView />);

    expect(screen.getByText('None')).toBeInTheDocument();
    expect(screen.getByText('No downstream dependents.')).toBeInTheDocument();
  });

  it('renders the deploy-time review action as a disabled placeholder', () => {
    useContextStore.setState({ impactSeedKey: 'model.orders' }, false);
    renderWithProviders(<ImpactView />);

    expect(
      screen.getByRole('button', { name: /Deploy-time blast-radius review/ }),
    ).toBeDisabled();
  });
});
