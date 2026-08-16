import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react'; import userEvent from '@testing-library/user-event'; import { useLocation } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils'; import { AppRoutes } from '@/app/App'; import { fixtureAskSessions } from '../fixtures'; import { useSessionStore } from '../useSessionStore';
vi.mock('echarts', () => ({ init: () => ({ setOption() {}, resize() {}, dispose() {} }) }));
function Location() { return <output data-testid="location">{useLocation().pathname}</output>; }
beforeEach(() => { localStorage.clear(); useSessionStore.setState({ sessionsById: JSON.parse(JSON.stringify(fixtureAskSessions)), streaming: {}, streamError: {}, backendSessionId: {} }, false); });
describe('structured Ask compatibility routes', () => {
  it('redirects a fresh legacy /ask link into the Sessions workbench', async () => { renderWithProviders(<><AppRoutes /><Location /></>, { route: '/ask' }); await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/sessions/ask')); expect(screen.getByText('Ask anything about your data')).toBeInTheDocument(); });
  it('migrates a saved /ask session without losing its rich thread and selects it from the unified sidebar', async () => { const user = userEvent.setup(); renderWithProviders(<><AppRoutes /><Location /></>, { route: '/ask/s2' }); await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/sessions/ask/s2')); expect(screen.getByText('Why did revenue rise in July?')).toBeInTheDocument(); const sidebar = screen.getByRole('navigation', { name: 'Sessions' }); expect(within(sidebar).getByText('Structured Ask')).toBeInTheDocument(); await user.click(within(sidebar).getByText('Churn by plan')); await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/sessions/ask/s3')); expect(screen.getAllByText('Churn by plan').length).toBe(2); });
});
