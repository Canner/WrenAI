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

describe('FileViewer — larger real content rendering', () => {
  it('renders a YAML (model) file scrollable, without wrapping (indentation stays significant)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { route: '/context' });

    const sidebar = screen.getByRole('navigation', { name: 'Files' });
    await user.click(within(sidebar).getByText('orders.model.yaml'));

    const pre = screen.getByText(/name: orders/).closest('pre');
    expect(pre).not.toBeNull();
    expect(pre).toHaveStyle({ overflow: 'auto', whiteSpace: 'pre' });
  });

  it('renders a knowledge (markdown prose) file wrapped instead of forcing horizontal scroll', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { route: '/context' });

    const sidebar = screen.getByRole('navigation', { name: 'Files' });
    await user.click(within(sidebar).getByText('business-context.md'));

    const pre = screen.getByText(/Business context/).closest('pre');
    expect(pre).not.toBeNull();
    expect(pre).toHaveStyle({ overflow: 'auto', whiteSpace: 'pre-wrap' });
  });
});
