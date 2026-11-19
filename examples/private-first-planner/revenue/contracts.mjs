import { immutable, requireThat } from '../contracts.mjs';
import { artifact } from './behaviors/index.mjs';

const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const enumeration = values => ({ type: 'string', enum: values });
const list = values => ({ type: 'array', items: enumeration(values), minItems: 1, maxItems: values.length, uniqueItems: true });
const metrics = ['net', 'gross', 'refunds', 'refund_ratio', 'yoy'];
const analyses = ['revenue_overview', 'monthly_trend', 'country_mix', 'channel_mix', 'change_contribution', 'refund_health'];
const dimensions = ['country', 'channel'];
const exact = (v, keys) => requireThat(v && Object.getPrototypeOf(v) === Object.prototype
  && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k)));
const subset = (v, values) => requireThat(Array.isArray(v) && v.length > 0 && v.length <= values.length
  && new Set(v).size === v.length && v.every(x => values.includes(x)));
const text = v => typeof v === 'string' && v.trim().length > 0 && v.length <= 1000;
const index = value => {
  requireThat(typeof value === 'string' && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value));
  return Number(value.slice(0, 4)) * 12 + Number(value.slice(5)) - 1;
};
const month = n => `${String(Math.floor(n / 12)).padStart(4, '0')}-${String(n % 12 + 1).padStart(2, '0')}`;

export function periodOptions(coverage) {
  exact(coverage, ['lower', 'upper_exclusive']);
  const lower = index(coverage.lower), upper = index(coverage.upper_exclusive);
  requireThat(lower < upper && upper - lower <= 120);
  const quarter = Math.floor(upper / 3) * 3, half = Math.floor(upper / 6) * 6;
  const candidates = { latest_complete_month: [upper - 1, upper], latest_complete_quarter: [quarter - 3, quarter],
    latest_complete_half_year: [half - 6, half], latest_six_months: [upper - 6, upper], full_coverage: [lower, upper] };
  return immutable(Object.fromEntries(Object.entries(candidates).filter(([, [l, u]]) => l >= lower && u <= upper && l < u)
    .map(([key, [l, u]]) => [key, { lower: month(l), upper_exclusive: month(u), timezone: 'UTC',
      prior_year_available: l - 12 >= lower && u - 12 <= upper }])));
}

// Coverage and business semantics are operator-verified replay metadata, never inferred by a model.
export function validatePayload(p) {
  exact(p, ['version', 'synthetic', 'currency', 'timezone', 'amount_scale', 'coverage', 'default_period', 'columns', 'rows', 'definitions']);
  requireThat(p?.synthetic === true && p.currency === 'USD' && p.timezone === 'UTC'
    && Number.isSafeInteger(p.amount_scale) && p.amount_scale > 0
    && JSON.stringify(p.columns) === JSON.stringify(['month', 'country', 'channel', 'gross_units', 'refund_units'])
    && Array.isArray(p.rows) && p.rows.length > 0 && p.rows.length <= 5000
    && Buffer.byteLength(JSON.stringify(p)) <= 64 * 1024);
  periodOptions(p.coverage);
  requireThat(text(p.version) && p.definitions && Object.getPrototypeOf(p.definitions) === Object.prototype
    && Object.keys(p.definitions).every(k => ['gross', 'refunds', 'net', 'refund_ratio', 'fx', 'scope', 'comparison'].includes(k))
    && Object.values(p.definitions).every(text));
  exact(p.default_period, ['lower', 'upper_exclusive']);
  requireThat(index(p.default_period.lower) >= index(p.coverage.lower)
    && index(p.default_period.upper_exclusive) <= index(p.coverage.upper_exclusive)
    && index(p.default_period.lower) < index(p.default_period.upper_exclusive));
  const cells = new Set(); let gross = 0, refunds = 0;
  for (const r of p.rows) {
    requireThat(Array.isArray(r) && r.length === 5 && index(r[0]) >= index(p.coverage.lower)
      && index(r[0]) < index(p.coverage.upper_exclusive)
      && [r[1], r[2]].every(x => text(x) && x.length <= 120)
      && [r[3], r[4]].every(x => Number.isSafeInteger(x) && x >= 0));
    const key = JSON.stringify(r.slice(0, 3)); requireThat(!cells.has(key)); cells.add(key);
    gross += r[3]; refunds += r[4]; requireThat(Number.isSafeInteger(gross) && Number.isSafeInteger(refunds));
  }
  return immutable(p);
}

export function createPlannerContract(coverage) {
  const windows = periodOptions(coverage);
  const parameters = object({ status: enumeration(['ready', 'clarify']),
    clarification: { anyOf: [{ type: 'null' }, { type: 'string', minLength: 1, maxLength: 1000 }] },
    objective: enumeration(['revenue_health', 'explain_change', 'refund_review']),
    period_choice: enumeration(Object.keys(windows)), primary_metric: enumeration(metrics), kpis: list(metrics),
    dimensions: list(dimensions), primary_dimension: enumeration(dimensions), comparison: enumeration(['prior_year', 'none']),
    analyses: list(analyses), assumptions: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 1000 }, maxItems: 6 },
    limitations: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 1000 }, maxItems: 6 } });
  return immutable({ systemPrompt: artifact.components.plan_revenue_dashboard.prompt,
    tools: [{ type: 'function', function: { name: 'plan_revenue_dashboard', description: 'Select a supported historical period and analysis, or ask a necessary intent question. Do not invent dates or numeric findings.', parameters } }] });
}

export function admitPlan(proposed, coverage) {
  const contract = createPlannerContract(coverage), windows = periodOptions(coverage);
  requireThat(proposed?.name === 'plan_revenue_dashboard'); const p = proposed.args;
  exact(p, contract.tools[0].function.parameters.required);
  requireThat(['ready', 'clarify'].includes(p.status) && Object.hasOwn(windows, p.period_choice)
    && ['revenue_health', 'explain_change', 'refund_review'].includes(p.objective));
  subset(p.kpis, metrics); subset(p.dimensions, dimensions); subset(p.analyses, analyses);
  requireThat(p.kpis.includes(p.primary_metric) && p.dimensions.includes(p.primary_dimension)
    && ['prior_year', 'none'].includes(p.comparison));
  for (const key of ['assumptions', 'limitations']) requireThat(Array.isArray(p[key]) && p[key].length <= 6 && p[key].every(text));
  if (p.status === 'clarify') { requireThat(text(p.clarification)); return immutable({ status: 'clarify', question: p.clarification }); }
  requireThat(p.clarification === null && p.assumptions.length > 0);
  const { prior_year_available, ...period } = windows[p.period_choice];
  requireThat(p.comparison !== 'prior_year' || prior_year_available);
  requireThat(p.comparison === 'prior_year' || (!p.kpis.includes('yoy') && !p.analyses.includes('change_contribution')));
  const { period_choice, clarification, ...rest } = p;
  return immutable({ ...rest, period: { ...period, basis: period_choice }, question: '' });
}

// Free-text assumptions, limitations and the private conversation stay private.
export function cloudBrief(plan) {
  requireThat(plan.status === 'ready');
  return JSON.stringify({ version: 'revenue-analysis-brief/1', objective: plan.objective, period: plan.period,
    primary_metric: plan.primary_metric, kpis: plan.kpis, dimensions: plan.dimensions,
    primary_dimension: plan.primary_dimension, comparison: plan.comparison, analyses: plan.analyses,
    user_goal: 'Build a dashboard that clearly explains revenue health.',
    assumption: 'The period is a planner-selected default, not a user-confirmed date. Make this assumption visible.',
    limits: 'Synthetic historical money-flow aggregates only; no causal, profit, product-allocation or order-count claims.' });
}
