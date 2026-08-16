import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { AppRoutes } from '@/app/App';
import { renderWithProviders } from '@/test/utils';

beforeEach(() => {
  localStorage.clear();
});

function LocationProbe() {
  return <output data-testid="location-probe">{useLocation().pathname}</output>;
}

describe('AppShell', () => {
  it('renders the top bar with brand and all nav tabs', () => {
    renderWithProviders(<AppRoutes />, { route: '/ask' });
    expect(screen.getByAltText('WrenAI')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    for (const label of ['Setup', 'Sessions', 'Artifacts', 'Context', 'Harness']) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    }
    // Eval is deferred: `EVAL_UI_ENABLED` keeps it out of the `pages` registry,
    // so it must have no nav entry at all. Restore it to the list above when the
    // flag flips.
    expect(within(nav).queryByRole('link', { name: 'Eval' })).not.toBeInTheDocument();
  });

  it('redirects /eval to the default landing page while Eval is deferred', () => {
    renderWithProviders(<AppRoutes />, { route: '/eval' });
    // Falls through the catch-all to /sessions rather than rendering a dead page.
    expect(screen.getByRole('navigation', { name: 'Sessions' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Runs' })).not.toBeInTheDocument();
  });

  it('redirects the index route to the default landing page (/sessions)', () => {
    renderWithProviders(<AppRoutes />, { route: '/' });
    expect(screen.getByRole('navigation', { name: 'Sessions' })).toBeInTheDocument();
  });

  it('migrates /ask into the Sessions-owned Structured Ask route without losing the rich canvas', async () => {
    renderWithProviders(<><AppRoutes /><LocationProbe /></>, { route: '/ask' });
    await waitFor(() => expect(screen.getByTestId('location-probe')).toHaveTextContent('/sessions/ask'));
    expect(screen.getByText('Ask anything about your data')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Sessions' })).toBeInTheDocument();
    expect(screen.queryByText('Open an existing session or start a separate native agent session from the sidebar.')).not.toBeInTheDocument();
  });

  it('routes the Structured Ask New session choice into the retained rich Ask workflow without creating a native session', async () => {
    const user = userEvent.setup();
    renderWithProviders(<><AppRoutes /><LocationProbe /></>, { route: '/sessions' });

    await user.click(screen.getByRole('button', { name: /new session/i }));
    expect(screen.getByRole('region', { name: 'Structured Ask session' })).toHaveTextContent('Chart-first answers, dashboards, and follow-up questions.');
    expect(screen.getByRole('region', { name: 'Native terminal session' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start Structured Ask' }));

    await waitFor(() => expect(screen.getByTestId('location-probe')).toHaveTextContent('/sessions/ask/structured-session-'));
    expect(screen.getByText('Ask anything about your data')).toBeInTheDocument();
    expect(screen.queryByText('Open an existing session or start a separate native agent session from the sidebar.')).not.toBeInTheDocument();
  });

  it('keeps a direct native Sessions detail URL in the Sessions workbench instead of redirecting it to the registry root', () => {
    renderWithProviders(<><AppRoutes /><LocationProbe /></>, { route: '/sessions/native-recovery-1' });
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/sessions/native-recovery-1');
    expect(screen.getByRole('navigation', { name: 'Sessions' })).toBeInTheDocument();
  });

  it('redirects unknown routes to the default landing page', () => {
    renderWithProviders(<AppRoutes />, { route: '/does-not-exist' });
    expect(screen.getByRole('navigation', { name: 'Sessions' })).toBeInTheDocument();
  });

  it('swaps the contextual sidebar per page when navigating (no reload)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { route: '/sessions' });

    expect(screen.getByRole('navigation', { name: 'Sessions' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Context' }));

    // Sidebar provider swapped from Sessions → Files for the Context page.
    expect(screen.getByRole('navigation', { name: 'Files' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Sessions' })).not.toBeInTheDocument();
  });
});
