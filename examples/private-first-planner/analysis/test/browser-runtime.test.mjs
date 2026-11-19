import test from 'node:test';
import assert from 'node:assert/strict';
import { ReportSession } from '../../host/report.mjs';
import { ports, model, choose, plan, query } from './fixture.mjs';
import { createAggregateClient, validateReport } from '../browser/contract.mjs';
async function fixture() { const q = query(['country', 'channel']); return (await new ReportSession(ports(model(choose(q)), model(plan(q)))).submit('Report')).report; }
const q = { lower: '2024-01-01', upper: '2024-03-01', dimension: 'country', filters: {}, path: [] };
test('generic runtime binds issued source and data identities; aggregates, filters and cross-drills', async () => {
  const report = await fixture(), api = createAggregateClient(report), root = (await api.query(q)).result;
  assert.equal(root.totals.gross, 350); assert.equal(root.totals.net, 290); assert.equal(root.totals.refund_ratio, 60 / 350);
  assert.deepEqual(root.trend.map(x => x.metrics.net), [240, 50]);
  const filtered = (await api.query({ ...q, filters: { country: ['A'] } })).result;
  assert.equal(filtered.totals.net, 140);
  const drilled = (await api.query({ ...q, dimension: 'channel', path: [{ dimension: 'country', value: 'A' }] })).result;
  assert.deepEqual(drilled.totals, filtered.totals); assert.deepEqual(drilled.groups.map(x => x.label), ['Direct', 'Search']);
  const reset = (await api.query(q)).result; assert.deepEqual(reset, root);
  const bad = structuredClone(report); bad.payload.rows[0].gross++;
  assert.throws(() => validateReport(bad));
  for (const patch of [{ dimension: 'city' }, { lower: '2024-01-02' }, { lower: '2023-01-01' }, { filters: { country: ['UNKNOWN'] } }, { path: [{ dimension: 'country', value: 'A' }] }]) await assert.rejects(api.query({ ...q, ...patch }));
});
test('empty valid scope is explicit and non-additive/ratio-only totals do not invent rollups', async () => {
  const report = await fixture(), api = createAggregateClient(report);
  const empty = (await api.query({ ...q, filters: { country: ['B'], channel: ['Direct'] } })).result;
  assert.equal(empty.empty, true); assert.equal(empty.totals.net, 0); assert.equal(empty.totals.refund_ratio, null);
  const request = { ...query(), measures: ['refund_ratio'] };
  const ratio = (await new ReportSession(ports(model(choose(request)))).submit('Ratio')).report;
  const result = (await createAggregateClient(ratio).query(q)).result;
  assert.equal(result.totals.refund_ratio, null); assert.deepEqual(result.unavailable, ['refund_ratio']);
});
