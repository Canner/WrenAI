import { describe, it, expect, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppRoutes } from '@/app/App';
import { renderWithProviders } from '@/test/utils';

beforeEach(() => {
  localStorage.clear();
});

describe('AppShell', () => {
  it('renders the top bar with brand and all nav tabs', () => {
    renderWithProviders(<AppRoutes />, { route: '/ask' });
    expect(screen.getByAltText('WrenAI')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    for (const label of ['Setup', 'Ask', 'Artifacts', 'Context', 'Harness']) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    }
    // Eval is deferred: `EVAL_UI_ENABLED` keeps it out of the `pages` registry,
    // so it must have no nav entry at all. Restore it to the list above when the
    // flag flips.
    expect(within(nav).queryByRole('link', { name: 'Eval' })).not.toBeInTheDocument();
  });

  it('redirects /eval to the default landing page while Eval is deferred', () => {
    renderWithProviders(<AppRoutes />, { route: '/eval' });
    // Falls through the catch-all to /ask rather than rendering a dead page.
    expect(screen.getByRole('navigation', { name: 'Sessions' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Runs' })).not.toBeInTheDocument();
  });

  it('redirects the index route to the default landing page (/ask)', () => {
    renderWithProviders(<AppRoutes />, { route: '/' });
    // Ask's contextual rail is the Sessions list.
    expect(screen.getByRole('navigation', { name: 'Sessions' })).toBeInTheDocument();
  });

  it('redirects unknown routes to the default landing page', () => {
    renderWithProviders(<AppRoutes />, { route: '/does-not-exist' });
    expect(screen.getByRole('navigation', { name: 'Sessions' })).toBeInTheDocument();
  });

  it('swaps the contextual sidebar per page when navigating (no reload)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { route: '/ask' });

    expect(screen.getByRole('navigation', { name: 'Sessions' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Context' }));

    // Sidebar provider swapped from Sessions → Files for the Context page.
    expect(screen.getByRole('navigation', { name: 'Files' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Sessions' })).not.toBeInTheDocument();
  });
});
