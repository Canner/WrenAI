import { immutable, requireThat } from '../contracts.mjs';

const isText = x => typeof x === 'string' && x.trim().length > 0 && x.length <= 2048;
function exact(x, keys) {
  requireThat(x && Object.getPrototypeOf(x) === Object.prototype
    && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k)));
}
export function parsePlanDecision(name, args, capabilities) {
  if (name === 'plan_queries') {
    exact(args, ['objective', 'constraints', 'groups']);
    exact(args.constraints, ['period', 'filters', 'requested_statuses']);
    const statuses = args.constraints.requested_statuses;
    requireThat(Array.isArray(statuses) && statuses.length <= 16 && new Set(statuses).size === statuses.length
      && statuses.every(s => typeof s === 'string' && s.trim().length > 0 && s.length <= 64));
    const period = args.constraints.period;
    exact(period, ['lower', 'upper', 'timezone']);
    const date = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)
      && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x;
    requireThat(date(period.lower) && date(period.upper) && period.lower < period.upper && period.timezone === 'UTC'
      && Array.isArray(args.constraints.filters) && args.constraints.filters.length <= 8
      && args.constraints.filters.every(isText));
    requireThat(isText(args.objective) && Array.isArray(args.groups) && args.groups.length > 0 && args.groups.length <= 3);
    const ids = new Set();
    for (const g of args.groups) {
      exact(g, ['id', 'capability', 'metric', 'grain']);
      requireThat(isText(g.id) && isText(g.metric) && !ids.has(g.id)
        && capabilities.some(c => c.id === g.capability)
        && ['scalar', 'week'].includes(g.grain));
      ids.add(g.id);
    }
  } else if (name === 'clarify_intent') {
    exact(args, ['question']);
    requireThat(isText(args.question));
  } else if (name === 'unsupported') {
    exact(args, ['reason']); requireThat(isText(args.reason));
  } else requireThat(false);
  return immutable({ name, args });
}
