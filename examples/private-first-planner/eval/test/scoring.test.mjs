import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreData } from '../scoring.mjs';

const caps = [{ id: 'analytics', description: 'Read-only analysis', rules: true }];
const group = { id: 'total', capability: 'analytics', metric: 'Revenue using the project definition', grain: 'scalar' };
const constraints = { period: { lower: '2026-01-01', upper: '2026-01-19', timezone: 'UTC' }, filters: ['exclude test orders'], requested_statuses: [] };
const plan = { name: 'plan_queries', args: { objective: 'Revenue', constraints, groups: [group] } };
const clarify = { name: 'clarify_intent', args: { question: 'Which metric and period?' } };

test('oracle rejects wrong values or date bounds even when the service says completed', () => {
  const expected = { groups: 1, scalar: 770 };
  const snapshot = { state: 'completed', results: [{ group,
    result: { kind: 'table', timezone: 'UTC', columns: [{ key: 'c9', label: 'Amount' }], rows: [{ c9: 770 }] },
    evidence: { applied_period: { lower: '2026-01-01', upper: '2026-01-19', lower_inclusive: true, upper_inclusive: false } },
  }] };
  assert.equal(scoreData(snapshot, expected).passed, true);
  snapshot.results[0].result.rows[0].c9 = 1550;
  assert.equal(scoreData(snapshot, expected).passed, false);
  snapshot.results[0].result.rows[0].c9 = 770;
  snapshot.results[0].evidence.applied_period.lower = '2026-01-01T00:00:00';
  snapshot.results[0].evidence.applied_period.upper = '2026-01-19T00:00:00';
  assert.equal(scoreData(snapshot, expected).passed, true);
  snapshot.results[0].evidence.applied_period.lower = '2026-01-01T01:00:00';
  assert.equal(scoreData(snapshot, expected).passed, false);
  snapshot.results[0].evidence.applied_period.lower = '2026-01-01T00:00:00';
  snapshot.results[0].result.timezone = 'Asia/Taipei';
  assert.equal(scoreData(snapshot, expected).passed, false);
  snapshot.results[0].result.timezone = 'UTC';
  snapshot.results[0].evidence.applied_period.upper = '2026-01-20';
  assert.equal(scoreData(snapshot, expected).passed, false);
  assert.equal(scoreData({ results: [] }, expected).passed, false);
});
