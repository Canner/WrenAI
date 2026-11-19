import { digest, immutable, requireThat } from '../../contracts.mjs';
import { registry, period, exact, request } from '../contracts.mjs';
import { issueReport } from '../report.mjs';
import { aggregateRuntime } from './runtime.mjs';

// Reuse issuance validation by reconstructing only the public binding, never
// interpreting private metadata or accepting a model's verification receipt.
export function validateReport(report) {
  exact(report, ['capabilities', 'payload']); const c = report.capabilities, p = report.payload;
  exact(c, ['version', 'source', 'query_digest', 'data_version', 'timezone', 'interval', 'period', 'applied_filters', 'dimensions', 'measures', 'hierarchies', 'breakdowns', 'complete', 'empty', 'refresh']);
  exact(c.source, ['kind', 'binding_id', 'revision']); exact(p, ['version', 'columns', 'rows']);
  requireThat(c.version === 'aggregate-report/1' && p.version === 'aggregate-report-data/1' && ['cube', 'semantic_query'].includes(c.source.kind)
    && [c.source.binding_id, c.source.revision, c.query_digest, c.data_version].every(x => /^[a-f0-9]{64}$/.test(x)) && c.data_version === digest(p)
    && c.timezone === 'UTC' && c.interval === 'half_open' && c.complete === true && c.empty === !p.rows?.length && c.refresh === 'host_rebind_required');
  period(c.period); requireThat(Array.isArray(c.dimensions) && Array.isArray(c.measures));
  const dimensions = c.dimensions.map(d => { exact(d, ['id', 'label', 'values']); requireThat(Array.isArray(d.values)); return { id: d.id, label: d.label }; });
  const measures = c.measures.map(m => { exact(m, ['id', 'label', 'unit', 'aggregation', 'numerator', 'denominator', 'rollup']); const { rollup, ...base } = m; return base; });
  // A ratio's dependencies may be outside this snapshot; include their public
  // identities for structural validation, without making them queryable here.
  const validationMeasures = [...measures];
  for (const m of measures.filter(m => m.aggregation === 'ratio')) for (const id of [m.numerator, m.denominator]) if (!validationMeasures.some(x => x.id === id)) validationMeasures.push({ id, label: id, unit: 'unknown', aggregation: 'sum', numerator: null, denominator: null });
  const source = { id: 'report_snapshot', kind: c.source.kind === 'cube' ? 'cube' : 'semantic', revision: c.source.revision,
    dimensions: dimensions.map(d => d.id), measures: measures.map(m => m.id), grains: [c.period.grain], coverage: { lower: c.period.lower, upper: c.period.upper }, capability: 'report', metadata: {} };
  const r = registry({ revision: c.source.revision, dimensions, measures: validationMeasures, sources: [source] });
  const query = { measures: measures.map(m => m.id), dimensions: dimensions.map(d => d.id), period: c.period, filters: c.applied_filters };
  request(query); requireThat(digest(query) === c.query_digest);
  const result = { kind: 'table', columns: p.columns.map(key => ({ key })), rows: p.rows };
  const rebuilt = issueReport({ registry: r, source, query, execution: { result, result_ref: 'snapshot', evidence_ref: 'snapshot' },
    receipt: { verified: true, complete: true, source_revision: source.revision, query_digest: digest(query), result_digest: digest(result) } });
  requireThat(digest({ ...rebuilt.capabilities, source: c.source }) === digest(c) && digest(rebuilt.payload) === digest(p));
  return immutable(report);
}
export function createAggregateClient(report) { const r = validateReport(report); return aggregateRuntime(r.capabilities, r.payload); }
export function aggregateBootstrap(report) {
  const r = validateReport(report), c = JSON.stringify(r.capabilities).replaceAll('<', '\\u003c');
  return `Object.defineProperty(window,'reportData',{value:(${aggregateRuntime.toString()})(${c},window.dashboardData),writable:false,configurable:false});`;
}
