import { immutable, requireThat } from '../contracts.mjs';
import { tools, systemPrompt, parsePlanDecision } from '../p1/planning.mjs';
const extended = structuredClone(tools);
const params = extended[0].function.parameters;
params.properties.presentation = { type: 'string', enum: ['local_answer', 'dashboard_design'], description: 'Propose dashboard_design only for an explicit dashboard/design request. The host separately authorizes disclosure.' };
params.required.push('presentation');
export function parse(name, args, caps) {
  if (name !== 'plan_queries') return parsePlanDecision(name, args, caps);
  const { presentation, ...data } = args;
  requireThat(['local_answer', 'dashboard_design'].includes(presentation));
  return immutable({ ...parsePlanDecision(name, data, caps), args: { ...data, presentation } });
}
export const decisionContract = immutable({ tools: extended, systemPrompt: systemPrompt.replace(
  'There is no cloud design capability in this experiment. No Claude or GPT is available. Unsupported work must be reported as unsupported.',
  'A dashboard_design specialist is available after private queries complete, subject to host disclosure authorization. Set presentation=dashboard_design for explicit requests for a beautiful dashboard; otherwise local_answer. Do not send the specialist metadata, conversation or SQL. Missing metric or dates still require clarify_intent first. Presentation details can use defaults; do not ask about colors. The host will validate and render the design.') });
// Functions cannot be cloned; keep the parser outside the immutable JSON contract.
export const plannerContract = { ...decisionContract, parse };
