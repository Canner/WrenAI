import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { AppRoutes } from '@/app/App';

// Force the dispatcher down the live branch regardless of `VITE_BFF_URL`.
vi.mock('@/bff/env', () => ({
  isBffEnabled: () => true,
}));

const listArtifacts = vi.fn();
const getArtifact = vi.fn();
const postArtifactPublish = vi.fn();
const postArtifactUnsave = vi.fn();

vi.mock('@/bff/client', () => ({
  listArtifacts: (...args: unknown[]) => listArtifacts(...args),
  getArtifact: (...args: unknown[]) => getArtifact(...args),
  postArtifactPublish: (...args: unknown[]) => postArtifactPublish(...args),
  postArtifactUnsave: (...args: unknown[]) => postArtifactUnsave(...args),
  getRuntimeSettingsReadiness: () => Promise.resolve({ valid: true as const }),
}));

// ECharts needs a real canvas; stub it so dashboard/chart tiles render in jsdom.
vi.mock('echarts', () => ({
  init: () => ({ setOption() {}, resize() {}, dispose() {} }),
}));

import { useArtifactsStore } from '../useArtifactsStore';
import { fixtureArtifacts } from '../fixtures';

beforeEach(() => {
  listArtifacts.mockReset();
  getArtifact.mockReset();
  postArtifactPublish.mockReset();
  postArtifactUnsave.mockReset();
  useArtifactsStore.setState(
    {
      selectedKey: fixtureArtifacts[0].key,
      summaries: fixtureArtifacts,
      detailsByKey: {},
      error: undefined,
      detailError: undefined,
    },
    false,
  );
});

describe('Artifacts page (live mode)', () => {
  it('renders the full-page error state when loadArtifacts fails', async () => {
    listArtifacts.mockRejectedValueOnce(new Error('list boom'));

    renderWithProviders(<AppRoutes />, { route: '/artifacts' });

    expect(await screen.findByText('Could not load artifacts')).toBeInTheDocument();
    expect(screen.getByText('list boom')).toBeInTheDocument();
  });

  it('keeps the artifact list visible when a detail fetch fails', async () => {
    listArtifacts.mockResolvedValueOnce(fixtureArtifacts);
    getArtifact.mockRejectedValueOnce(new Error('detail boom'));

    renderWithProviders(<AppRoutes />, { route: '/artifacts' });

    expect(await screen.findByText('Could not load artifact detail')).toBeInTheDocument();
    expect(screen.getByText('detail boom')).toBeInTheDocument();

    // Full-page error state must NOT take over — the sidebar list is unaffected.
    expect(screen.queryByText('Could not load artifacts')).not.toBeInTheDocument();
    const sidebar = screen.getByRole('navigation', { name: 'Artifacts' });
    for (const artifact of fixtureArtifacts) {
      expect(within(sidebar).getByText(artifact.name)).toBeInTheDocument();
    }
  });

  it('unpin: POSTs the unsave route with the session and artifact id, then removes it on success', async () => {
    const user = userEvent.setup();
    const liveArtifact = { ...fixtureArtifacts[2], sessionId: 'session-live-1' };
    useArtifactsStore.setState(
      {
        selectedKey: liveArtifact.key,
        summaries: [liveArtifact],
        detailsByKey: { [liveArtifact.key]: liveArtifact },
        error: undefined,
        detailError: undefined,
      },
      false,
    );
    listArtifacts.mockResolvedValueOnce([liveArtifact]);
    postArtifactUnsave.mockResolvedValueOnce({ unsavedAt: '2026-07-28T00:00:00.000Z' });

    renderWithProviders(<AppRoutes />, { route: '/artifacts' });
    await user.click(screen.getByRole('button', { name: /unpin/i }));

    expect(postArtifactUnsave).toHaveBeenCalledWith('session-live-1', liveArtifact.key);
    expect(await screen.findByText('No artifacts yet')).toBeInTheDocument();
    expect(useArtifactsStore.getState().summaries).toEqual([]);
  });

  it('unpin: leaves the artifact listed when the unsave request fails', async () => {
    const user = userEvent.setup();
    const liveArtifact = { ...fixtureArtifacts[2], sessionId: 'session-live-1' };
    useArtifactsStore.setState(
      {
        selectedKey: liveArtifact.key,
        summaries: [liveArtifact],
        detailsByKey: { [liveArtifact.key]: liveArtifact },
        error: undefined,
        detailError: undefined,
      },
      false,
    );
    listArtifacts.mockResolvedValueOnce([liveArtifact]);
    postArtifactUnsave.mockRejectedValueOnce(new Error('unsave boom'));

    renderWithProviders(<AppRoutes />, { route: '/artifacts' });
    await user.click(screen.getByRole('button', { name: /unpin/i }));

    expect(postArtifactUnsave).toHaveBeenCalledWith('session-live-1', liveArtifact.key);
    // Best-effort failure handling — the artifact is left listed, not removed.
    await Promise.resolve();
    expect(useArtifactsStore.getState().summaries.map((a) => a.key)).toEqual([liveArtifact.key]);
    expect(screen.getByRole('button', { name: /unpin/i })).toBeInTheDocument();
  });
});
