import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { randomUUID } from 'node:crypto';
import { snapshot, code } from '../p5/test/fixtures.mjs';
import { immutable, requireThat } from '../contracts.mjs';
import { PiPlanner, privateModel } from './pi.mjs';
import { fixturePolicy } from './policy.mjs';

// Test transport: infer facts from the request, never from a case's expected answer.
export function scriptedIntent(messages) {
  const text = messages.filter(m => m.role === 'user').map(m => typeof m.content === 'string' ? m.content : m.content.map(c => c.text ?? '').join('')).join('\n');
  const metric = text.includes('營收'), period = text.includes('2026-01-01') && text.includes('2026-01-19');
  const week = text.includes('每週') ? '每週' : '按週營收';
  return { metrics: metric ? [{ quote: '營收', definition: 'Revenue using the project definition' }] : [],
    period: period ? { quotes: ['2026-01-01', '2026-01-19'], lower: '2026-01-01', upper: '2026-01-19', timezone: 'UTC' } : null,
    objective: 'Revenue', filters: [], requested_statuses: [],
    groups: metric && period ? [{ id: 'total', capability: 'analytics', quote: text.includes('總額') ? '總額' : '總營收', metric_index: 0, grain: 'scalar' },
      { id: 'weekly', capability: 'analytics', quote: week, metric_index: 0, grain: 'week' }] : [],
    presentation: /漂亮|精緻/.test(text) ? 'dashboard_design' : 'local_answer', unsupported_reason: null };
}
export function scriptedStream(observe = () => {}) {
  return (model, context, options) => {
    options.signal?.throwIfAborted(); observe(context);
    const stream = createAssistantMessageEventStream(), message = { role: 'assistant', api: model.api,
      provider: model.provider, model: model.id, timestamp: Date.now(), stopReason: 'toolUse',
      content: [{ type: 'toolCall', id: randomUUID(), name: 'resolve_intent', arguments: scriptedIntent(context.messages) }],
      usage: { input: 20, output: 10, totalTokens: 30, cacheRead: 0, cacheWrite: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    stream.push({ type: 'start', partial: { ...message, content: [] } });
    stream.push({ type: 'done', reason: 'toolUse', message }); stream.end(); return stream;
  };
}
export function scriptedPorts({ observe = () => {}, clarifyWorker = false, invalidFirst = false } = {}) {
  const counters = { queries: 0, cloud: 0, context: 0, closes: 0, rechecks: 0 };
  const ports = {
    counters, policy: fixturePolicy(async () => true), recipient: 'scripted-cloud',
    planner: new PiPlanner({ model: privateModel({ id: 'nvidia/nemotron-scripted', baseUrl: 'https://offline.invalid/v1' }), streamFn: scriptedStream() }),
    worker: async () => {
      let closed = false, pending = null, asked = false;
      return {
        async context() { counters.context++; return { capabilities: [{ id: 'analytics' }], metadata: { private: 'PRIVATE_METADATA_CANARY' } }; },
        async execute(input) {
          requireThat(!closed); counters.queries++;
          if (clarifyWorker && !asked) { asked = true; pending = input; return { response: { status: 'needs_clarification', question: '請補充業務定義。' }, question_id: 'worker-question' }; }
          if (pending) { requireThat(input.question_id === 'worker-question'); input = pending; pending = null; }
          const value = snapshot().results.find(r => r.group.grain === input.grain);
          return immutable({ response: { status: 'completed', result_ref: randomUUID(), evidence_ref: randomUUID(), result: value.result }, evidence: value.evidence });
        },
        async reauthorize() { requireThat(!closed); counters.rechecks++; },
        async close() { closed = true; counters.closes++; },
      };
    },
    makeDesigner: ({ bundle, attempt, diagnostics }) => ({ recipient: 'scripted-cloud', async design(value, { beforeSend, signal }) {
      await beforeSend(); signal.throwIfAborted(); counters.cloud++;
      observe({ payload: value.payload, design_brief: bundle.design_brief, attempt, diagnostics });
      const spec = code(value);
      if (invalidFirst && attempt === 0) spec.javascript += '\ndocument.querySelector("[data-value]").textContent="999";';
      return { spec, usage: { input_tokens: 20, output_tokens: 10 }, cost_usd: null };
    } }),
  };
  return ports;
}
