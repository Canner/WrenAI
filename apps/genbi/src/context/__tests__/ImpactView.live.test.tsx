import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import type { ImpactData } from '../types';

// Force the dispatcher down the live branch regardless of `VITE_BFF_URL`.
vi.mock('@/bff/env', () => ({
  isBffEnabled: () => true,
}));

const getContextImpact = vi.fn();

vi.mock('@/bff/client', () => ({
  getContextImpact: (...args: unknown[]) => getContextImpact(...args),
  getRuntimeSettingsReadiness: () => Promise.resolve({ valid: true as const }),
}));

import { ImpactView } from '../ImpactView';
import { useContextStore } from '../useContextStore';

const liveImpactData: ImpactData = {
  blastRadius: {
    seed: { key: 'model.orders', name: 'orders', kind: 'model' },
    downstream: [{ key: 'measure.revenue', name: 'revenue', kind: 'measure' }],
    severity: 'semantic',
  },
  brokenPairs: [
    {
      question: 'What is total revenue by customer this quarter?',
      refs: ['customers', 'orders', 'total_revenue'],
      hitDownstreamKeys: ['orders', 'total_revenue'],
    },
  ],
};

beforeEach(() => {
  getContextImpact.mockReset();
  useContextStore.setState(
    {
      viewMode: 'overview',
      selectedFileKey: undefined,
      impactSeedKey: undefined,
      liveImpactByKey: {},
      impactError: undefined,
    },
    false,
  );
});

describe('ImpactView (live mode)', () => {
  it('renders the fetched broken pairs, falling back to raw keys when a hit has no matching downstream node', async () => {
    getContextImpact.mockResolvedValueOnce(liveImpactData);

    renderWithProviders(<ImpactView />);
    useContextStore.getState().showImpact('model.orders');

    await waitFor(() => {
      expect(screen.getByText('What is total revenue by customer this quarter?')).toBeInTheDocument();
    });

    // Neither "orders" nor "total_revenue" matches a downstream node key, so
    // both are shown as raw fallback keys ("orders" also appears elsewhere,
    // e.g. as the seed name and in the ER diagram).
    expect(screen.getAllByText('orders').length).toBeGreaterThan(0);
    expect(screen.getByText('total_revenue')).toBeInTheDocument();
  });

  it('shows the empty state when the live fetch returns no broken pairs', async () => {
    getContextImpact.mockResolvedValueOnce({
      blastRadius: {
        seed: { key: 'measure.churn_rate', name: 'churn_rate', kind: 'measure' },
        downstream: [],
        severity: 'none',
      },
      brokenPairs: [],
    } satisfies ImpactData);

    renderWithProviders(<ImpactView />);
    useContextStore.getState().showImpact('measure.churn_rate');

    await waitFor(() => {
      expect(screen.getByText('No verified pairs affected.')).toBeInTheDocument();
    });
  });
});
