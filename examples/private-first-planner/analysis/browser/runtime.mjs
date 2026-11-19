// Trusted data runtime only. HTML/CSS/chart layout remain freely generated.
export function aggregateRuntime(capabilities, payload) {
  const clone = x => JSON.parse(JSON.stringify(x));
  const freeze = x => { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } return x; };
  const cap = freeze(clone(capabilities)), data = freeze(clone(payload));
  const fail = code => { throw Error(code); };
  const sameKeys = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o, k));
  const dimensions = cap.dimensions.map(d => d.id), measures = cap.measures;
  const catalog = Object.fromEntries(cap.dimensions.map(d => [d.id, d.values]));
  const day = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
  const bucket = s => { const d = new Date(s); if (cap.period.grain === 'week') d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d.toISOString().slice(0, 10); };
  const aligned = s => cap.period.grain === 'day' || cap.period.grain === 'month' && s.endsWith('-01') || cap.period.grain === 'week' && new Date(s).getUTCDay() === 1;
  // Compensated sum for decimal-valued snapshots. Formatting/QA must use the
  // declared unit precision; this does not claim arbitrary-decimal exactness.
  const sum = values => { let total = 0, carry = 0; for (const v of values) { const y = v - carry, t = total + y; carry = (t - total) - y; total = t; } if (!Number.isFinite(total)) fail('numeric_overflow'); return total; };
  function aggregate(rows) {
    const metrics = {};
    for (const m of measures) {
      const values = rows.map(r => r[m.id]);
      metrics[m.id] = values.some(x => x === null) ? null : m.aggregation === 'sum' ? sum(values) : values.length === 1 ? values[0] : null;
    }
    for (const m of measures.filter(m => m.aggregation === 'ratio' && m.rollup)) {
      const a = metrics[m.numerator], b = metrics[m.denominator]; metrics[m.id] = a === null || b === null || b === 0 ? null : a / b;
    }
    if (Object.values(metrics).some(v => v !== null && !Number.isFinite(v))) fail('numeric_overflow');
    return metrics;
  }
  let sequence = 0;
  return freeze({ capabilities: cap, catalog, async query(q) {
    const request_id = ++sequence;
    if (!sameKeys(q, ['lower', 'upper', 'dimension', 'filters', 'path']) || !day(q.lower) || !day(q.upper) || q.lower >= q.upper
      || q.lower < cap.period.lower || q.upper > cap.period.upper || q.lower !== cap.period.lower && !aligned(q.lower) || q.upper !== cap.period.upper && !aligned(q.upper)) fail('unsupported_period');
    if (q.dimension !== null && !dimensions.includes(q.dimension)) fail('unsupported_dimension');
    if (!q.filters || Array.isArray(q.filters) || typeof q.filters !== 'object' || !Array.isArray(q.path) || q.path.length > dimensions.length) fail('unsupported_scope');
    for (const [d, values] of Object.entries(q.filters)) if (!dimensions.includes(d) || !Array.isArray(values) || !values.length || new Set(values).size !== values.length || values.some(v => !catalog[d].includes(v))) fail('unsupported_filter');
    const seen = new Set();
    for (const p of q.path) {
      if (!sameKeys(p, ['dimension', 'value']) || !dimensions.includes(p.dimension) || !catalog[p.dimension].includes(p.value) || seen.has(p.dimension) || q.dimension === p.dimension) fail('unsupported_drill');
      if (q.dimension && !cap.breakdowns.some(b => b.from === p.dimension && b.to === q.dimension && b.kind === 'cross_dimension')) fail('unsupported_drill');
      seen.add(p.dimension);
    }
    const selected = data.rows.filter(r => r.period >= bucket(q.lower) && r.period < q.upper
      && Object.entries(q.filters).every(([d, values]) => values.includes(r[d])) && q.path.every(p => r[p.dimension] === p.value));
    const totals = aggregate(selected), primary = measures.find(m => m.id === 'net')?.id ?? measures[0].id;
    const groups = q.dimension === null ? [] : [...new Set(selected.map(r => r[q.dimension]))].map(label => ({ label, metrics: aggregate(selected.filter(r => r[q.dimension] === label)) }))
      .sort((a, b) => (b.metrics[primary] ?? -Infinity) - (a.metrics[primary] ?? -Infinity) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
    const trend = [];
    for (let d = new Date(bucket(q.lower)); d.toISOString().slice(0, 10) < q.upper;) {
      const period = d.toISOString().slice(0, 10); trend.push({ period, metrics: aggregate(selected.filter(r => r.period === period)) });
      if (cap.period.grain === 'month') d.setUTCMonth(d.getUTCMonth() + 1); else d.setUTCDate(d.getUTCDate() + (cap.period.grain === 'week' ? 7 : 1));
      if (trend.length > 5000) fail('result_limit');
    }
    return freeze({ version: 'aggregate-query/1', request_id, data_version: cap.data_version, query: clone(q),
      result: { empty: !selected.length, totals, groups, trend, unavailable: measures.filter(m => totals[m.id] === null).map(m => m.id) } });
  } });
}
