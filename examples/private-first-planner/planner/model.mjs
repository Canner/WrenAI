import { requireThat } from '../contracts.mjs';
import { plannerContract } from './intent.mjs';

export class PlannerTimeout extends Error {
  constructor() { super('planner_failed'); this.name = 'PlannerTimeout'; }
}

// One transport attempt. Only the session may retry a timed-out decision, within its budget.
export class NemotronPlanner {
  calls = [];
  #config; #key; #fetch; #contract;
  constructor(config, { apiKey, fetchImpl = fetch, decisionContract = plannerContract } = {}) {
    const url = new URL(config.baseUrl);
    requireThat(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
      && typeof config.id === 'string' && config.id.startsWith('nvidia/') && config.id.includes('nemotron')
      && typeof apiKey === 'string' && apiKey.length > 0);
    this.#config = { ...config, maxTokens: config.maxTokens ?? 1536, timeoutMs: config.timeoutMs ?? 45_000 };
    requireThat(Number.isInteger(this.#config.maxTokens) && this.#config.maxTokens > 0 && this.#config.maxTokens <= 4096
      && Number.isInteger(this.#config.timeoutMs) && this.#config.timeoutMs > 0 && this.#config.timeoutMs <= 120_000);
    this.#key = apiKey; this.#fetch = fetchImpl; this.#contract = decisionContract;
  }
  async decide({ conversation, capabilities, metadata, timeoutMs, signal }) {
    requireThat(this.calls.length < 12); // whole evaluation run, not reset per clarification
    const record = { model: this.#config.id, status: 'started' }; this.calls.push(record);
    const start = performance.now();
    const messages = [{ role: 'system', content: this.#contract.systemPrompt },
      { role: 'user', content: JSON.stringify({ authorized_context: { capabilities, metadata } }) }, ...conversation];
    try {
      const response = await this.#fetch(`${this.#config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${this.#key}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.any([AbortSignal.timeout(Math.min(this.#config.timeoutMs, timeoutMs)), ...(signal ? [signal] : [])]),
        body: JSON.stringify({ model: this.#config.id, messages, tools: this.#contract.tools, tool_choice: 'auto', parallel_tool_calls: false,
          max_tokens: this.#config.maxTokens, temperature: 0, chat_template_kwargs: { enable_thinking: false } }),
      });
      record.http_status = response.status;
      if (!response.ok) throw Error('provider_http_error');
      const reader = response.body.getReader(); let bytes = 0; const chunks = [];
      try {
        while (true) {
          const part = await reader.read(); if (part.done) break;
          bytes += part.value.length;
          if (bytes > 128 * 1024) { await reader.cancel(); throw Error('provider_response_limit'); }
          chunks.push(Buffer.from(part.value));
        }
      } finally { reader.releaseLock(); }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      record.usage = body.usage ?? null;
      const choice = body.choices?.[0], calls = choice?.message?.tool_calls;
      record.finish_reason = choice?.finish_reason ?? null;
      record.tool_count = Array.isArray(calls) ? calls.length : 0;
      requireThat(choice?.finish_reason === 'tool_calls' && Array.isArray(calls) && calls.length === 1
        && calls[0].type === 'function');
      // Local operator evidence only; never forwarded to another model or logged to stdout.
      const proposed = { name: calls[0].function.name, args: JSON.parse(calls[0].function.arguments) };
      record.proposed = proposed;
      const decision = this.#contract.parse(proposed.name, proposed.args, capabilities, { conversation });
      record.status = 'completed'; record.decision = decision;
      return decision;
    } catch (error) {
      record.status = 'failed';
      if (error?.name === 'TimeoutError') {
        record.failure_reason = 'timeout'; throw new PlannerTimeout();
      }
      throw Error('planner_failed'); // never include body/header/credential in diagnostics
    } finally { record.elapsed_ms = Math.round(performance.now() - start); }
  }
}
