import { digest, immutable, requireThat } from '../../contracts.mjs';
import { validatePayload } from '../contracts.mjs';
import { reportRuntime } from './runtime.mjs';
const dimensions = ['country', 'channel'];
const catalog = p => Object.fromEntries(dimensions.map((d, i) => [d, [...new Set(p.rows.map(r => r[i + 1]))].sort()]));

// An operator/host must first reconcile this specific additive snapshot binding
// against the private cube. This projection is not a general MDL interpreter.
export function createCapabilities(payload, { cube_id, cube_revision }) {
  const p = validatePayload(payload);
  requireThat(typeof cube_id === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(cube_id) && /^[a-f0-9]{64}$/.test(cube_revision));
  return immutable({ version: 'revenue-report/1', cube: { id: cube_id, revision: cube_revision }, data_version: digest(p),
    currency: p.currency, amount_scale: p.amount_scale, timezone: p.timezone, coverage: p.coverage,
    grain: 'calendar_month', dimensions, measures: ['gross', 'refunds', 'net', 'refund_ratio'],
    comparisons: ['none', 'prior_year'], hierarchies: [],
    breakdowns: [{ from: 'country', to: 'channel', kind: 'cross_dimension' }, { from: 'channel', to: 'country', kind: 'cross_dimension' }],
    catalog: catalog(p), semantics: { money: 'integer_units', net: 'gross_minus_refunds', refund_ratio: 'ratio_of_sums', interval: 'half_open', missing_comparison: 'null' } });
}
export function validateCapabilities(cap, payload) {
  const expected = createCapabilities(payload, { cube_id: cap?.cube?.id, cube_revision: cap?.cube?.revision });
  requireThat(digest(cap) === digest(expected));
  return expected;
}
export function createOfflineClient(cap, payload) {
  return reportRuntime(validateCapabilities(cap, payload), { payload: validatePayload(payload) });
}
// Host-only binding. A future authenticated transport must validate capabilities
// from its own trusted registry, enforce authorization and execute semantic queries.
export function createTransportClient(cap, authorizedSnapshot, transport) {
  requireThat(typeof transport === 'function');
  return reportRuntime(validateCapabilities(cap, authorizedSnapshot), { transport });
}
export function reportBootstrap(cap, payload) {
  const admitted = validateCapabilities(cap, payload);
  const json = JSON.stringify(admitted).replaceAll('<', '\\u003c');
  return `Object.defineProperty(window,'reportData',{value:(${reportRuntime.toString()})(${json},{payload:window.dashboardData}),writable:false,configurable:false});`;
}
