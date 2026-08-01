import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppRoutes } from '@/app/App';
import { renderWithProviders } from '@/test/utils';
import { useSessionStore } from '../useSessionStore';
import { fixtureAskSessions } from '../fixtures';

vi.mock('echarts', () => ({
  init: () => ({ setOption() {}, resize() {}, dispose() {} }),
}));

beforeEach(() => {
  localStorage.clear();
  useSessionStore.setState(
    {
      sessionsById: JSON.parse(JSON.stringify(fixtureAskSessions)),
      streaming: {},
      streamError: {},
    },
    false,
  );
});

describe('Ask session selection', () => {
  it('lands on a fresh, empty draft at /ask (not the most recent session)', () => {
    renderWithProviders(<AppRoutes />, { route: '/ask' });
    expect(screen.getByText('Ask anything about your data')).toBeInTheDocument();
    expect(screen.queryByText('What does MRR mean?')).not.toBeInTheDocument();
  });

  it('selecting a different session in the sidebar navigates to it and loads its thread', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { route: '/ask' });

    const sidebar = screen.getByRole('navigation', { name: 'Sessions' });
    await user.click(within(sidebar).getByText('Churn by plan'));

    // Appears in both the sidebar item and the resumed thread's user turn.
    expect(screen.getAllByText('Churn by plan').length).toBe(2);
  });

  it('opening /ask/:sessionId directly loads that session’s thread', () => {
    renderWithProviders(<AppRoutes />, { route: '/ask/s2' });
    // Sidebar item + the resumed thread's own user turn.
    expect(screen.getAllByText('Monthly signups trend').length).toBe(2);
    expect(screen.getByText('Why did revenue rise in July?')).toBeInTheDocument();
  });

  it('the "New session" button is present offline and navigates to /ask', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { route: '/ask/s2' });

    expect(screen.getByText('Why did revenue rise in July?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /new session/i }));

    expect(screen.getByText('Ask anything about your data')).toBeInTheDocument();
    expect(screen.queryByText('Why did revenue rise in July?')).not.toBeInTheDocument();
  });
});
