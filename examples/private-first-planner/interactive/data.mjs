import { immutable, requireThat, digest } from '../contracts.mjs';

export const inputContract = 'interactive-aggregates/1';
export const deliveryContract = 'interactive-dashboard-delivery/1';
export const capabilities = immutable({
  metrics: { revenue: { unit: 'USD', aggregation: 'sum(revenue_cents)/100' },
    orders: { unit: 'orders', aggregation: 'sum(orders)' },
    aov: { unit: 'USD', aggregation: 'sum(revenue_cents)/sum(orders)/100; null when orders=0' } },
  dimensions: { geography: ['region', 'country'], product: ['category', 'subcategory'] },
  filters: ['region', 'category', 'lower', 'upper'],
  operations: ['filter', 'dimension', 'drill-down', 'roll-up', 'reset'],
  execution: 'local-only', filter_scope: 'all-views', filter_change: 'clear-drill',
  dimension_change: 'preserve-filters-clear-drill', group_order: 'label-codepoint-ascending',
  empty: 'revenue=0; orders=0; aov=null; groups=[]',
});
const date = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
  && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const exact = (o, keys) => o && Object.getPrototypeOf(o) === Object.prototype
  && Object.keys(o).sort().join(',') === [...keys].sort().join(',');
export function validatePayload(p) {
  requireThat(exact(p, ['version', 'synthetic', 'complete', 'period', 'capabilities', 'rows'])
    && p.version === inputContract && p.synthetic === true && p.complete === true
    && digest(p.capabilities) === digest(capabilities)
    && exact(p.period, ['lower','upper','timezone']) && date(p.period.lower) && date(p.period.upper)
    && p.period.lower < p.period.upper && p.period.timezone === 'UTC'
    && Array.isArray(p.rows) && p.rows.length <= 500
    && Buffer.byteLength(JSON.stringify(p)) <= 64 * 1024);
  const seen = new Set(), parents = { country: new Map(), subcategory: new Map() };
  let cents = 0, orders = 0;
  for (const r of p.rows) {
    requireThat(exact(r, ['date','region','country','category','subcategory','revenue_cents','orders'])
      && date(r.date) && r.date >= p.period.lower && r.date < p.period.upper
      && ['region','country','category','subcategory'].every(k => typeof r[k] === 'string'
        && r[k].trim() === r[k] && r[k].length > 0 && r[k].length <= 80)
      && Number.isSafeInteger(r.revenue_cents) && Number.isSafeInteger(r.orders) && r.orders >= 0);
    const key = JSON.stringify([r.date,r.region,r.country,r.category,r.subcategory]);
    requireThat(!seen.has(key)); seen.add(key);
    for (const [child,parent] of [['country','region'],['subcategory','category']]) {
      requireThat(!parents[child].has(r[child]) || parents[child].get(r[child]) === r[parent]);
      parents[child].set(r[child], r[parent]);
    }
    cents += Math.abs(r.revenue_cents); orders += r.orders;
    requireThat(Number.isSafeInteger(cents) && Number.isSafeInteger(orders));
  }
  return immutable(p);
}

// Aggregate cells, not transactions or customer records. Every cell's order
// population is disjoint; this is why SUM(orders) is valid for this fixture.
export function syntheticPayload(variant = 'base') {
  requireThat(['base','changed','edge','empty'].includes(variant));
  const regions = variant === 'changed' ? [['East','Delta','Echo'],['West','Foxtrot','Golf']]
    : [['APAC','Japan','Taiwan'],['Europe','France','Germany']];
  const products = [['Hardware','Laptops','Monitors'],['Services','Support','Training']];
  const dates = variant === 'changed' ? ['2026-03-03','2026-03-12','2026-03-23','2026-03-28']
    : ['2026-02-02','2026-02-10','2026-02-20'];
  const rows = []; let i = 0;
  for (const day of dates) for (const [region,...countries] of regions)
    for (const country of countries) for (const [category,...children] of products)
      for (const subcategory of children) {
        i++; const orders = (i * 7) % 13 + 1;
        rows.push({ date: day, region, country, category, subcategory,
          revenue_cents: orders * (913 + i * 37), orders });
      }
  if (variant === 'edge') for (let n = 0; n < rows.length; n++) {
    rows[n].revenue_cents = n % 3 === 0 ? -700 : 0; rows[n].orders = 0;
    rows[n].subcategory += ' — Extended service description';
  }
  return validatePayload({ version: inputContract, synthetic: true, complete: true,
    period: { lower: variant === 'changed' ? '2026-03-01' : '2026-02-01',
      upper: variant === 'changed' ? '2026-04-01' : '2026-03-01', timezone: 'UTC' },
    capabilities, rows: variant === 'empty' ? [] : rows });
}
export function initialState(p) {
  return { dimension: 'geography', parent: null, region: '', category: '', lower: p.period.lower, upper: p.period.upper };
}
