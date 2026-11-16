// Shape validation uses only the declared grain, never fixture answers.
export function validateResultGrain(result, grain) {
  if (result?.kind !== 'table' || !Array.isArray(result.columns) || !Array.isArray(result.rows)) return false;
  const keys = result.columns.map(c => c.key);
  if (new Set(keys).size !== keys.length || keys.some(k => typeof k !== 'string')) return false;
  const number = v => typeof v === 'number' && Number.isFinite(v);
  if (grain === 'scalar') return keys.length === 1 && result.rows.length === 1 && number(result.rows[0]?.[keys[0]]);
  if (grain === 'week' || grain === 'day') {
    if (keys.length !== 2 || !result.rows.length) return false;
    let previous = null, dateKey = null;
    for (const row of result.rows) {
      const dates = keys.filter(k => typeof row[k] === 'string' && /^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.0+)?Z?| 00:00:00(?:\.0+)?)?$/.test(row[k]));
      if (dates.length !== 1 || (dateKey && dateKey !== dates[0])) return false;
      dateKey = dates[0];
      const day = row[dateKey].slice(0, 10), ms = Date.parse(day);
      if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== day
        || (grain === 'week' && new Date(ms).getUTCDay() !== 1)
        || (previous !== null && day <= previous) || !number(row[keys.find(k => k !== dateKey)])) return false;
      previous = day;
    }
    return true;
  }
  // This bounded evaluation does not claim validation for other output grains.
  return false;
}

export function retrievalQuestion(group, constraints) {
  const shape = group.grain === 'scalar'
    ? 'Exactly one row and one numeric aggregate column. No date column, grouping or breakdown.'
    : `Exactly two columns: native Monday UTC week-start date using DATE_TRUNC('week', the source timestamp) and one numeric aggregate. One row per week, ordered ascending. Filter source timestamps BEFORE grouping; include partial weeks even if their label precedes the lower date. Never filter week labels to the source date range. Never compute week start by subtracting weekdays. No extra dimensions.`;
  // Wren accepts natural language, not our internal planning schema. Render only
  // this group's validated fields; never append the original multi-group request.
  return `Metric: ${group.metric}\nGrain: ${group.grain}\nRequired shape: ${shape}\n`
    + `Period: ${constraints.period.lower} inclusive to ${constraints.period.upper} exclusive, ${constraints.period.timezone}.\n`
    + `Shared filters: ${constraints.filters.length ? constraints.filters.join('; ') : 'Use the project declared defaults.'}\n`
    + `Requested order statuses: ${constraints.requested_statuses.length ? constraints.requested_statuses.join(', ') + '. This is the user request, not a status confirmation; obtain Wren clarification if required.' : 'Use the project default.'}\n`
    + 'Use the project definition of the requested metric. Execute only this retrieval group.';
}
