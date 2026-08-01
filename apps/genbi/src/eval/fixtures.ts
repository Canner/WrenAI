import type { ComponentScore, EvalRun } from './types';

/**
 * Fixture eval runs for the Eval page. Phase 1 renders GLOBAL scores only
 * (no by-question drill-down) entirely from these mocks (no backend) —
 * obviously synthetic, no customer data. See `src/fixtures/index.ts` for the
 * app-wide fixture convention this follows. Ordered newest-first (matches
 * the sidebar and the run-select default).
 */

const GATE_THRESHOLD = 0.9;

export const fixtureEvalRuns: EvalRun[] = [
  {
    id: 'run-131',
    when: '2026-07-17 09:14',
    score: 0.93,
    gateThreshold: GATE_THRESHOLD,
    gatePass: true,
    regressions: 0,
    cost: '$0.84',
    p50: '1.2s',
  },
  {
    id: 'run-130',
    when: '2026-07-16 09:02',
    score: 0.91,
    gateThreshold: GATE_THRESHOLD,
    gatePass: true,
    regressions: 1,
    cost: '$0.81',
    p50: '1.3s',
  },
  {
    id: 'run-129',
    when: '2026-07-15 09:10',
    score: 0.88,
    gateThreshold: GATE_THRESHOLD,
    gatePass: false,
    regressions: 3,
    cost: '$0.79',
    p50: '1.5s',
  },
  {
    id: 'run-128',
    when: '2026-07-14 09:05',
    score: 0.9,
    gateThreshold: GATE_THRESHOLD,
    gatePass: true,
    regressions: 0,
    cost: '$0.77',
    p50: '1.4s',
  },
  {
    id: 'run-127',
    when: '2026-07-13 09:00',
    score: 0.89,
    gateThreshold: GATE_THRESHOLD,
    gatePass: true,
    regressions: 0,
    cost: '$0.75',
    p50: '1.4s',
  },
];

/** By-component score breakdown, keyed by run id. */
export const fixtureComponentScores: Record<string, ComponentScore[]> = {
  'run-131': [
    { component: 'Schema retrieval', score: 0.97, delta: 0.01 },
    { component: 'SQL generation', score: 0.94, delta: 0.03 },
    { component: 'Verification', score: 0.95, delta: 0.0 },
    { component: 'Narrative', score: 0.88, delta: 0.02 },
  ],
  'run-130': [
    { component: 'Schema retrieval', score: 0.96, delta: 0.0 },
    { component: 'SQL generation', score: 0.91, delta: -0.02 },
    { component: 'Verification', score: 0.95, delta: 0.01 },
    { component: 'Narrative', score: 0.86, delta: 0.01 },
  ],
  'run-129': [
    { component: 'Schema retrieval', score: 0.96, delta: -0.01 },
    { component: 'SQL generation', score: 0.93, delta: -0.04 },
    { component: 'Verification', score: 0.94, delta: -0.03 },
    { component: 'Narrative', score: 0.85, delta: -0.02 },
  ],
  'run-128': [
    { component: 'Schema retrieval', score: 0.97, delta: 0.01 },
    { component: 'SQL generation', score: 0.97, delta: 0.02 },
    { component: 'Verification', score: 0.97, delta: 0.01 },
    { component: 'Narrative', score: 0.87, delta: 0.0 },
  ],
  'run-127': [
    { component: 'Schema retrieval', score: 0.96, delta: 0.0 },
    { component: 'SQL generation', score: 0.95, delta: 0.0 },
    { component: 'Verification', score: 0.96, delta: 0.0 },
    { component: 'Narrative', score: 0.87, delta: 0.0 },
  ],
};
