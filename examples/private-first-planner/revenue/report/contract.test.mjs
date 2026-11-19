import test from 'node:test';
import assert from 'node:assert/strict';
import { payload } from '../test/fixture.mjs';
import { createCapabilities, createOfflineClient, createTransportClient, validateCapabilities } from './contract.mjs';
const binding = { cube_id: 'revenue_health', cube_revision: 'a'.repeat(64) };
const p = payload(), cap = createCapabilities(p, binding);
const q = { lower: p.default_period.lower, upper: p.default_period.upper_exclusive, country: '', channel: '', dimension: 'country', parent: null, comparison: 'prior_year' };
const clone = x => structuredClone(x);

test('projection pins snapshot/cube and excludes private binding fields; rejects inconsistent capabilities', () => {
  assert.equal(cap.grain, 'calendar_month'); assert.deepEqual(cap.hierarchies, []);
  assert.equal(cap.breakdowns[0].kind, 'cross_dimension');
  assert(!JSON.stringify(createCapabilities(p, { ...binding, sql: 'SECRET', connection: 'SECRET' })).includes('SECRET'));
  const changed = clone(p); changed.rows[0][3]++;
  assert.throws(() => validateCapabilities(cap, changed));
  for (const c of [{ ...cap, grain: 'day' }, { ...cap, sql: 'SELECT' }, { ...cap, data_version: 'b'.repeat(64) }]) assert.throws(() => validateCapabilities(c, p));
});
test('offline rollup uses integer sums, ratio of sums, scoped cross breakdown and nullable comparison', async () => {
  const api = createOfflineClient(cap, p);
  const result = (await api.query(q)).result;
  const rows = p.rows.filter(r => r[0] >= q.lower && r[0] < q.upper);
  assert.equal(result.totals.gross_units, rows.reduce((n, r) => n + r[3], 0));
  assert.equal(result.totals.refund_ratio, result.totals.refund_units / result.totals.gross_units);
  const country = result.groups[0].label;
  const drill = (await api.query({ ...q, parent: country })).result;
  assert.equal(drill.dimension, 'channel'); assert.equal(drill.totals.net_units, result.groups[0].net_units);
  const filter = (await api.query({ ...q, country })).result;
  assert.deepEqual(filter.totals, drill.totals);
  const early = (await api.query({ ...q, lower: p.coverage.lower, upper: p.coverage.lower.slice(0, 4) + '-02' })).result;
  assert.equal(early.comparison.covered, false); assert.equal(early.comparison.totals, null); assert.equal(early.insights.net_change.units, null);
  const none = (await api.query({ ...q, comparison: 'none' })).result;
  assert.equal(none.comparison.totals, null);
  for (const patch of [{ dimension: 'city' }, { parent: 'no-such-group' }, { lower: '2024-13' }, { country: 'other' }, { grain: 'day' }, { lower: q.upper }, { comparison: 'forecast' }]) await assert.rejects(api.query({ ...q, ...patch }));
});
test('host seam rejects identity mismatches, stale responses, incomplete results and broken aggregation', async () => {
  const offline = createOfflineClient(cap, p);
  const base = await offline.query(q);
  const send = mutate => createTransportClient(cap, p, async req => mutate({ ...clone(base), ...clone(req) }));
  for (const mutate of [x => ({ ...x, request_id: 0 }), x => ({ ...x, cube_revision: 'b'.repeat(64) }), x => ({ ...x, data_version: 'b'.repeat(64) }), x => ({ ...x, complete: false }), x => ({ ...x, query: { ...x.query, country: 'wrong' } }), x => { x.result.trend.pop(); return x; }, x => { x.result.totals.net_units++; return x; }, x => { x.result.insights.net_change.units = 1; return x; }]) await assert.rejects(send(mutate).query(q));
  assert.deepEqual((await send(x => x).query(q)).result, base.result);
  assert.deepEqual((await send(x => ({ ...x, query: Object.fromEntries(Object.entries(x.query).reverse()) })).query(q)).result, base.result);
  const pending = [];
  const api = createTransportClient(cap, p, req => new Promise(resolve => pending.push(() => resolve({ ...clone(base), ...req }))));
  const first = api.query(q), rejected = assert.rejects(first, /stale_result/), second = api.query(q);
  pending[1](); await second; pending[0](); await rejected;
});
test('zero gross ratio, negative net, empty valid intersection and reserved property names remain valid', async () => {
  const data = clone(p); data.rows = [
    [q.lower, '__proto__', 'constructor', 0, 5],
    [q.lower, 'B', 'Other', 10, 2]
  ];
  const api = createOfflineClient(createCapabilities(data, binding), data);
  const negative = (await api.query({ ...q, country: '__proto__' })).result;
  assert.equal(negative.totals.net_units, -5); assert.equal(negative.totals.refund_ratio, null);
  const empty = (await api.query({ ...q, country: '__proto__', channel: 'Other' })).result;
  assert.equal(empty.empty, true); assert.deepEqual(empty.groups, []); assert.equal(empty.totals.net_units, 0);
});
