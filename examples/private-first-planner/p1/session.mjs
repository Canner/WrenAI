import { randomUUID } from 'node:crypto';
import { digest, immutable, requireThat } from '../contracts.mjs';
import { parsePlanDecision } from './planning.mjs';
import { retrievalQuestion } from './retrieval.mjs';
import { PlannerTimeout } from './model.mjs';
import { decidePlanner } from '../harnesses/planner.mjs';
import { requestWorker, readWorkerEvidence } from '../harnesses/worker.mjs';

// Private retrieval loop. P0's fixed-Q3 export contract is unchanged.
// No cloud calls, disclosure forwarding, SQL tool, model-supplied IDs or data retries.
// An optional host planner contract can propose presentation after retrieval.
export class PrivateSession {
  #port; #model; #parse; #session = null; #caps; #metadata; #conversation = [];
  #state = 'new'; #revision = 0; #pending = null; #groups = []; #index = 0;
  #plans = []; #constraints; #results = []; #questions = []; #trace = []; #deadline; #busy = false;
  #used = { planner: 0, queries: 0, clarifications: 0, tools: 0 }; #error = null;
  constructor({ port, model, parseDecision = parsePlanDecision }) { this.#port = port; this.#model = model; this.#parse = parseDecision; }
  snapshot() { return immutable({ state: this.#state, plan_revision: this.#revision,
    service_revision: this.#session?.revision ?? null, pending: this.#pending, plans: this.#plans,
    results: this.#results, questions: this.#questions, trace: this.#trace, usage: this.#used, error: this.#error }); }
  #remaining() { const left = this.#deadline - Date.now(); requireThat(left > 0); return left; }
  async #tool(name, args) {
    requireThat(this.#used.tools++ < 24);
    const start = performance.now();
    const response = await this.#port.call(name, args, { timeoutMs: Math.min(180_000, this.#remaining()) });
    this.#trace.push({ name, args: immutable(args), response: immutable(response), elapsed_ms: Math.round(performance.now() - start) });
    return response;
  }
  async #guard(fn) {
    requireThat(!this.#busy); this.#busy = true;
    try { await fn(); }
    catch { this.#state = 'failed'; this.#error = 'private_flow_failed'; }
    finally { this.#busy = false; }
    return this.snapshot();
  }
  async start(question) {
    requireThat(this.#state === 'new' && typeof question === 'string' && question.length > 0 && question.length <= 4096);
    this.#deadline = Date.now() + 300_000;
    this.#conversation.push({ role: 'user', content: question });
    return this.#guard(async () => {
      this.#caps = await this.#tool('capabilities', {});
      requireThat(Array.isArray(this.#caps.capabilities));
      const session = await this.#tool('open_session', {});
      requireThat(typeof session.session_id === 'string' && session.revision === 0);
      this.#session = { id: session.session_id, revision: 0 };
      const ids = (this.#caps.metadata_documents ?? []).map(x => x.id);
      this.#metadata = ids.length ? await this.#tool('read_metadata', { request: { session_id: this.#session.id, documents: ids } }) : null;
      await this.#plan();
    });
  }
  #wait(source, question, options = [], continuation = null) {
    requireThat(this.#used.clarifications++ < 3 && typeof question === 'string' && question.length > 0);
    this.#pending = { id: randomUUID(), plan_revision: this.#revision, source, question, options, continuation };
    this.#questions.push(immutable(this.#pending)); this.#state = 'waiting_for_user';
  }
  async #plan() {
    let proposed, retried = false;
    for (;;) {
      requireThat(this.#used.planner < 3); this.#used.planner++;
      this.#caps = await this.#tool('capabilities', {});
      try {
        proposed = await decidePlanner({ model: this.#model, parseDecision: this.#parse,
          input: { conversation: this.#conversation, capabilities: this.#caps.capabilities,
            metadata: this.#metadata, timeoutMs: this.#remaining() } });
        break;
      } catch (error) {
        // No plan has been accepted and no data mutation has occurred. Retry at
        // most once; both attempts consume the existing case/run/deadline budget.
        if (!(error instanceof PlannerTimeout) || retried || this.#used.planner >= 3) throw error;
        this.#remaining(); retried = true;
        this.#trace.push({ name: 'planner_retry', reason: 'timeout', after_attempt: this.#used.planner });
      }
    }
    const decision = proposed;
    if (decision.name === 'clarify_intent') {
      this.#conversation.push({ role: 'assistant', content: decision.args.question });
      this.#wait('planner', decision.args.question); return;
    }
    if (decision.name === 'unsupported') { this.#state = 'unsupported'; this.#error = decision.args.reason; return; }
    this.#plans.push({ revision: this.#revision, ...decision.args });
    this.#constraints = decision.args.constraints;
    this.#groups = decision.args.groups; this.#index = 0;
    await this.#retrieve();
  }
  async #accept(response) {
    if (!['completed', 'needs_clarification'].includes(response.status)) {
      this.#state = 'failed'; this.#error = { upstream_status: response.status, reason: response.reason ?? null }; return false;
    }
    requireThat(response.revision === this.#session.revision + 1);
    this.#session.revision = response.revision;
    if (response.status === 'needs_clarification') {
      requireThat(typeof response.continuation_ref === 'string');
      this.#wait('wren', response.question, [], response.continuation_ref); return false;
    }
    const evidence = await readWorkerEvidence({ call: (name, args) => this.#tool(name, args),
      sessionId: this.#session.id, response, grain: this.#groups[this.#index].grain });
    if (!evidence.grainMatches) {
      this.#state = 'failed'; this.#error = 'result_grain_mismatch'; return false;
    }
    this.#results.push({ group: this.#groups[this.#index], plan_revision: this.#revision,
      result_ref: response.result_ref, evidence_ref: response.evidence_ref,
      result: response.result, evidence: evidence.evidence });
    this.#index++; return true;
  }
  async #retrieve() {
    this.#state = 'querying';
    while (this.#index < this.#groups.length) {
      requireThat(this.#used.queries++ < 5);
      const group = this.#groups[this.#index];
      const question = retrievalQuestion(group, this.#constraints);
      requireThat(question.length <= 8192);
      const response = await requestWorker({ call: (name, args) => this.#tool(name, args),
        request: { session_id: this.#session.id, request_id: randomUUID(),
          expected_revision: this.#session.revision, capability: group.capability, question } });
      if (!await this.#accept(response)) return;
    }
    this.#state = 'completed';
  }
  async answer({ question_id, plan_revision, answer }) {
    requireThat(!this.#busy && this.#state === 'waiting_for_user' && this.#pending?.id === question_id
      && this.#pending.plan_revision === plan_revision && typeof answer === 'string' && answer.trim().length > 0 && answer.length <= 4096);
    const pending = this.#pending;
    return this.#guard(async () => {
      this.#remaining(); this.#revision++; this.#pending = null;
      this.#conversation.push({ role: 'user', content: answer });
      if (pending.source === 'planner') { await this.#plan(); return; }
      requireThat(this.#used.queries++ < 5);
      const response = await requestWorker({ call: (name, args) => this.#tool(name, args), operation: 'continue_task',
        request: { session_id: this.#session.id, request_id: randomUUID(),
          expected_revision: this.#session.revision, continuation_ref: pending.continuation, answer } });
      if (await this.#accept(response)) await this.#retrieve();
    });
  }
  async reauthorize() {
    requireThat(!this.#busy && this.#state === 'completed' && this.#session);
    this.#busy = true;
    try {
      for (const saved of this.#results) {
        const fresh = await this.#tool('get_evidence', { request: { session_id: this.#session.id, evidence_ref: saved.evidence_ref } });
        requireThat(digest(fresh.result) === digest(saved.result) && digest(fresh.evidence) === digest(saved.evidence));
      }
      return this.snapshot();
    } finally { this.#busy = false; }
  }
  async close() {
    requireThat(!this.#busy);
    if (!this.#session) return;
    // Cleanup has its own bounded transport window even after the task deadline.
    const response = await this.#port.call('close_session', { session_id: this.#session.id }, { timeoutMs: 10_000 });
    requireThat(response.status === 'closed');
    this.#trace.push({ name: 'close_session', response }); this.#session = null;
  }
}
