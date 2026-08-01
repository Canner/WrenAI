import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { AppRoutes } from '@/app/App';

// Force the dispatcher down the live branch regardless of `VITE_BFF_URL`.
vi.mock('@/bff/env', () => ({
  isBffEnabled: () => true,
}));

const listSessions = vi.fn();
const getSession = vi.fn();
const createSession = vi.fn();
const postTurn = vi.fn();
const turnStreamUrl = vi.fn(
  (sessionId: string, turnId: string) => `http://bff.test/api/sessions/${sessionId}/stream?turn=${turnId}`,
);

vi.mock('@/bff/client', () => ({
  listSessions: (...args: unknown[]) => listSessions(...args),
  getSession: (...args: unknown[]) => getSession(...args),
  createSession: (...args: unknown[]) => createSession(...args),
  postTurn: (...args: unknown[]) => postTurn(...args),
  turnStreamUrl: (...args: [string, string]) => turnStreamUrl(...args),
}));

vi.mock('echarts', () => ({
  init: () => ({ setOption() {}, resize() {}, dispose() {} }),
}));

import { useSessionStore } from '../useSessionStore';

beforeEach(() => {
  listSessions.mockReset();
  getSession.mockReset();
  createSession.mockReset();
  postTurn.mockReset();
  useSessionStore.setState(
    { sessionsById: {}, streaming: {}, streamError: {}, backendSessionId: {}, sessionList: [] },
    false,
  );
});

describe('AskSidebar (live mode)', () => {
  it('loads and lists real, persisted sessions from the BFF alongside the New session button', async () => {
    listSessions.mockResolvedValueOnce([
      { id: 's-a', title: 'Revenue this quarter', updatedAt: '2m ago' },
      { id: 's-b', title: 'Churn by plan', updatedAt: '1h ago' },
    ]);

    renderWithProviders(<AppRoutes />, { route: '/ask' });

    expect(screen.getByRole('button', { name: /new session/i })).toBeInTheDocument();
    const sidebar = screen.getByRole('navigation', { name: 'Sessions' });
    expect(await within(sidebar).findByText('Revenue this quarter')).toBeInTheDocument();
    expect(within(sidebar).getByText('Churn by plan')).toBeInTheDocument();
  });

  it('shows the empty-list hint (and still the button) when there are no sessions yet', async () => {
    listSessions.mockResolvedValueOnce([]);

    renderWithProviders(<AppRoutes />, { route: '/ask' });

    expect(screen.getByRole('button', { name: /new session/i })).toBeInTheDocument();
    expect(await screen.findByText('No sessions yet')).toBeInTheDocument();
  });

  it('New session navigates to /ask, landing on an empty draft', async () => {
    getSession.mockResolvedValueOnce({
      id: 's-a',
      title: 'Revenue',
      updatedAt: 'now',
      events: [{ id: 'e1', kind: 'user', text: 'How much revenue?' }],
      workLog: [],
    });
    listSessions.mockResolvedValue([{ id: 's-a', title: 'Revenue', updatedAt: 'now' }]);

    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { route: '/ask/s-a' });

    expect(await screen.findByText('How much revenue?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /new session/i }));

    expect(screen.getByText('Ask anything about your data')).toBeInTheDocument();
    expect(screen.queryByText('How much revenue?')).not.toBeInTheDocument();
    // The draft is local-only — navigating to it never calls createSession.
    expect(createSession).not.toHaveBeenCalled();
  });
});
