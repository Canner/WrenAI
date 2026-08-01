import { describe, it, expect, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { ContextSidebar } from '../ContextSidebar';
import { useContextStore } from '../useContextStore';

beforeEach(() => {
  useContextStore.setState(
    { viewMode: 'overview', selectedFileKey: undefined, impactSeedKey: undefined },
    false,
  );
});

describe('ContextSidebar', () => {
  it('renders the wren_project header and the file tree, expanded by default', () => {
    renderWithProviders(<ContextSidebar />);
    const sidebar = screen.getByRole('navigation', { name: 'Files' });

    expect(within(sidebar).getByText('wren_project')).toBeInTheDocument();
    expect(within(sidebar).getByText('models')).toBeInTheDocument();
    expect(within(sidebar).getByText('orders.model.yaml')).toBeInTheDocument();
    expect(within(sidebar).getByText('business-context.md')).toBeInTheDocument();
  });

  it('selecting a leaf file drives useContextStore.selectFile', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContextSidebar />);
    const sidebar = screen.getByRole('navigation', { name: 'Files' });

    await user.click(within(sidebar).getByText('orders.model.yaml'));

    expect(useContextStore.getState().selectedFileKey).toBe('model.orders');
    expect(
      within(sidebar).getByRole('button', { name: /orders\.model\.yaml/ }),
    ).toHaveAttribute('aria-current', 'true');
  });

  it('toggling a directory hides and re-shows its children (folders do not select a file)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContextSidebar />);
    const sidebar = screen.getByRole('navigation', { name: 'Files' });

    const modelsDir = within(sidebar).getByRole('button', { name: 'models' });
    expect(modelsDir).toHaveAttribute('aria-expanded', 'true');
    expect(within(sidebar).getByText('orders.model.yaml')).toBeInTheDocument();

    await user.click(modelsDir);
    expect(modelsDir).toHaveAttribute('aria-expanded', 'false');
    expect(within(sidebar).queryByText('orders.model.yaml')).not.toBeInTheDocument();
    expect(useContextStore.getState().selectedFileKey).toBeUndefined();

    await user.click(modelsDir);
    expect(modelsDir).toHaveAttribute('aria-expanded', 'true');
    expect(within(sidebar).getByText('orders.model.yaml')).toBeInTheDocument();
  });

  it('keeps every row on one line: the icon and filename sit in a single min-width:0 flex row with an ellipsis span', () => {
    renderWithProviders(<ContextSidebar />);
    const sidebar = screen.getByRole('navigation', { name: 'Files' });

    const longNameRow = within(sidebar)
      .getByText('orders_customers.relationship.yaml')
      .closest('.genbi-trow');
    expect(longNameRow).not.toBeNull();
    expect(longNameRow).toHaveClass('genbi-trow');
    expect(within(sidebar).getByText('orders_customers.relationship.yaml')).toHaveClass('genbi-tname');
  });

  it('is keyboard operable: Enter on a focused file button selects it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContextSidebar />);
    const sidebar = screen.getByRole('navigation', { name: 'Files' });

    const fileButton = within(sidebar).getByRole('button', { name: /customers\.model\.yaml/ });
    fileButton.focus();
    await user.keyboard('{Enter}');

    expect(useContextStore.getState().selectedFileKey).toBe('model.customers');
  });
});
