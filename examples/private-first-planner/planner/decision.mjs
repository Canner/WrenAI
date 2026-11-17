import { immutable, requireThat } from '../contracts.mjs';
import { parsePlanDecision } from './plan.mjs';

export function parse(name, args, caps) {
  if (name !== 'plan_queries') return parsePlanDecision(name, args, caps);
  const { presentation, ...data } = args;
  requireThat(['local_answer', 'dashboard_design'].includes(presentation));
  return immutable({ ...parsePlanDecision(name, data, caps), args: { ...data, presentation } });
}
