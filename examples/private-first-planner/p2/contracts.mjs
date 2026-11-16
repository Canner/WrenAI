import { immutable, requireThat, digest } from '../contracts.mjs';
const obj = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const enumeration = (...values) => ({ type: 'string', enum: values });
export const designSchema = immutable(obj({
  version: { type: 'integer', enum: [1] },
  export_id: { type: 'string', pattern: '^[a-f0-9-]{36}$' },
  data_version: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  theme: enumeration('midnight', 'ivory'), accent: enumeration('teal', 'violet', 'amber'),
  layout: enumeration('hero', 'balanced'),
  cards: { type: 'array', minItems: 2, maxItems: 2, items: obj({
    dataset_id: enumeration('revenue_total', 'revenue_weekly'),
    kind: enumeration('kpi', 'bar', 'line'),
    title: enumeration('Total revenue', 'Weekly revenue'),
  }) },
}));
function matches(s, v) {
  if (s.enum) return s.enum.includes(v);
  if (s.type === 'object') return v && Object.getPrototypeOf(v) === Object.prototype
    && Object.keys(v).length === s.required.length && s.required.every(k => Object.hasOwn(v,k) && matches(s.properties[k],v[k]));
  if (s.type === 'array') return Array.isArray(v) && v.length >= s.minItems && v.length <= s.maxItems && v.every(x => matches(s.items,x));
  return typeof v === 'string' && new RegExp(s.pattern).test(v);
}
export function validateDesign(spec, bundle) {
  requireThat(Buffer.byteLength(JSON.stringify(spec)) < 8192 && matches(designSchema,spec));
  requireThat(spec.export_id === bundle.export_id && spec.data_version === bundle.data_version
    && bundle.data_version === digest(bundle.payload));
  requireThat(new Set(spec.cards.map(c=>c.dataset_id)).size === 2);
  for (const c of spec.cards) requireThat(c.dataset_id === 'revenue_total'
    ? c.kind === 'kpi' && c.title === 'Total revenue'
    : ['line','bar'].includes(c.kind) && c.title === 'Weekly revenue');
  return immutable(spec);
}
