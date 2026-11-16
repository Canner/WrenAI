import { Agent } from '@earendil-works/pi-agent-core';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';
import { plannerContract } from '../p4/intent-planning.mjs';
import { immutable, requireThat } from '../contracts.mjs';

// pi IS the private planner executor. No second planner agent, shell tools,
// extensions, implicit credentials, model-switch command or cloud transcript.
export class PiPlanner {
  #model; #stream; #key; #options; #timeout; #observeRequest; #observeResult; calls = [];
  constructor({ model, apiKey, streamFn = streamSimple, maxTokens = 1536, timeoutMs = 45_000,
    observeRequest = async () => {}, observeResult = async () => {} }) {
    const url = new URL(model.baseUrl);
    requireThat(model.api === 'openai-completions' && model.id.includes('nemotron')
      && !url.username && !url.password && !url.search && !url.hash
      && (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))
      && Number.isInteger(maxTokens) && maxTokens > 0 && maxTokens <= 4096
      && Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 120_000);
    this.#model = immutable(model); this.#key = apiKey; this.#stream = streamFn;
    this.#options = { maxTokens, temperature: 0, maxRetries: 0 };
    this.#timeout = timeoutMs; this.#observeRequest = observeRequest; this.#observeResult = observeResult;
  }
  async decide({ conversation, capabilities, metadata, signal, timeoutMs = 120_000 }) {
    const definition = plannerContract.tools[0].function;
    let proposed, executed = 0, requests = 0, succeeded = false;
    const started = performance.now();
    const agent = new Agent({ initialState: { model: this.#model, thinkingLevel: 'off',
      systemPrompt: `${plannerContract.systemPrompt}\nAuthorized private context:\n${JSON.stringify({ capabilities, metadata })}`,
      tools: [{ name: definition.name, description: definition.description, parameters: definition.parameters, label: 'Resolve intent',
        execute: async (_id, args) => {
          requireThat(++executed === 1); proposed = { name: definition.name, args };
          return { content: [{ type: 'text', text: 'Decision recorded. The host will validate it.' }], details: {}, terminate: true };
        } }],
    }, streamFn: (model, context, options) => {
      requireThat(++requests === 1);
      return this.#stream(model, context, { ...options, ...this.#options, apiKey: this.#key,
        onPayload: async payload => {
          // pi's off thinking level alone does not serialize NVIDIA's opt-out
          // when model.reasoning=false. Match the established planner binding.
          payload.chat_template_kwargs = { enable_thinking: false };
          payload.parallel_tool_calls = false; payload.tool_choice = 'auto';
          await this.#observeRequest(immutable(payload)); return payload;
        } });
    }, finishTurn: () => ({ action: 'end' }), maxRetryDelayMs: 0 });
    const control = AbortSignal.any([AbortSignal.timeout(Math.max(1, Math.min(this.#timeout, timeoutMs))), ...(signal ? [signal] : [])]);
    const abort = () => agent.abort(); control.addEventListener('abort', abort, { once: true });
    try {
      control.throwIfAborted();
      await agent.prompt(conversation.map(m => m.role === 'user' ? { ...m, timestamp: Date.now() } : {
        role: 'assistant', content: [{ type: 'text', text: m.content }], timestamp: Date.now(),
        api: this.#model.api, provider: this.#model.provider, model: this.#model.id, stopReason: 'stop',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      }));
      control.throwIfAborted();
      const assistants = agent.state.messages.filter(m => m.role === 'assistant');
      requireThat(assistants.at(-1)?.stopReason === 'toolUse'
        && assistants.at(-1).content.filter(c => c.type === 'toolCall').length === 1 && proposed);
      succeeded = true; return immutable(proposed);
    } finally {
      control.removeEventListener('abort', abort);
      const message = agent.state.messages.filter(m => m.role === 'assistant').at(-1);
      const usage = message?.usage ? Object.fromEntries(['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens']
        .map(key => [key, message.usage[key]])) : null;
      this.calls.push({ status: succeeded ? 'completed' : 'failed',
        elapsed_ms: Math.round(performance.now() - started), usage, cost_usd: null });
      await this.#observeResult(immutable({ message: message ?? null, call: this.calls.at(-1) }));
    }
  }
}

export function privateModel({ id, baseUrl }) {
  return { id, baseUrl, name: id, api: 'openai-completions', provider: 'private-nemotron',
    reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32768, maxTokens: 4096 };
}
