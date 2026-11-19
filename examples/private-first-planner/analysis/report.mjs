import { digest, immutable, requireThat } from '../contracts.mjs';
import { exact } from './contracts.mjs';

// The policy verifier must separately establish semantics, full coverage, source
// revision and authorization from execution evidence; table shape cannot prove them.
export function issueReport({ registry, source, query, execution, receipt }) {
  requireThat(receipt?.verified === true && receipt.complete === true && receipt.source_revision === source.revision
    && receipt.result_digest === digest(execution.result) && receipt.query_digest === digest(query));
  const result = execution.result;
  requireThat(result?.kind === 'table' && Array.isArray(result.columns) && Array.isArray(result.rows) && result.rows.length <= 5000
    && typeof execution.result_ref === 'string' && typeof execution.evidence_ref === 'string');
  const keys = ['period', ...query.dimensions, ...query.measures];
  requireThat(result.columns.length === keys.length && new Set(result.columns.map(c => c.key)).size === keys.length
    && keys.every(k => result.columns.some(c => c.key === k)));
  const seen = new Set(), measures = query.measures.map(k => registry.measures.find(m => m.id === k));
  const rows = result.rows.map(row => {
    exact(row, keys);
    requireThat(typeof row.period === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.period) && Number.isFinite(Date.parse(row.period))
      && new Date(row.period).toISOString().slice(0, 10) === row.period);
    // Week buckets may begin before the filter lower bound; source timestamps
    // must still be filtered to the exact half-open interval by the executor.
    const lower = new Date(query.period.lower);
    if (query.period.grain === 'week') lower.setUTCDate(lower.getUTCDate() - (lower.getUTCDay() + 6) % 7);
    requireThat(row.period >= lower.toISOString().slice(0, 10) && row.period < query.period.upper
      && (query.period.grain !== 'month' || row.period.endsWith('-01'))
      && (query.period.grain !== 'week' || new Date(row.period).getUTCDay() === 1));
    requireThat(query.dimensions.every(d => typeof row[d] === 'string' && row[d].length > 0 && row[d].length <= 120)
      && measures.every(m => row[m.id] === null || typeof row[m.id] === 'number' && Number.isFinite(row[m.id])));
    for (const f of query.filters.filter(f => query.dimensions.includes(f.dimension))) requireThat(f.values.includes(row[f.dimension]));
    for (const m of measures.filter(m => m.aggregation === 'ratio' && query.measures.includes(m.numerator) && query.measures.includes(m.denominator))) {
      const a = row[m.numerator], b = row[m.denominator], expected = a === null || b === null || b === 0 ? null : a / b;
      requireThat(expected === null ? row[m.id] === null : row[m.id] !== null && Math.abs(row[m.id] - expected) <= 1e-9 * Math.max(1, Math.abs(expected)));
    }
    const key = JSON.stringify(['period', ...query.dimensions].map(k => row[k])); requireThat(!seen.has(key)); seen.add(key);
    return Object.fromEntries(keys.map(k => [k, row[k]]));
  });
  const payload = immutable({ version: 'aggregate-report-data/1', columns: keys, rows });
  requireThat(Buffer.byteLength(JSON.stringify(payload)) <= 64 * 1024);
  const dimensions = query.dimensions.map(id => ({ ...registry.dimensions.find(d => d.id === id),
    values: [...new Set(rows.map(row => row[id]))].sort() }));
  return immutable({ capabilities: { version: 'aggregate-report/1',
    source: { kind: source.kind === 'cube' ? 'cube' : 'semantic_query', binding_id: digest([source.id, source.revision]), revision: source.revision },
    query_digest: digest(query), data_version: digest(payload), timezone: 'UTC', interval: 'half_open', period: query.period,
    applied_filters: query.filters, dimensions,
    measures: measures.map(m => ({ ...m, rollup: m.aggregation === 'sum' || m.aggregation === 'ratio' && query.measures.includes(m.numerator) && query.measures.includes(m.denominator) })),
    hierarchies: [], breakdowns: query.dimensions.flatMap(from => query.dimensions.filter(to => to !== from).map(to => ({ from, to, kind: 'cross_dimension' }))),
    complete: true, empty: !rows.length, refresh: 'host_rebind_required' }, payload });
}
