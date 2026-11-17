import { randomUUID } from 'node:crypto';
import { digest, immutable, requireThat } from '../contracts.mjs';
import { validateResultGrain } from '../worker/retrieval.mjs';
import { assessData } from './data-validation.mjs';

export async function requestWorker({ call, operation = 'ask_data', request }) {
  requireThat(['ask_data', 'continue_task'].includes(operation));
  return call(operation, { request });
}

export async function readWorkerEvidence({ call, sessionId, response, grain }) {
  requireThat(typeof response.result_ref === 'string' && typeof response.evidence_ref === 'string'
    && response.result && ['table', 'text'].includes(response.result.kind));
  const evidence = await call('get_evidence', { request: { session_id: sessionId, evidence_ref: response.evidence_ref } });
  requireThat(evidence.evidence && digest(evidence.result) === digest(response.result));
  return { evidence: evidence.evidence, grainMatches: validateResultGrain(response.result, grain) };
}

// Host-owned session adapter shared by application orchestration and independent eval.
// A data-only host entry. No planner, designer, SQL shortcut or synthetic result
// substitution. The caller supplies a trusted MCP port and a normalized task.
export class WorkerSession {
  #port; #session; #pending; #results = new Set(); #busy = false; #closed = false;
  constructor(port) { this.#port = port; }
  async context() {
    requireThat(!this.#busy && !this.#closed); this.#busy = true;
    try {
      const capabilities = await this.#port.call('capabilities', {}, { timeoutMs: 10_000 });
      if (!this.#session) this.#session = await this.#port.call('open_session', {}, { timeoutMs: 10_000 });
      if (this.#closed) { await this.close(); throw Error('invalid_contract'); }
      const documents = (capabilities.metadata_documents ?? []).map(x => x.id);
      const metadata = documents.length ? await this.#port.call('read_metadata', {
        request: { session_id: this.#session.session_id, documents },
      }, { timeoutMs: 10_000 }) : null;
      requireThat(!this.#closed && Array.isArray(capabilities.capabilities));
      return immutable({ capabilities: capabilities.capabilities, metadata });
    } finally { this.#busy = false; }
  }
  async reauthorize(results) {
    requireThat(!this.#busy && !this.#closed && this.#session); this.#busy = true;
    try {
      for (const saved of results) {
        requireThat(this.#results.has(saved.result_ref));
        const fresh = await this.#port.call('get_evidence', {
          request: { session_id: this.#session.session_id, evidence_ref: saved.evidence_ref },
        }, { timeoutMs: 10_000 });
        requireThat(!this.#closed && digest(fresh.result) === digest(saved.result) && digest(fresh.evidence) === digest(saved.evidence));
      }
    } finally { this.#busy = false; }
  }
  async execute(input, { timeoutMs = 180_000 } = {}) {
    requireThat(!this.#busy && !this.#closed);
    this.#busy = true;
    const deadline = Date.now() + timeoutMs;
    const call = (name, args) => {
      const left = deadline - Date.now(); requireThat(left > 0);
      return this.#port.call(name, args, { timeoutMs: left });
    };
    try {
      if (!this.#session) {
        this.#session = await call('open_session', {});
        requireThat(typeof this.#session.session_id === 'string' && this.#session.revision === 0);
        if (this.#closed) { await this.close(); throw Error('invalid_contract'); }
      }
      let operation = 'ask_data';
      const request = { session_id: this.#session.session_id, request_id: randomUUID(), expected_revision: this.#session.revision };
      if (input.answer !== undefined) {
        requireThat(this.#pending && input.question_id === this.#pending.question_id
          && typeof input.answer === 'string' && input.answer.trim().length > 0);
        operation = 'continue_task'; request.continuation_ref = this.#pending.continuation_ref; request.answer = input.answer;
      } else {
        requireThat(!this.#pending && typeof input.question === 'string' && input.question.trim().length > 0
          && typeof input.capability === 'string' && ['scalar', 'week'].includes(input.grain));
        request.capability = input.capability; request.question = input.question;
        if (input.reply_to !== undefined) { requireThat(this.#results.has(input.reply_to)); request.reply_to = input.reply_to; }
      }
      const grain = this.#pending?.grain ?? input.grain;
      const period = this.#pending?.period ?? input.period;
      const response = await requestWorker({ call, operation, request });
      requireThat(!this.#closed);
      if (!['completed', 'needs_clarification'].includes(response.status)) return immutable({ response });
      requireThat(response.revision === this.#session.revision + 1);
      this.#session.revision = response.revision;
      if (response.status === 'needs_clarification') {
        requireThat(typeof response.continuation_ref === 'string' && typeof response.question === 'string');
        this.#pending = { question_id: randomUUID(), continuation_ref: response.continuation_ref, grain, period };
        return immutable({ response, question_id: this.#pending.question_id });
      }
      this.#pending = null;
      const checked = await readWorkerEvidence({ call, sessionId: this.#session.session_id, response, grain });
      requireThat(!this.#closed);
      const validation = assessData({ result: response.result, evidence: checked.evidence, grain, period });
      if (!checked.grainMatches) return immutable({ response: { ...response, status: 'invalid_result', reason: 'result_grain_mismatch' }, evidence: checked.evidence, grain, validation });
      this.#results.add(response.result_ref);
      return immutable({ response, evidence: checked.evidence, grain, validation });
    } finally { this.#busy = false; }
  }
  async close() {
    this.#closed = true;
    if (this.#session) {
      const result = await this.#port.call('close_session', { session_id: this.#session.session_id }, { timeoutMs: 10_000 });
      requireThat(result.status === 'closed'); this.#session = null;
    }
  }
}
