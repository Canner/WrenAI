import { dashboardEnvelope } from '@/fixtures/envelopes';
import type { AnyBlock, ChartBlock, KpiCardBlock, RenderEnvelope, TableBlock } from '@/envelope/types';
import type { Artifact, DashboardTile } from './types';

/**
 * Fixture artifacts for the Artifacts page: one dashboard (multi-tile), one
 * report (file + publish + a safe HTML preview), one chart. Obviously
 * synthetic, no customer data — see `src/fixtures/index.ts` for the app-wide
 * fixture convention this follows.
 */

const DASHBOARD_SOURCE = { label: 'Structured Ask · Turn this into a dashboard', href: '/sessions/ask/s1' };

function isKpiCard(block: AnyBlock): block is KpiCardBlock {
  return block.type === 'kpi_card';
}
function isChart(block: AnyBlock): block is ChartBlock {
  return block.type === 'chart';
}
function isTable(block: AnyBlock): block is TableBlock {
  return block.type === 'table';
}

function envelopeOf(blocks: AnyBlock[]): RenderEnvelope {
  return { verified: true, blocks };
}

const revenueDashboardTiles: DashboardTile[] = [
  ...dashboardEnvelope.blocks.filter(isKpiCard).map((block, i) => ({
    key: `revenue-dashboard-kpi-${i}`,
    title: block.label,
    envelope: envelopeOf([block]),
    source: DASHBOARD_SOURCE,
  })),
  ...dashboardEnvelope.blocks.filter(isChart).map((block, i) => ({
    key: `revenue-dashboard-chart-${i}`,
    title: 'Revenue trend',
    envelope: envelopeOf([block]),
    source: DASHBOARD_SOURCE,
  })),
  ...dashboardEnvelope.blocks.filter(isTable).map((block, i) => ({
    key: `revenue-dashboard-table-${i}`,
    title: 'MRR by plan',
    envelope: envelopeOf([block]),
    source: DASHBOARD_SOURCE,
  })),
];

export const fixtureArtifacts: Artifact[] = [
  {
    key: 'a1',
    name: 'Revenue dashboard',
    kind: 'dashboard',
    verified: true,
    createdAt: '2026-07-17 09:20',
    location: 'artifacts/revenue-dashboard.json',
    publish: { link: 'https://share.genbi.example/revenue-dashboard', scope: 'workspace' },
    tiles: revenueDashboardTiles,
  },
  {
    key: 'a2',
    name: 'Q3 business review',
    kind: 'report',
    verified: true,
    createdAt: '2026-07-14 16:05',
    location: 'artifacts/q3-business-review.html',
    source: { label: 'Compiled from 12 verified Q3 answers' },
    preview: {
      kind: 'html',
      html:
        '<h1>Q3 Business Review</h1>\n<p>Revenue grew 9% quarter over quarter, led by the Enterprise plan.</p>',
    },
  },
  {
    key: 'a3',
    name: 'Monthly signups trend',
    kind: 'chart',
    verified: true,
    createdAt: '2026-07-16 11:40',
    location: 'artifacts/monthly-signups-trend.json',
    source: { label: 'Structured Ask · Monthly signups trend', href: '/sessions/ask/s2' },
    envelope: {
      verified: true,
      summary: 'New signups by month, last 6 months.',
      blocks: [
        {
          type: 'chart',
          chart_type: 'line',
          x: 'month',
          series: ['signups'],
          rows: [
            { month: 'Feb', signups: 210 },
            { month: 'Mar', signups: 244 },
            { month: 'Apr', signups: 268 },
            { month: 'May', signups: 281 },
            { month: 'Jun', signups: 305 },
            { month: 'Jul', signups: 322 },
          ],
        },
      ],
    },
  },
];
