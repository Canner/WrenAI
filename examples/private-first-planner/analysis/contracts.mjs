import { digest, immutable, requireThat } from '../contracts.mjs';
import { artifact } from './behaviors/index.mjs';
export const exact = (v, keys) => requireThat(v && Object.getPrototypeOf(v) === Object.prototype && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k)));
const id = v => typeof v === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(v);
const text = v => typeof v === 'string' && v.trim().length > 0 && v.length <= 4096;
const ids = (v, max = 8) => Array.isArray(v) && v.length <= max && v.every(id) && new Set(v).size === v.length;
const date = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
export function period(p) {
  exact(p, ['lower', 'upper', 'grain']);
  requireThat(date(p.lower) && date(p.upper) && p.lower < p.upper && ['day', 'week', 'month'].includes(p.grain));
  if (p.grain === 'month') requireThat(p.lower.endsWith('-01') && p.upper.endsWith('-01'));
  return p;
}
export function request(q) {
  exact(q, ['measures', 'dimensions', 'period', 'filters']); period(q.period);
  requireThat(ids(q.measures) && q.measures.length > 0 && ids(q.dimensions, 4) && !q.dimensions.includes('period') && Array.isArray(q.filters) && q.filters.length <= 8);
  const seen = new Set();
  for (const f of q.filters) {
    exact(f, ['dimension', 'values']); requireThat(id(f.dimension) && !seen.has(f.dimension) && Array.isArray(f.values) && f.values.length > 0 && f.values.length <= 100
      && new Set(f.values).size === f.values.length && f.values.every(x => text(x) && x.length <= 120)); seen.add(f.dimension);
  }
  return immutable(q);
}
export function registry(value) {
  exact(value, ['revision', 'measures', 'dimensions', 'sources']);
  requireThat(/^[a-f0-9]{64}$/.test(value.revision) && Array.isArray(value.sources) && value.sources.length <= 64 && Array.isArray(value.measures) && Array.isArray(value.dimensions));
  const names = new Set();
  for (const m of value.measures) {
    exact(m, ['id', 'label', 'unit', 'aggregation', 'numerator', 'denominator']);
    requireThat(id(m.id) && m.id !== 'period' && !names.has(m.id) && text(m.label) && text(m.unit) && ['sum', 'ratio', 'non_additive'].includes(m.aggregation)); names.add(m.id);
    requireThat(m.aggregation === 'ratio' ? id(m.numerator) && id(m.denominator) : m.numerator === null && m.denominator === null);
  }
  for (const m of value.measures.filter(x => x.aggregation === 'ratio')) requireThat([m.numerator, m.denominator].every(key => value.measures.some(x => x.id === key && x.aggregation === 'sum')));
  for (const d of value.dimensions) { exact(d, ['id', 'label']); requireThat(id(d.id) && d.id !== 'period' && !names.has(d.id) && text(d.label)); names.add(d.id); }
  const sources = new Set();
  for (const s of value.sources) {
    exact(s, ['id', 'kind', 'revision', 'measures', 'dimensions', 'grains', 'coverage', 'capability', 'metadata']);
    requireThat(id(s.id) && !sources.has(s.id) && ['cube', 'semantic'].includes(s.kind) && /^[a-f0-9]{64}$/.test(s.revision)
      && ids(s.measures) && s.measures.length > 0 && s.measures.every(k => value.measures.some(m => m.id === k))
      && ids(s.dimensions, 16) && s.dimensions.every(k => value.dimensions.some(d => d.id === k))
      && Array.isArray(s.grains) && s.grains.length > 0 && new Set(s.grains).size === s.grains.length && s.grains.every(g => ['day', 'week', 'month'].includes(g))
      && id(s.capability) && s.metadata && typeof s.metadata === 'object');
    exact(s.coverage, ['lower', 'upper']); requireThat(date(s.coverage.lower) && date(s.coverage.upper) && s.coverage.lower < s.coverage.upper); sources.add(s.id);
  }
  return immutable(value);
}
export function covers(s, q) {
  return q.measures.every(k => s.measures.includes(k)) && [...q.dimensions, ...q.filters.map(f => f.dimension)].every(k => s.dimensions.includes(k))
    && s.grains.includes(q.period.grain) && s.coverage.lower <= q.period.lower && s.coverage.upper >= q.period.upper;
}
export function plannerContext(r) {
  return immutable({ revision: r.revision, measures: r.measures, dimensions: r.dimensions,
    sources: r.sources.map(({ metadata, capability, ...s }) => s) });
}
const obj = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const str = { type: 'string' }, nullable = x => ({ anyOf: [x, { type: 'null' }] });
const querySchema = obj({ measures: { type: 'array', items: str, minItems: 1, maxItems: 8 }, dimensions: { type: 'array', items: str, maxItems: 4 },
  period: obj({ lower: str, upper: str, grain: { type: 'string', enum: ['day', 'week', 'month'] } }),
  filters: { type: 'array', maxItems: 8, items: obj({ dimension: str, values: { type: 'array', items: str, minItems: 1, maxItems: 100 } }) } });
const schema = worker => obj({ status: { type: 'string', enum: ['ready', 'clarify', 'unsupported'] },
  ...(worker ? { source_id: nullable(str), query: nullable(querySchema) } : { route: { type: 'string', enum: ['cube', 'semantic_query', 'none'] }, cube_id: nullable(str), request: nullable(querySchema) }),
  question: nullable(str), reason: nullable(str) });
export function decisionContract(worker = false) {
  const name = worker ? 'plan_semantic_query' : 'select_report_source';
  return immutable({ systemPrompt: artifact.components[name].prompt, tools: [{ type: 'function', function: { name, description: 'Propose private report planning; no execution or authorization.', parameters: schema(worker) } }] });
}
export function admitDecision(proposed, worker = false) {
  exact(proposed, ['name', 'args']); requireThat(proposed.name === (worker ? 'plan_semantic_query' : 'select_report_source'));
  const a = proposed.args; exact(a, worker ? ['status', 'source_id', 'query', 'question', 'reason'] : ['status', 'route', 'cube_id', 'request', 'question', 'reason']);
  requireThat(['ready', 'clarify', 'unsupported'].includes(a.status));
  if (a.status !== 'ready') {
    requireThat(a[worker ? 'source_id' : 'cube_id'] === null && a[worker ? 'query' : 'request'] === null && (worker || a.route === 'none'));
    requireThat(a.status === 'clarify' ? text(a.question) && (a.reason === null || text(a.reason)) : text(a.reason) && a.question === null);
  } else {
    requireThat(a.question === null && a.reason === null); request(a[worker ? 'query' : 'request']);
    requireThat(worker ? id(a.source_id) : ['cube', 'semantic_query'].includes(a.route) && (a.route === 'cube' ? id(a.cube_id) : a.cube_id === null));
  }
  return immutable(a);
}
export function admitWorker(a, q, r) {
  requireThat(a.status === 'ready' && digest(a.query) === digest(q));
  const source = r.sources.find(s => s.kind === 'semantic' && s.id === a.source_id);
  requireThat(source && covers(source, q)); return source;
}
