// Self-contained so the trusted host can embed it without imports, eval or WASM.
// Call through contract.mjs: capabilities and snapshot are host-admitted inputs.
export function reportRuntime(capabilities, { payload, transport } = {}) {
  const fail = code => { throw Error(code); };
  const copy = x => JSON.parse(JSON.stringify(x));
  const freeze = x => { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } return x; };
  const cap = freeze(copy(capabilities)), p = payload && freeze(copy(payload));
  if (!!p === (typeof transport === 'function')) fail('report_source_required');
  const exact = (x, keys) => x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
  const canonical = x => x && typeof x === 'object' ? Array.isArray(x) ? x.map(canonical) : Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
  const eq = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  const monthIndex = m => {
    if (typeof m !== 'string' || !/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(m)) fail('unsupported_period');
    return Number(m.slice(0, 4)) * 12 + Number(m.slice(5)) - 1;
  };
  const month = n => String(Math.floor(n / 12)).padStart(4, '0') + '-' + String(n % 12 + 1).padStart(2, '0');
  const catalog = cap.catalog;
  function normalize(q) {
    if (!exact(q, ['lower', 'upper', 'country', 'channel', 'dimension', 'parent', 'comparison'])) fail('unsupported_query');
    if (monthIndex(q.lower) >= monthIndex(q.upper) || q.lower < cap.coverage.lower || q.upper > cap.coverage.upper_exclusive) fail('unsupported_period');
    if (!cap.dimensions.includes(q.dimension) || !cap.comparisons.includes(q.comparison)) fail('unsupported_query');
    for (const d of cap.dimensions) if (q[d] !== '' && !catalog[d].includes(q[d])) fail('unsupported_filter');
    if (q.parent !== null && (!catalog[q.dimension].includes(q.parent) || !cap.breakdowns.some(x => x.from === q.dimension))) fail('unsupported_drill');
    return freeze(Object.fromEntries(['lower', 'upper', 'country', 'channel', 'dimension', 'parent', 'comparison'].map(k => [k, q[k]])));
  }
  const total = rows => {
    const g = rows.reduce((n, r) => n + BigInt(r[3]), 0n), f = rows.reduce((n, r) => n + BigInt(r[4]), 0n);
    const t = { gross_units: Number(g), refund_units: Number(f), net_units: Number(g - f), refund_ratio: g ? Number(f) / Number(g) : null };
    if (![t.gross_units, t.refund_units, t.net_units].every(Number.isSafeInteger)) fail('numeric_overflow');
    return t;
  };
  const selected = (q, lower, upper) => p.rows.filter(r => r[0] >= lower && r[0] < upper && (!q.country || r[1] === q.country) && (!q.channel || r[2] === q.channel) && (q.parent === null || r[q.dimension === 'country' ? 1 : 2] === q.parent));
  function calculate(q) {
    const rows = selected(q, q.lower, q.upper), totals = total(rows);
    const lower = month(monthIndex(q.lower) - 12), upper = month(monthIndex(q.upper) - 12);
    const covered = q.comparison === 'prior_year' && lower >= cap.coverage.lower && upper <= cap.coverage.upper_exclusive;
    const old = covered ? selected(q, lower, upper) : [], prior = covered ? total(old) : null;
    const dimension = q.parent === null ? q.dimension : cap.breakdowns.find(x => x.from === q.dimension).to;
    const groupIndex = dimension === 'country' ? 1 : 2;
    const labels = rs => [...new Set(rs.map(r => r[groupIndex]))];
    const groups = labels(rows).map(label => ({ label, ...total(rows.filter(r => r[groupIndex] === label)) }))
      .sort((a, b) => b.net_units - a.net_units || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
    const trend = [];
    for (let i = monthIndex(q.lower); i < monthIndex(q.upper); i++) trend.push({ month: month(i), ...total(rows.filter(r => r[0] === month(i))) });
    const insights = { net_change: { label: null, units: covered && rows.length ? totals.net_units - prior.net_units : null } };
    for (const [d, index] of [['country', 1], ['channel', 2]]) {
      let value = { label: null, units: null };
      if (covered && rows.length && prior.net_units !== 0) {
        const candidates = [...new Set([...rows, ...old].map(r => r[index]))].map(label => ({ label,
          units: total(rows.filter(r => r[index] === label)).net_units - total(old.filter(r => r[index] === label)).net_units }));
        candidates.sort((a, b) => Math.abs(b.units) - Math.abs(a.units) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
        value = candidates[0] ?? value;
      }
      insights[d] = value;
    }
    return { empty: !rows.length, dimension, totals, comparison: { lower, upper, covered, totals: prior }, groups, trend, insights };
  }
  function checkResult(result, q) {
    if (!exact(result, ['empty', 'dimension', 'totals', 'comparison', 'groups', 'trend', 'insights']) || typeof result.empty !== 'boolean') fail('invalid_result');
    const metricKeys = ['gross_units', 'refund_units', 'net_units', 'refund_ratio'];
    const metric = (m, extra = []) => {
      if (!exact(m, [...extra, ...metricKeys]) || !metricKeys.slice(0, 3).every(k => Number.isSafeInteger(m[k])) || m.gross_units < 0 || m.refund_units < 0 || m.net_units !== m.gross_units - m.refund_units
        || (m.gross_units === 0 ? m.refund_ratio !== null : !Number.isFinite(m.refund_ratio) || Math.abs(m.refund_ratio - m.refund_units / m.gross_units) > 1e-12)) fail('invalid_result');
    };
    metric(result.totals);
    const c = result.comparison, lo = month(monthIndex(q.lower) - 12), hi = month(monthIndex(q.upper) - 12);
    const covered = q.comparison === 'prior_year' && lo >= cap.coverage.lower && hi <= cap.coverage.upper_exclusive;
    if (!exact(c, ['lower', 'upper', 'covered', 'totals']) || c.lower !== lo || c.upper !== hi || c.covered !== covered) fail('invalid_comparison');
    if (covered) metric(c.totals); else if (c.totals !== null) fail('invalid_comparison');
    const dimension = q.parent === null ? q.dimension : cap.breakdowns.find(x => x.from === q.dimension).to;
    if (result.dimension !== dimension || !Array.isArray(result.groups) || !Array.isArray(result.trend) || result.trend.length !== monthIndex(q.upper) - monthIndex(q.lower)) fail('incomplete_result');
    const seen = new Set();
    for (const g of result.groups) { metric(g, ['label']); if (!catalog[dimension].includes(g.label) || seen.has(g.label) || (q[dimension] && g.label !== q[dimension])) fail('invalid_group'); seen.add(g.label); }
    result.trend.forEach((m, i) => { metric(m, ['month']); if (m.month !== month(monthIndex(q.lower) + i)) fail('incomplete_result'); });
    for (const items of [result.groups, result.trend]) for (const key of metricKeys.slice(0, 3)) if (items.reduce((s, x) => s + BigInt(x[key]), 0n) !== BigInt(result.totals[key])) fail('inconsistent_totals');
    if (result.empty !== (result.groups.length === 0)) fail('invalid_result');
    if (!exact(result.insights, ['net_change', 'country', 'channel'])) fail('invalid_insights');
    for (const [key, value] of Object.entries(result.insights)) {
      if (!exact(value, ['label', 'units']) || !(value.units === null || Number.isSafeInteger(value.units)) || (key === 'net_change' ? value.label !== null : value.units === null ? value.label !== null : !catalog[key].includes(value.label))) fail('invalid_insights');
      const available = covered && !result.empty && (key === 'net_change' || c.totals.net_units !== 0);
      if (available !== (value.units !== null)) fail('invalid_insights');
    }
    if (covered && !result.empty && result.insights.net_change.units !== result.totals.net_units - c.totals.net_units) fail('invalid_insights');
  }
  let sequence = 0;
  return freeze({ capabilities: cap, catalog, async query(input) {
    const id = ++sequence, query = normalize(input);
    const request = freeze({ version: 'revenue-query/1', request_id: id, cube_id: cap.cube.id, cube_revision: cap.cube.revision, data_version: cap.data_version, query });
    const response = p ? { ...request, complete: true, result: calculate(query) } : copy(await transport(request));
    if (id !== sequence) fail('stale_result');
    if (!exact(response, [...Object.keys(request), 'complete', 'result']) || !Object.keys(request).every(k => eq(request[k], response[k]))) fail('mismatched_response');
    if (response.complete !== true) fail('incomplete_result');
    checkResult(response.result, query);
    return freeze(response);
  } });
}
