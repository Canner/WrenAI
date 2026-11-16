import { NemotronPlanner } from '../p1/model.mjs';
import { plannerContract } from '../p4/intent-planning.mjs';
import { FixtureBroker } from '../p2/broker.mjs';
import { plannerUnit, cloudUnit } from './units.mjs';
import { code, snapshot } from '../p5/test/fixtures.mjs';
import { requireThat } from '../contracts.mjs';

export const scriptedBinding = {
  mode: 'scripted', model: 'nvidia/nemotron-scripted', deployment: 'offline-fixture', runtime: `node-${process.versions.node}`,
  parameters: { temperature: 0, max_tokens: 4096, thinking: 'off' }, limits: { max_turns: 3, timeout_ms: 30_000 },
};
export function intentResponse(conversation) {
  const text = conversation.filter(m => m.role === 'user').map(m => m.content).join('\n');
  return { metrics: text.includes('營收') ? [{ quote: '營收', definition: 'Revenue using the project definition' }] : [],
    period: text.includes('2026-01-01') ? { quotes: ['2026-01-01', '2026-01-19'], lower: '2026-01-01', upper: '2026-01-19', timezone: 'UTC' } : null,
    objective: 'Revenue', filters: [], requested_statuses: [],
    groups: text.includes('2026-01-01') ? [
      { id: 'total', capability: 'analytics', quote: '總額', metric_index: 0, grain: 'scalar' },
      { id: 'weekly', capability: 'analytics', quote: text.includes('每週') ? '每週' : '總額', metric_index: 0, grain: 'week' },
    ] : [], presentation: 'dashboard_design', unsupported_reason: text.includes('刪除') ? 'Read-only analysis only' : null };
}
export function scriptedPlanner(options, { observeRequest = () => {} } = {}) {
  const model = new NemotronPlanner({ id: 'nvidia/nemotron-scripted', baseUrl: 'https://offline.invalid/v1',
    maxTokens: options.binding.parameters.max_tokens }, { apiKey: 'synthetic-not-a-credential', decisionContract: plannerContract,
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body); observeRequest(body);
      request.signal.throwIfAborted();
      if (body.messages.some(m => m.content.includes('測試逾時'))) throw new DOMException('scripted timeout', 'TimeoutError');
      const args = intentResponse(body.messages.slice(2));
      return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ type: 'function',
        function: { name: 'resolve_intent', arguments: JSON.stringify(args) } }] } }],
        usage: { prompt_tokens: 20, completion_tokens: 10 } });
    } });
  return plannerUnit({ ...options, model });
}

export function scriptedCloud(options, { observeRequest = () => {}, inspect } = {}) {
  const { input, observeAttempt } = options;
  const broker = new FixtureBroker({ session: { reauthorize: async () => snapshot() }, verifySource: async () => true,
    recipient: 'scripted-cloud', audit: async () => {} });
  if (input.treatment === 'denied') broker.revoke();
  const designer = { recipient: 'scripted-cloud', async design(bundle, { beforeSend, signal }) {
    await beforeSend(); signal.throwIfAborted();
    // Same minimal assembly boundary as the free-design adapter. No private state.
    observeRequest({ export_id: bundle.export_id, data_version: bundle.data_version,
      payload: bundle.payload, design_brief: input.brief });
    observeAttempt({ status: 'completed', input_tokens: 20, output_tokens: 10, elapsed_ms: 0, cost_usd: null });
    const spec = code(bundle);
    if (input.treatment === 'stale') spec.data_version = '0'.repeat(64);
    if (input.treatment === 'inline-script') spec.html += '<script>alert(1)</script>';
    if (input.treatment === 'revoke') broker.revoke();
    requireThat(['valid', 'stale', 'inline-script', 'revoke'].includes(input.treatment));
    return { spec, usage: { input_tokens: 20, output_tokens: 10 }, cost_usd: null };
  } };
  return cloudUnit({ ...options, broker, designer, inspect });
}
