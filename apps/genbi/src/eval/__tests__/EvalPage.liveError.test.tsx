import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { AppRoutes } from '@/app/App';

// The Eval page is deferred (`EVAL_UI_ENABLED` is off, so it has no nav entry
// or route in the shipped product). The page itself is complete, so these tests
// enable the flag to keep exercising it through the real shell.
vi.mock('@/app/features', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/features')>()),
  EVAL_UI_ENABLED: true,
}));

// Force the dispatcher down the live branch regardless of `VITE_BFF_URL`.
vi.mock('@/bff/env', () => ({
  isBffEnabled: () => true,
}));

const listEvalRuns = vi.fn();
const getEvalRun = vi.fn();

vi.mock('@/bff/client', () => ({
  listEvalRuns: (...args: unknown[]) => listEvalRuns(...args),
  getEvalRun: (...args: unknown[]) => getEvalRun(...args),
  getRuntimeSettingsReadiness: () => Promise.resolve({ valid: true as const }),
}));

// ECharts needs a real canvas; stub it so the trend chart renders in jsdom.
vi.mock('echarts', () => ({
  init: () => ({ setOption() {}, resize() {}, dispose() {} }),
}));

import { useEvalStore } from '../useEvalStore';
import { fixtureEvalRuns } from '../fixtures';

beforeEach(() => {
  listEvalRuns.mockReset();
  getEvalRun.mockReset();
  useEvalStore.setState(
    { selectedRunId: fixtureEvalRuns[0].id, loadingRuns: false, error: undefined },
    false,
  );
});

describe('Eval page (live mode)', () => {
  it('renders loading then the error state when loadRuns fails', async () => {
    let rejectRuns!: (err: unknown) => void;
    listEvalRuns.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectRuns = reject;
      }),
    );

    renderWithProviders(<AppRoutes />, { route: '/eval' });

    expect(screen.getByText('Loading…')).toBeInTheDocument();

    rejectRuns(new Error('runs boom'));

    expect(await screen.findByText('Could not load eval runs')).toBeInTheDocument();
    expect(screen.getByText('runs boom')).toBeInTheDocument();
  });
});
