import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { DashboardView } from '../DashboardView';
import { ReportView } from '../ReportView';
import { ChartView } from '../ChartView';
import type { ChartArtifact, DashboardArtifact, ReportArtifact } from '../types';

/**
 * The live BFF persists artifact metadata only (see `bff/client.ts`'s
 * `ArtifactDto` mapping) — no tiles / envelope / preview / source. Each
 * per-kind view must still render the base metadata (name/kind/location/
 * verified/publish) and gracefully omit its rich content instead of throwing
 * when those fields are `undefined`.
 */

const baseMeta = {
  key: 'a1',
  sessionId: 's1',
  name: 'Revenue dashboard',
  verified: true,
  createdAt: '2026-07-17T09:20:00Z',
  location: 'artifacts/revenue-dashboard.json',
};

describe('metadata-only artifacts render without crashing', () => {
  it('DashboardView omits the tile grid when tiles is absent', () => {
    const artifact: DashboardArtifact = { ...baseMeta, kind: 'dashboard' };

    renderWithProviders(<DashboardView artifact={artifact} onPublish={vi.fn()} onUnpin={vi.fn()} />);

    expect(screen.getByText('Revenue dashboard')).toBeInTheDocument();
    expect(screen.getByText('artifacts/revenue-dashboard.json')).toBeInTheDocument();
    expect(
      screen.getByText(/full detail isn.t available yet/),
    ).toBeInTheDocument();
  });

  it('ReportView omits the preview panel when preview is absent', () => {
    const artifact: ReportArtifact = {
      ...baseMeta,
      key: 'a2',
      name: 'Q3 business review',
      kind: 'report',
    };

    renderWithProviders(<ReportView artifact={artifact} onPublish={vi.fn()} onUnpin={vi.fn()} />);

    expect(screen.getByText('Q3 business review')).toBeInTheDocument();
    // Publish card hidden by `PUBLISH_UI_ENABLED` while publishing is unimplemented.
    expect(screen.queryByText('Not published yet.')).not.toBeInTheDocument();
    expect(screen.getByText(/full detail isn.t available yet/)).toBeInTheDocument();
    expect(screen.queryByText('Preview')).not.toBeInTheDocument();
  });

  it('ChartView omits the chart when envelope is absent', () => {
    const artifact: ChartArtifact = {
      ...baseMeta,
      key: 'a3',
      name: 'Monthly signups trend',
      kind: 'chart',
    };

    renderWithProviders(<ChartView artifact={artifact} onPublish={vi.fn()} onUnpin={vi.fn()} />);

    expect(screen.getByText('Monthly signups trend')).toBeInTheDocument();
    expect(screen.getByText(/full detail isn.t available yet/)).toBeInTheDocument();
    // Icons (verified badge, publish icon, etc.) also carry role="img" — assert
    // specifically that no chart was rendered, not that no icon exists.
    expect(screen.queryByRole('img', { name: 'line chart' })).not.toBeInTheDocument();
  });
});
