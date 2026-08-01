import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { AppRoutes } from '@/app/App';

// Force the dispatcher down the live branch regardless of `VITE_BFF_URL`.
vi.mock('@/bff/env', () => ({
  isBffEnabled: () => true,
}));

const getHarness = vi.fn();

vi.mock('@/bff/client', () => ({
  getHarness: (...args: unknown[]) => getHarness(...args),
}));

import { useHarnessStore, BOUND_PROFILE_KEY } from '../useHarnessStore';

beforeEach(() => {
  getHarness.mockReset();
  useHarnessStore.setState(
    { selectedProfileKey: BOUND_PROFILE_KEY, harness: undefined, loading: false, error: undefined },
    false,
  );
});

describe('Harness page (live mode, error)', () => {
  it('renders loading then the error state when loadHarness fails', async () => {
    let rejectHarness!: (err: unknown) => void;
    getHarness.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectHarness = reject;
      }),
    );

    renderWithProviders(<AppRoutes />, { route: '/harness' });

    expect(screen.getByText('Loading…')).toBeInTheDocument();

    rejectHarness(new Error('harness boom'));

    expect(await screen.findByText('Could not load harness')).toBeInTheDocument();
    expect(screen.getByText('harness boom')).toBeInTheDocument();
  });
});
