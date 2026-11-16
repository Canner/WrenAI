// These JSON Schemas describe the consumer experiment, not Wren's MCP protocol.
// The small validator below supports exactly the keywords used here (no $ref).
import { createHash } from 'node:crypto';

export class ContractError extends Error {
  constructor() { super('invalid_contract'); }
}
export class DisclosureDenied extends Error {
  constructor() { super('disclosure_denied'); }
}
export function requireThat(condition) {
  if (!condition) throw new ContractError();
}
export function immutable(value) {
  const copy = structuredClone(value);
  const freeze = (v) => {
    if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); }
    return v;
  };
  return freeze(copy);
}
const text = { type: 'string', minLength: 1, maxLength: 500 };
const id = { ...text, maxLength: 80, pattern: '^[A-Za-z0-9_-]+$' };
const integer = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const choice = (...values) => ({ enum: values });
const list = (items, maxItems = 20) => ({ type: 'array', items, minItems: 1, maxItems });
const record = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const version = choice(1);
const dataset = record({
  id, version: integer, metric: choice('revenue'), period: choice('2026-Q3'),
  status_scope: choice('paid', 'all'), unit: choice('USD'), grain: choice('month'),
  columns: list(record({ key: choice('month', 'revenue'), label: choice('Month', 'Revenue'), type: choice('string', 'number') }), 2),
  rows: list(record({ month: { ...text, pattern: '^2026-(07|08|09)$' }, revenue: { type: 'number', minimum: 0, maximum: 1e12 } }), 3),
});
export const schemas = immutable({
  TaskPlan: record({
    version, task_id: id, revision: integer, objective: text,
    metric: choice('revenue'), period: choice('2026-Q3'),
    status_scope: choice(null, 'paid', 'all'), theme: choice(null, 'light', 'dark'),
    output: choice('answer', 'dashboard'),
  }),
  Clarification: record({
    version, question_id: id, task_id: id, plan_revision: integer,
    source: choice('planner', 'wren', 'cloud'), field: choice('status_scope', 'theme'),
    question: text, options: list(choice('paid', 'all', 'light', 'dark'), 2),
  }),
  ExportBundle: record({
    version, export_id: id, task_id: id, plan_revision: integer,
    recipient: id, purpose: choice('dashboard_design'), policy_version: integer,
    expires_at: integer, payload_digest: { ...text, pattern: '^[a-f0-9]{64}$' },
    payload: record({
      brief: choice('Design a revenue dashboard using only the supplied monthly aggregate.'),
      theme: choice('light', 'dark'), dataset,
    }),
  }),
  DashboardSpec: record({
    version, task_id: id, plan_revision: integer, export_id: id,
    theme: choice('light', 'dark'), layout: choice('stack', 'grid'),
    charts: list(record({
      kind: choice('bar', 'line'), dataset_id: id, dataset_version: integer,
      x: choice('month'), y: choice('revenue'), title: choice('Monthly revenue'),
    }), 4),
  }),
});

function matches(s, v) {
  if (s.enum) return s.enum.includes(v);
  if (s.type === 'object') {
    if (!v || Object.getPrototypeOf(v) !== Object.prototype) return false;
    return Object.keys(v).every(k => Object.hasOwn(s.properties, k))
      && s.required.every(k => Object.hasOwn(v, k) && matches(s.properties[k], v[k]));
  }
  if (s.type === 'array') return Array.isArray(v) && v.length >= s.minItems && v.length <= s.maxItems
    && Array.from(v).every(x => matches(s.items, x));
  if (s.type === 'string') return typeof v === 'string' && v.length >= s.minLength && v.length <= s.maxLength
    && (!s.pattern || new RegExp(s.pattern).test(v));
  if (s.type === 'number' || s.type === 'integer') return typeof v === 'number' && Number.isFinite(v)
    && (s.type !== 'integer' || Number.isSafeInteger(v)) && v >= s.minimum && v <= s.maximum;
  return false;
}

export function parseContract(name, input) {
  requireThat(Object.hasOwn(schemas, name) && matches(schemas[name], input));
  requireThat(Buffer.byteLength(JSON.stringify(input)) <= 64 * 1024);
  if (name === 'Clarification') {
    const expected = input.field === 'theme' ? ['light', 'dark'] : ['paid', 'all'];
    requireThat(JSON.stringify(input.options) === JSON.stringify(expected));
  }
  if (name === 'ExportBundle') {
    requireThat(input.payload_digest === digest(input.payload));
    const d = input.payload.dataset;
    requireThat(JSON.stringify(d.columns) === JSON.stringify([
      { key: 'month', label: 'Month', type: 'string' },
      { key: 'revenue', label: 'Revenue', type: 'number' },
    ]));
    requireThat(new Set(d.rows.map(r => r.month)).size === d.rows.length);
  }
  return immutable(input);
}

export function validateDataset(input) {
  requireThat(matches(dataset, input));
  return immutable(input);
}

// Canonical object ordering makes the digest independent of JSON key order.
export function digest(value) {
  const canonical = (v) => Array.isArray(v) ? v.map(canonical)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function validateDashboard(input, bundle) {
  const spec = parseContract('DashboardSpec', input);
  requireThat(spec.task_id === bundle.task_id && spec.plan_revision === bundle.plan_revision
    && spec.export_id === bundle.export_id && spec.theme === bundle.payload.theme);
  for (const chart of spec.charts) requireThat(chart.dataset_id === bundle.payload.dataset.id
    && chart.dataset_version === bundle.payload.dataset.version);
  return spec;
}

export function parseDecision(value) {
  const shapes = {
    query_private: record({ action: choice('query_private') }),
    clarify: record({ action: choice('clarify'), field: choice('status_scope', 'theme') }),
    delegate_cloud: record({ action: choice('delegate_cloud'), capability: choice('dashboard_design') }),
    respond: record({ action: choice('respond') }),
  };
  requireThat(value && Object.hasOwn(shapes, value.action) && matches(shapes[value.action], value));
  return immutable(value);
}
