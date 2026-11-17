// Independent fixture oracle. Never sent to the model or used to repair its query.
function utcMidnight(value, timezone) {
  if (typeof value !== 'string' || timezone !== 'UTC'
    || !/^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.0+)?(?:Z|\+00:00)?)?$/.test(value)) return null;
  return value.slice(0, 10);
}

export function scoreData(snapshot, expected) {
  const checks = [];
  for (const binding of snapshot.results) {
    const table = binding.result, grain = binding.group.grain;
    const period = binding.evidence.applied_period;
    const periodMatches = utcMidnight(period?.lower, table.timezone) === '2026-01-01'
      && utcMidnight(period?.upper, table.timezone) === '2026-01-19'
      && period.lower_inclusive === true && period.upper_inclusive === false;
    let valuesMatch = false;
    if (table.kind === 'table' && Array.isArray(table.columns) && Array.isArray(table.rows)) {
      const keys = table.columns.map(c => c.key);
      if (grain === 'scalar' && keys.length === 1 && table.rows.length === 1) {
        valuesMatch = table.rows[0][keys[0]] === expected.scalar;
      } else if (grain === 'week' && keys.length === 2) {
        const points = table.rows.map(row => {
          const date = keys.map(k => row[k]).find(v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(?:T| |$)/.test(v));
          const value = keys.map(k => row[k]).find(v => typeof v === 'number');
          return [date?.slice(0, 10), value];
        });
        valuesMatch = JSON.stringify(points) === JSON.stringify(expected.weekly);
      }
    }
    checks.push({ group: binding.group.id, grain, values: valuesMatch, period: periodMatches });
  }
  return { passed: checks.length === expected.groups && checks.every(c => c.values && c.period), checks };
}
