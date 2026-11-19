import { digest } from '../../contracts.mjs';
export const query = (dimensions = ['country']) => ({ measures: ['gross', 'refunds', 'net', 'refund_ratio'], dimensions,
  period: { lower: '2024-01-01', upper: '2024-03-01', grain: 'month' }, filters: [] });
export function catalog() {
  const measure = (id, aggregation = 'sum', numerator = null, denominator = null) => ({ id, label: id, unit: aggregation === 'ratio' ? 'fraction' : 'USD', aggregation, numerator, denominator });
  const source = (id, kind, dimensions) => ({ id, kind, revision: digest(id), measures: ['gross', 'refunds', 'net', 'refund_ratio'], dimensions,
    grains: ['month'], coverage: { lower: '2023-01-01', upper: '2025-01-01' }, capability: 'analytics', metadata: { rules: 'PRIVATE_RULE: refunds counted once', model: 'PRIVATE_MODEL' } });
  return { revision: digest('registry'), measures: [measure('gross'), measure('refunds'), measure('net'), measure('refund_ratio', 'ratio', 'refunds', 'gross')],
    dimensions: ['country', 'channel', 'product_category'].map(id => ({ id, label: id })),
    sources: [source('revenue_health', 'cube', ['country']), source('sales_semantics', 'semantic', ['country', 'channel', 'product_category'])] };
}
export const choose = (q = query(), route = 'cube', cube_id = 'revenue_health') => ({ name: 'select_report_source', args: { status: 'ready', route, cube_id: route === 'cube' ? cube_id : null, request: q, question: null, reason: null } });
export const plan = (q = query(['channel'])) => ({ name: 'plan_semantic_query', args: { status: 'ready', source_id: 'sales_semantics', query: q, question: null, reason: null } });
export const clarify = worker => ({ name: worker ? 'plan_semantic_query' : 'select_report_source', args: { status: 'clarify',
  ...(worker ? { source_id: null, query: null } : { route: 'none', cube_id: null, request: null }), question: 'Which confirmed definition should apply?', reason: null } });
export const model = (...responses) => ({ calls: [], async decide(input) { this.calls.push(input); if (!responses.length) throw Error('unexpected_model_call'); return structuredClone(responses.shift()); } });
const facts = [
  { period: '2024-01-01', country: 'A', channel: 'Direct', product_category: 'Books', gross: 100, refunds: 10 },
  { period: '2024-01-01', country: 'B', channel: 'Search', product_category: 'Games', gross: 200, refunds: 50 },
  { period: '2024-02-01', country: 'A', channel: 'Search', product_category: 'Books', gross: 50, refunds: 0 },
];
export function result(q) {
  const groups = new Map();
  for (const r of facts.filter(r => r.period >= q.period.lower && r.period < q.period.upper && q.filters.every(f => f.values.includes(r[f.dimension])))) {
    const k = JSON.stringify([r.period, ...q.dimensions.map(d => r[d])]);
    const g = groups.get(k) ?? { period: r.period, ...Object.fromEntries(q.dimensions.map(d => [d, r[d]])), gross: 0, refunds: 0 };
    g.gross += r.gross; g.refunds += r.refunds; groups.set(k, g);
  }
  return { kind: 'table', columns: ['period', ...q.dimensions, ...q.measures].map(key => ({ key })), rows: [...groups.values()].map(r => {
    const m = { gross: r.gross, refunds: r.refunds, net: r.gross - r.refunds, refund_ratio: r.gross ? r.refunds / r.gross : null };
    return { period: r.period, ...Object.fromEntries(q.dimensions.map(d => [d, r[d]])), ...Object.fromEntries(q.measures.map(id => [id, m[id]])) };
  }) };
}
export function ports(planner = model(choose()), worker = model()) {
  const calls = [];
  return { calls, planner, worker, loadRegistry: async () => catalog(), authorize: async x => { calls.push(x.phase); return true; },
    execute: async ({ plan }) => { calls.push('execute_query'); return { status: 'completed', plan_digest: digest(plan), result: result(plan.query), result_ref: 'result-1', evidence_ref: 'evidence-1', evidence: { private_sql: 'PRIVATE_SQL' } }; },
    verify: async ({ plan, source, execution }) => ({ verified: digest(execution.result) === digest(result(plan.query)), complete: true,
      result_digest: digest(execution.result), query_digest: digest(plan.query), source_revision: source.revision }) };
}
