import { immutable } from '../contracts.mjs';
import { cases } from '../p4/protocol.mjs';
export { cases };
// Operator-authored design requirements; never forward the user's private transcript.
export const briefs = immutable({
  simple_charts: 'A simple, clear dashboard with basic charts and restrained styling. Prioritize immediate understanding.',
  standard_dashboard: 'An internal reconciliation dashboard. Prioritize precise source values, readable labels and practical information density.',
  executive_dashboard: 'A polished executive dashboard with distinctive visual hierarchy, thoughtful typography and refined layout. Make the revenue story clear without inventing metrics or comparisons.',
  ambiguous_design: 'The metric and period have now been clarified. Build a beautiful executive revenue dashboard with clear hierarchy and accessible details. All analytic facts are supplied in the authorized payload.',
});
export const protocol = immutable({ version: 1, experiment: 'free_frontend_design', repeats: 2,
  case_ids: cases.map(c => c.id), providers: ['nemotron', 'claude'], max_wall_ms: 35 * 60_000,
  output_tokens: 4096, thinking: {nemotron:'disabled',claude:'adaptive, medium effort; included in output cap'}, design_timeout_ms: 90_000, calls_per_arm: 1,
  max_design_invocations: 16, max_claude_transport_attempts_per_arm: 3,
  repair_calls: 0, shared_private_stage: true, grant: 'unchanged approved synthetic fixture',
  browser_viewports: [{width:1280,height:900},{width:390,height:844}],
  sample_policy: 'Run every scheduled sample once; retain failures and truncation. No selective retry or replacement.',
  quality_gates: ['bound_ids','visible_values_and_dates','counterfactual_binding','chart_present','details_interaction','no_overflow','readable_text','contrast','no_external_requests','no_script_errors'],
  visual_rubric: ['hierarchy','readability','chart_fit','consistency','polish'],
  visual_scale: 'Each 1-5; implementing agent inspection, not independent blinded human preference.',
  cost: 'Claude client estimate only; private deployment cost unknown. Shared query counted once. No billed-total claim.',
  latency: 'Measured generation and QA separately. Composed=shared data+generation, not independent end-to-end runs.',
});
export function schedule() {
  return cases.flatMap((c, i) => [1,2].map(repeat => ({ case:c, repeat,
    order:(i*2+repeat)%2 ? ['nemotron','claude'] : ['claude','nemotron'] })));
}
