import { describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { Overview } from '../Overview';
import { useContextStore } from '../useContextStore';

beforeEach(() => {
  useContextStore.setState(
    { viewMode: 'overview', selectedFileKey: undefined, impactSeedKey: undefined },
    false,
  );
});

describe('Context Overview', () => {
  it('shows the fixture project name and bound filesystem path', () => {
    renderWithProviders(<Overview />);
    expect(screen.getByText('acme-genbi')).toBeInTheDocument();
    expect(screen.getByText('/Users/you/wren-projects/acme-genbi')).toBeInTheDocument();
  });

  it('shows a stats toolbar with the model, relationship, and measure counts', () => {
    renderWithProviders(<Overview />);
    const toolbar = document.querySelector('.genbi-mdl-toolbar');
    expect(toolbar).toHaveTextContent('3 models');
    expect(toolbar).toHaveTextContent('2 relationships');
    expect(toolbar).toHaveTextContent('2 measures');
  });

  it('renders the ER diagram with one node per model and one edge per relationship', () => {
    renderWithProviders(<Overview />);
    expect(screen.getByRole('img', { name: 'Entity relationship diagram' })).toBeInTheDocument();
    expect(document.querySelector('[data-testid="er-node-model.orders"]')).toBeInTheDocument();
    expect(document.querySelector('[data-testid="er-edge-relationship.orders_customers"]')).toBeInTheDocument();
  });

  it('renders each ER model node as a card with column rows and PK/FK key pills', () => {
    renderWithProviders(<Overview />);
    const ordersNode = document.querySelector('[data-testid="er-node-model.orders"]');
    expect(ordersNode).toBeInTheDocument();
    expect(ordersNode?.querySelector('.genbi-mh')).toHaveTextContent('orders');
    expect(ordersNode?.querySelectorAll('.genbi-key-pk').length).toBe(1);
    expect(ordersNode?.querySelectorAll('.genbi-key-fk').length).toBe(2);
    expect(ordersNode).toHaveTextContent('order_id');
    expect(ordersNode).toHaveTextContent('varchar');
  });

  it('lists relationships in the side rail', () => {
    renderWithProviders(<Overview />);
    expect(screen.getByText(/orders → customers/)).toBeInTheDocument();
    expect(screen.getByText(/orders → products/)).toBeInTheDocument();
    expect(screen.getAllByText('many-to-one').length).toBe(2);
  });

  it('lists each measure with its expression, flagged additive or non-additive', () => {
    renderWithProviders(<Overview />);
    expect(screen.getByText('revenue')).toBeInTheDocument();
    expect(screen.getByText('SUM(amount)')).toBeInTheDocument();
    expect(screen.getByText('churn_rate')).toBeInTheDocument();
    expect(screen.getByText('churned_customers / total_customers')).toBeInTheDocument();
    expect(screen.getByText('Additive')).toBeInTheDocument();
    expect(screen.getByText('Non-additive')).toBeInTheDocument();
  });

  it('shows knowledge status: instructions present + verified pair count', () => {
    renderWithProviders(<Overview />);
    expect(screen.getByText('Instructions present')).toBeInTheDocument();
    expect(screen.getAllByText('Yes').length).toBeGreaterThan(0);
    expect(screen.getByText('Verified Question-SQL pairs')).toBeInTheDocument();
    expect(screen.getAllByText('18').length).toBeGreaterThan(0);
  });

  it('reaches the Impact view by clicking an ER model node', async () => {
    // Overview only triggers the transition (via useContextStore.showImpact);
    // ContextPage is what swaps in ImpactView for viewMode === 'impact' — see
    // ContextPage.test.tsx for the full transition through to the rendered view.
    const user = userEvent.setup();
    renderWithProviders(<Overview />);

    await user.click(screen.getByRole('button', { name: /View impact: orders/ }));
    expect(useContextStore.getState().viewMode).toBe('impact');
    expect(useContextStore.getState().impactSeedKey).toBe('model.orders');
  });

  it('gives every measure and relationship its own "View impact" link', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Overview />);

    // 2 measures + 2 relationships, each with a plain "View impact" link
    // (distinct from the ER nodes' "View impact: <model>" labels).
    const viewImpactButtons = screen.getAllByRole('button', { name: /^View impact$/ });
    expect(viewImpactButtons.length).toBe(4);

    await user.click(viewImpactButtons[0]);
    expect(useContextStore.getState().viewMode).toBe('impact');
    expect(useContextStore.getState().impactSeedKey).toBe('measure.revenue');
  });

  it('renders out-of-scope items as disabled placeholders', () => {
    renderWithProviders(<Overview />);
    expect(
      screen.getByRole('button', { name: /In-app YAML\/SQL editing/ }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: /Context Copilot/ })).toBeDisabled();
  });
});
