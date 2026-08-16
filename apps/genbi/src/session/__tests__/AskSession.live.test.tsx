import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { AskPage } from '@/pages/AskPage';
import { AskSidebar } from '../AskSidebar';

// Force the dispatcher down the live branch regardless of `VITE_BFF_URL`.
vi.mock('@/bff/env', () => ({
  isBffEnabled: () => true,
}));

const createSession = vi.fn();
const getSession = vi.fn();
const listSessions = vi.fn();
const postTurn = vi.fn();
const turnStreamUrl = vi.fn(
  (sessionId: string, turnId: string) => `http://bff.test/api/sessions/${sessionId}/stream?turn=${turnId}`,
);

vi.mock('@/bff/client', () => ({
  createSession: (...args: unknown[]) => createSession(...args),
  getSession: (...args: unknown[]) => getSession(...args),
  listSessions: (...args: unknown[]) => listSessions(...args),
  postTurn: (...args: unknown[]) => postTurn(...args),
  turnStreamUrl: (...args: [string, string]) => turnStreamUrl(...args),
  getRuntimeSettingsReadiness: () => Promise.resolve({ valid: true as const }),
}));

vi.mock('echarts', () => ({
  init: () => ({ setOption() {}, resize() {}, dispose() {} }),
}));

import { useSessionStore } from '../useSessionStore';

// A tiny probe so the test can assert on the *actual* route (MemoryRouter
// doesn't expose its history directly) without adding any app-level test hook.
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
}

function SessionsAskWithLocationProbe() {
  return (
    <>
      <Routes>
        <Route path="/sessions/ask" element={<><AskSidebar /><AskPage /></>} />
        <Route path="/sessions/ask/:sessionId" element={<><AskSidebar /><AskPage /></>} />
      </Routes>
      <LocationProbe />
    </>
  );
}

beforeEach(() => {
  createSession.mockReset();
  getSession.mockReset();
  listSessions.mockReset();
  postTurn.mockReset();
  useSessionStore.setState(
    { sessionsById: {}, streaming: {}, streamError: {}, backendSessionId: {}, sessionList: [] },
    false,
  );
});

describe('AskSession (live mode) — draft to real-id transition', () => {
  it('asking a question from the Sessions-owned draft lazily creates the backend session, keeps the thread visible throughout, and replaces the route onto the real id', async () => {
    createSession.mockResolvedValueOnce({ id: 'real-9', title: 'x', createdAt: 'now', updatedAt: 'now' });
    postTurn.mockResolvedValueOnce({ turnId: 't1', clarify: { prompt: 'Which range?', chips: ['This month'] } });
    // The compatibility sidebar's mount loads once, then lazy-create refreshes it.
    listSessions.mockResolvedValue([{ id: 'real-9', title: 'x', updatedAt: 'now' }]);

    const user = userEvent.setup();
    renderWithProviders(<SessionsAskWithLocationProbe />, { route: '/sessions/ask' });

    expect(screen.getByTestId('location-probe').textContent).toBe('/sessions/ask');

    await user.type(screen.getByLabelText('Ask a question'), 'How much revenue this quarter');
    await user.click(screen.getByRole('button', { name: /send/i }));

    // The just-typed question is visible immediately, and stays visible
    // through the draft → real-id re-key (no flicker, nothing dropped).
    // `findByText` (not a bare `getByText`) because this runs right after
    // `user.click` — under full-parallel-suite CPU contention, the click's
    // React state flush isn't guaranteed to have committed to the DOM by the
    // time the click promise resolves, so a synchronous query here is a
    // known source of flake; `findByText` retries against real DOM mutations
    // instead of assuming a same-tick commit.
    expect(await screen.findByText('How much revenue this quarter')).toBeInTheDocument();

    await vi.waitFor(() => {
      expect(screen.getByTestId('location-probe').textContent).toBe('/sessions/ask/real-9');
    });
    expect(await screen.findByText('How much revenue this quarter')).toBeInTheDocument();

    // The stream response that resolves after the transition still lands.
    await vi.waitFor(() => {
      expect(screen.getByText('Which range?')).toBeInTheDocument();
    });

    expect(createSession).toHaveBeenCalledTimes(1);
    // Once from the compatibility sidebar's mount, once from the lazy-create refresh.
    expect(listSessions).toHaveBeenCalledTimes(2);
  });

  it('a second "New session" click after a draft has converted lands on a fresh empty draft instead of bouncing back to that conversation', async () => {
    createSession.mockResolvedValueOnce({ id: 'real-9', title: 'x', createdAt: 'now', updatedAt: 'now' });
    postTurn.mockResolvedValueOnce({ turnId: 't1', clarify: { prompt: 'Which range?', chips: ['This month'] } });
    listSessions.mockResolvedValue([{ id: 'real-9', title: 'x', updatedAt: 'now' }]);
    const user = userEvent.setup();
    renderWithProviders(<SessionsAskWithLocationProbe />, { route: '/sessions/ask' });
    await user.type(screen.getByLabelText('Ask a question'), 'How much revenue this quarter');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await vi.waitFor(() => { expect(screen.getByTestId('location-probe').textContent).toBe('/sessions/ask/real-9'); });
    await vi.waitFor(() => { expect(screen.getByText('Which range?')).toBeInTheDocument(); });
    await user.click(screen.getByRole('button', { name: /new session/i }));
    await vi.waitFor(() => {
      expect(screen.getByTestId('location-probe').textContent).toBe('/sessions/ask');
      expect(screen.getByText('Ask anything about your data')).toBeInTheDocument();
      expect(screen.queryByText('How much revenue this quarter')).not.toBeInTheDocument();
      expect(screen.queryByText('Which range?')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Ask a question')).toHaveValue('');
    });
  });
});
