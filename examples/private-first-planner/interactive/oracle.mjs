// Host-side test oracle. Never sent to a designer or injected into its frontend.
// This implementation is independent of the scripted specimen's calculation.
import { initialState } from './data.mjs';
export function expected(p, s) {
  const [parent, child] = p.capabilities.dimensions[s.dimension];
  const selected = p.rows.filter(r => r.date >= s.lower && r.date < s.upper
    && (!s.region || r.region === s.region) && (!s.category || r.category === s.category)
    && (s.parent === null || r[parent] === s.parent));
  const metrics = rows => {
    const revenue = rows.reduce((n, r) => n + r.revenue_cents, 0) / 100;
    const orders = rows.reduce((n, r) => n + r.orders, 0);
    return { revenue, orders, aov: orders ? revenue / orders : null };
  };
  const key = s.parent === null ? parent : child;
  const groups = [...new Set(selected.map(r => r[key]))].sort().map(label =>
    ({ label, ...metrics(selected.filter(r => r[key] === label)) }));
  return { ...metrics(selected), groups };
}
export function journeys(p) {
  const steps = [{ action: 'initial', state: initialState(p) }];
  let s = initialState(p);
  const add = (action, value, next) => { s = { ...s, ...next }; steps.push({ action, value, state: { ...s } }); };
  const regions = [...new Set(p.rows.map(r => r.region))].sort();
  const categories = [...new Set(p.rows.map(r => r.category))].sort();
  if (regions.length) {
    add('region', regions[0], { region: regions[0], parent: null });
    add('drill', regions[0], { parent: regions[0] });
    add('roll-up', null, { parent: null });
  }
  if (categories.length) add('category', categories[0], { category: categories[0], parent: null });
  const days = [...new Set(p.rows.map(r => r.date))].sort();
  if (days.length > 1) add('lower', days[1], { lower: days[1], parent: null });
  add('dimension', 'product', { dimension: 'product', parent: null });
  if (categories.length) {
    add('drill', categories[0], { parent: categories[0] });
    add('dimension', 'geography', { dimension: 'geography', parent: null });
    add('dimension', 'product', { dimension: 'product', parent: null });
    add('drill', categories[0], { parent: categories[0] });
    add('roll-up', null, { parent: null });
  }
  add('reset', null, initialState(p));
  // A valid one-day interval with no rows; the fixture starts after this day.
  const next = new Date(Date.parse(p.period.lower) + 86400000).toISOString().slice(0,10);
  add('upper', next, { upper: next, parent: null });
  add('invalid-lower', p.period.upper, {});
  add('reset', null, initialState(p));
  // Reversed filter order must have the same semantics.
  if (categories.length) add('category', categories[0], { category: categories[0], parent: null });
  if (regions.length) add('region', regions[0], { region: regions[0], parent: null });
  if (regions.length) add('region', '', { region: '', parent: null });
  if (categories.length) add('category', '', { category: '', parent: null });
  add('reset', null, initialState(p));
  return steps;
}
