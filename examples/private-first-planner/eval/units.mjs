import { decidePlanner } from '../harnesses/planner.mjs';
import { WorkerSession } from '../harnesses/worker.mjs';
import { generateCode } from '../design/design.mjs';
import { parse } from '../planner/decision.mjs';
import { requireThat } from '../contracts.mjs';

export function plannerUnit({ model, input, binding, signal, observeAttempt, parseDecision = parse }) {
  let observed = 0;
  return { async run() {
    const conversation = structuredClone(input.conversation), decisions = [];
    for (let i = 0; i < binding.limits.max_turns; i++) {
      signal.throwIfAborted();
      let decision;
      try {
        decision = await decidePlanner({ model, parseDecision: (name, args, capabilities) => parseDecision(name, args, capabilities, { conversation }), input: {
          conversation, capabilities: input.capabilities, metadata: input.metadata ?? null,
          timeoutMs: binding.limits.timeout_ms, signal } });
      } finally {
        for (const call of model.calls.slice(observed)) observeAttempt({ status: call.status === 'completed' ? 'completed' : 'failed',
          elapsed_ms: call.elapsed_ms, input_tokens: call.usage?.prompt_tokens ?? call.usage?.input,
          output_tokens: call.usage?.completion_tokens ?? call.usage?.output, cost_usd: null });
        observed = model.calls.length;
      }
      decisions.push(decision);
      if (decision.name !== 'clarify_intent') return { decisions, final: decision };
      const reply = input.replies?.[i];
      if (!reply) return { decisions, final: decision };
      requireThat(typeof reply.answer === 'string' && Array.isArray(reply.question_terms)
        && reply.question_terms.length > 0 && reply.question_terms.every(term => decision.args.question.includes(term)));
      conversation.push({ role: 'assistant', content: decision.args.question }, { role: 'user', content: reply.answer });
    }
    throw Error('invalid_contract');
  } };
}

export function workerUnit({ port, input, binding, signal, collectAttempts = () => [] }) {
  const session = new WorkerSession(port); let closing;
  const close = () => closing ??= session.close();
  const cancel = () => { close().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  return { async run() {
    const turns = [];
    let result = await session.execute(input.task, { timeoutMs: binding.limits.timeout_ms }); turns.push(result);
    for (const reply of input.replies ?? []) {
      if (result.response.status !== 'needs_clarification') break;
      signal.throwIfAborted();
      requireThat(reply.question_terms.every(t => result.response.question.includes(t)));
      result = await session.execute({ question_id: result.question_id, answer: reply.answer }, { timeoutMs: binding.limits.timeout_ms });
      turns.push(result);
    }
    signal.throwIfAborted(); return { turns, final: result };
  }, async close() { signal.removeEventListener('abort', cancel); await close(); await collectAttempts(); } };
}

export function cloudUnit({ broker, designer, binding, signal, inspect, collectAttempts = () => [] }) {
  return { async run() {
    const result = await generateCode({ broker, designer, deadline: Date.now() + binding.limits.timeout_ms, signal });
    const qa = result.state === 'generated' && inspect ? await inspect(result) : null;
    return { ...result, qa, quality_measured: qa !== null };
  }, async close() { broker.revoke(); await collectAttempts(); } };
}
