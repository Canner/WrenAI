import { immutable, requireThat } from '../contracts.mjs';
import { parse as parsePlan } from '../p2/planning.mjs';
import { behaviors } from '../behaviors/index.mjs';

const text = { type: 'string', minLength: 1, maxLength: 2048 };
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const period = object({ quotes: { type: 'array', minItems: 1, maxItems: 4, items: text },
  lower: text, upper: text, timezone: { type: 'string', enum: ['UTC'] } });
const parameters = object({
  metrics: { type: 'array', maxItems: 3, items: object({ quote: text, definition: text }) },
  period: { anyOf: [period, { type: 'null' }] },
  objective: text,
  filters: { type: 'array', maxItems: 8, items: text },
  requested_statuses: { type: 'array', maxItems: 16, uniqueItems: true, items: text },
  groups: { type: 'array', maxItems: 3, items: object({ id: text, capability: text, quote: text,
    metric_index: { type: 'integer', minimum: 0, maximum: 2 }, grain: { type: 'string', enum: ['scalar', 'week'] } }) },
  presentation: { type: 'string', enum: ['local_answer', 'dashboard_design'] },
  unsupported_reason: { anyOf: [text, { type: 'null' }] },
});
const tools = [{ type: 'function', function: { name: 'resolve_intent',
  description: 'Extract facts already supplied in the user conversation, then resolve their authorized definitions. Do not ask for confirmation. Empty metrics or null period means genuinely missing information, never an optional confirmation.', parameters } }];
const exact = (value, keys) => requireThat(value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k)));
const isText = x => typeof x === 'string' && x.trim().length > 0 && x.length <= 2048;

export function parseIntent(name, args, capabilities, { conversation } = {}) {
  requireThat(name === 'resolve_intent' && Array.isArray(conversation));
  exact(args, Object.keys(parameters.properties));
  const userText = conversation.filter(m => m.role === 'user').map(m => m.content);
  const quoted = value => isText(value) && userText.some(s => typeof s === 'string' && s.includes(value));
  requireThat(Array.isArray(args.metrics) && args.metrics.length <= 3 && isText(args.objective)
    && Array.isArray(args.filters) && args.filters.length <= 8 && args.filters.every(isText)
    && Array.isArray(args.requested_statuses) && args.requested_statuses.length <= 16
    && new Set(args.requested_statuses).size === args.requested_statuses.length
    && args.requested_statuses.every(x => isText(x) && x.length <= 64)
    && Array.isArray(args.groups) && args.groups.length <= 3
    && ['local_answer', 'dashboard_design'].includes(args.presentation)
    && (args.unsupported_reason === null || isText(args.unsupported_reason)));
  for (const metric of args.metrics) {
    exact(metric, ['quote', 'definition']);
    requireThat(isText(metric.quote) && isText(metric.definition));
  }
  if (args.period !== null) {
    exact(args.period, ['quotes', 'lower', 'upper', 'timezone']);
    requireThat(Array.isArray(args.period.quotes) && args.period.quotes.length > 0
      && args.period.quotes.length <= 4 && args.period.quotes.every(isText));
    const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
    requireThat(date(args.period.lower) && date(args.period.upper) && args.period.lower < args.period.upper
      && args.period.timezone === 'UTC');
  }
  for (const group of args.groups) {
    exact(group, ['id', 'capability', 'quote', 'metric_index', 'grain']);
    requireThat(isText(group.id) && capabilities.some(c => c.id === group.capability)
      && Number.isInteger(group.metric_index) && group.metric_index >= 0 && group.metric_index < 3
      && isText(group.quote) && ['scalar', 'week'].includes(group.grain));
  }
  if (args.unsupported_reason !== null) return parsePlan('unsupported', { reason: args.unsupported_reason }, capabilities);
  const hasMetric = args.metrics.length > 0 && args.metrics.every(metric => quoted(metric.quote));
  const hasPeriod = args.period !== null && args.period.quotes.every(quoted);
  if (!hasMetric || !hasPeriod) {
    // Any partial groups are discarded: incomplete intent NEVER emits a plan.
    const question = !hasMetric && !hasPeriod
      ? '請問您想查看哪個指標，以及哪段起訖期間？'
      : !hasMetric ? '請問您想查看哪個指標？' : '請問要查詢哪段起訖期間？';
    return parsePlan('clarify_intent', { question }, capabilities);
  }
  for (const group of args.groups) requireThat(group.metric_index < args.metrics.length && quoted(group.quote)
    && (group.grain !== 'week' || /週|周|week/i.test(group.quote)));
  const { quotes, ...range } = args.period;
  return parsePlan('plan_queries', { objective: args.objective,
    constraints: { period: range, filters: args.filters, requested_statuses: args.requested_statuses },
    groups: args.groups.map(({ metric_index, quote, ...group }) => ({ ...group, metric: args.metrics[metric_index].definition })),
    presentation: args.presentation }, capabilities);
}

export const plannerContract = { tools: immutable(tools), parse: parseIntent, systemPrompt: behaviors.resolve_intent.prompt };
