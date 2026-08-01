import { describe, it, expect, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { AppRoutes } from '@/app/App';
import { useContextStore } from '../useContextStore';

beforeEach(() => {
  useContextStore.setState(
    { viewMode: 'overview', selectedFileKey: undefined, impactSeedKey: undefined },
    false,
  );
});

describe('Context page', () => {
  it('lands on the Overview by default, with the wren_project file tree in the sidebar', () => {
    renderWithProviders(<AppRoutes />, { route: '/context' });

    expect(screen.getByRole('navigation', { name: 'Files' })).toBeInTheDocument();
    const sidebar = screen.getByRole('navigation', { name: 'Files' });
    expect(within(sidebar).getByText('wren_project')).toBeInTheDocument();
    expect(within(sidebar).getByText('orders.model.yaml')).toBeInTheDocument();

    // Overview content.
    expect(screen.getByText('Instructions present')).toBeInTheDocument();
  });

  it('selecting a file in the tree shows its read-only content in the canvas', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { route: '/context' });

    const sidebar = screen.getByRole('navigation', { name: 'Files' });
    await user.click(within(sidebar).getByText('orders.model.yaml'));

    expect(screen.getByText(/name: orders/)).toBeInTheDocument();
    // Overview panels are gone — the canvas actually swapped.
    expect(screen.queryByText('Instructions present')).not.toBeInTheDocument();
  });

  it('the Edit CLI prompt names the offline fixture project, unaffected by live wiring', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { route: '/context' });

    const sidebar = screen.getByRole('navigation', { name: 'Files' });
    await user.click(within(sidebar).getByText('orders.model.yaml'));

    await user.click(screen.getByRole('button', { name: /Edit/ }));
    await user.click(screen.getByText('Claude Code CLI'));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('acme-genbi');
  });

  it('navigates from a file to its Impact view and back to Overview', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { route: '/context' });

    const sidebar = screen.getByRole('navigation', { name: 'Files' });
    await user.click(within(sidebar).getByText('orders.model.yaml'));
    await user.click(screen.getByRole('button', { name: /View impact/ }));

    expect(screen.getByText('Semantic')).toBeInTheDocument();
    expect(screen.getByText('Downstream dependents')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Back to overview/ }));
    expect(screen.getByText('Instructions present')).toBeInTheDocument();
  });

  it('a model in the Overview links directly to its Impact view', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { route: '/context' });

    const viewImpactButtons = screen.getAllByRole('button', { name: /View impact/ });
    await user.click(viewImpactButtons[0]);

    expect(screen.getByText('Downstream dependents')).toBeInTheDocument();
  });
});
