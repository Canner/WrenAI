import { randomUUID } from 'node:crypto';
import { ContractError, DisclosureDenied, immutable, parseContract, parseDecision, requireThat, validateDashboard, validateDataset } from './contracts.mjs';

const terminal = new Set(['completed', 'failed', 'cancelled']);
const registry = immutable({ dashboard_design: { recipient: 'fake-designer', output: 'DashboardSpec' } });
export const systemClock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (id) => clearTimeout(id),
};
class Stop extends Error {
  constructor(code) { super(code); this.code = code; }
}

// One instance owns one task. Adapters and user ingress are trusted host code.
// Models can return decisions but never receive this controller or answer().
export class TaskController {
  #plan; #planner; #wren; #cloud; #broker; #clock; #limits;
  #state = 'understanding'; #error = null; #events = []; #question = null;
  #session = null; #result = null; #continuation = null; #answer = null;
  #output = null; #running = false; #started = false; #deadline; #timer;
  #abort = new AbortController(); #used = { total: 0, planner: 0, wren: 0, cloud: 0 };

  constructor({ plan, planner, wren, cloud, broker, clock = systemClock, limits = {} }) {
    this.#plan = parseContract('TaskPlan', plan);
    requireThat(this.#plan.revision === 0);
    this.#planner = planner; this.#wren = wren; this.#cloud = cloud; this.#broker = broker; this.#clock = clock;
    this.#limits = { calls: 16, cloud: 2, deadlineMs: 60_000, ...limits };
    requireThat(Object.keys(this.#limits).every(k => ['calls', 'cloud', 'deadlineMs'].includes(k))
      && Object.values(this.#limits).every(v => Number.isSafeInteger(v) && v > 0 && v <= 2_147_483_647));
  }

  snapshot() {
    // Private host view, not a cloud request. Never includes raw adapter errors.
    return immutable({ plan: this.#plan, state: this.#state, error: this.#error,
      question: this.#question, usage: this.#used, output: this.#output,
      session_revision: this.#session?.revision ?? null, events: this.#events });
  }

  #move(state, code = state) {
    this.#state = state;
    this.#events.push({ state, code, plan_revision: this.#plan.revision });
  }
  #finish(state, code = null) {
    if (terminal.has(this.#state)) return;
    this.#error = code; this.#question = null; this.#continuation = null;
    if (state !== 'completed') this.#output = null;
    this.#move(state, code ?? state);
    this.#clock.clearTimer(this.#timer);
    this.#abort.abort();
    // P0's session adapter has synchronous local cleanup; no network transport.
    if (this.#session) this.#wren.close(this.#session.id);
  }
  #live() {
    if (terminal.has(this.#state)) throw new Stop(this.#error ?? this.#state);
    if (this.#clock.now() >= this.#deadline) {
      this.#finish('failed', 'timeout'); throw new Stop('timeout');
    }
  }
  cancel() { this.#finish('cancelled', 'cancelled'); return this.snapshot(); }

  async #call(kind, operation) {
    this.#live();
    if (this.#used.total >= this.#limits.calls || (kind === 'cloud' && this.#used.cloud >= this.#limits.cloud))
      throw new Stop('budget_exhausted');
    this.#used.total++; this.#used[kind]++;
    const signal = this.#abort.signal;
    let onAbort;
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(new Stop(this.#error ?? 'cancelled'));
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      // Invoke synchronously after guards; no gap before the adapter receives data.
      const reply = await Promise.race([operation(signal), aborted]);
      this.#live();
      return reply;
    } finally { signal.removeEventListener('abort', onAbort); }
  }

  #ask(source, field) {
    requireThat(this.#plan[field] === null);
    this.#question = parseContract('Clarification', {
      version: 1, question_id: randomUUID(), task_id: this.#plan.task_id,
      plan_revision: this.#plan.revision, source, field,
      question: field === 'status_scope' ? '應計算已付款訂單，還是所有訂單？' : '希望使用淺色還是深色主題？',
      options: field === 'status_scope' ? ['paid', 'all'] : ['light', 'dark'],
    });
    this.#move('waiting_for_user');
  }

  async answer({ question_id, plan_revision, choice }) {
    // This method represents trusted human ingress; there is no model-callable equivalent.
    const q = this.#question;
    requireThat(!this.#running && this.#state === 'waiting_for_user' && q
      && q.question_id === question_id && q.plan_revision === plan_revision && q.options.includes(choice));
    try { this.#live(); } catch { return this.snapshot(); }
    this.#plan = parseContract('TaskPlan', { ...this.#plan, revision: this.#plan.revision + 1, [q.field]: choice });
    if (q.source === 'wren') this.#answer = choice;
    if (q.field === 'status_scope') this.#result = null;
    this.#question = null; this.#move('understanding');
    return this.run();
  }

  async #query() {
    this.#move('querying');
    if (!this.#session) {
      const opened = await this.#call('wren', async signal => {
        const value = await this.#wren.open({ signal });
        // A transport may finish opening after cancellation. Do not leak its session.
        if (signal.aborted || !value || typeof value.id !== 'string' || value.revision !== 0) {
          if (typeof value?.id === 'string') this.#wren.close(value.id);
          if (signal.aborted) throw new Stop('cancelled');
          throw new ContractError();
        }
        return value;
      });
      this.#session = { id: opened.id, revision: 0 };
    }
    const previous = this.#session.revision;
    const request = immutable({ session_id: this.#session.id, expected_revision: previous,
      request_id: randomUUID(), metric: this.#plan.metric, period: this.#plan.period,
      status_scope: this.#plan.status_scope });
    const reply = await this.#call('wren', signal => this.#continuation
      ? this.#wren.continue({ ...request, continuation_ref: this.#continuation, answer: this.#answer }, { signal })
      : this.#wren.ask(request, { signal }));
    requireThat(reply && reply.session_id === this.#session.id && reply.revision === previous + 1);
    this.#session.revision = reply.revision;
    this.#continuation = null; this.#answer = null;
    if (reply.kind === 'needs_clarification') {
      requireThat(reply.field === 'status_scope' && typeof reply.continuation_ref === 'string');
      this.#continuation = reply.continuation_ref;
      this.#ask('wren', reply.field);
    } else {
      requireThat(reply.kind === 'completed' && this.#plan.status_scope !== null
        && typeof reply.result_ref === 'string');
      this.#result = immutable(reply);
      this.#move('understanding');
    }
  }

  #currentResult() {
    requireThat(this.#result && this.#wren.isCurrent(this.#result) === true
      && this.#result.dataset.metric === this.#plan.metric
      && this.#result.dataset.period === this.#plan.period
      && this.#result.dataset.status_scope === this.#plan.status_scope);
  }

  async #delegate(capability) {
    const binding = registry[capability];
    requireThat(binding && this.#plan.output === 'dashboard');
    this.#currentResult();
    this.#move('export_ready');
    const bundle = this.#broker.issue({ plan: this.#plan, dataset: this.#result.dataset,
      recipient: binding.recipient, purpose: capability, now: this.#clock.now() });
    const approved = parseContract('ExportBundle', bundle);
    requireThat(approved.task_id === this.#plan.task_id && approved.plan_revision === this.#plan.revision
      && approved.recipient === binding.recipient && approved.purpose === capability);
    requireThat(this.#broker.authorize(approved, this.#clock.now()) === true);
    this.#move('cloud_running');
    const reply = await this.#call('cloud', signal => this.#cloud.design(approved, { signal }));
    this.#currentResult();
    requireThat(this.#broker.authorize(approved, this.#clock.now()) === true);
    if (reply?.kind === 'needs_clarification') {
      requireThat(Object.keys(reply).sort().join(',') === 'field,kind' && reply.field === 'theme');
      this.#ask('cloud', 'theme');
      return;
    }
    this.#move('validating');
    const spec = validateDashboard(reply, approved);
    // This is a validated binding artifact, not an HTML/JS renderer (later phase).
    this.#output = immutable({ kind: 'dashboard', spec, dataset: approved.payload.dataset });
    this.#finish('completed');
  }

  async run() {
    requireThat(!this.#running);
    if (terminal.has(this.#state) || this.#state === 'waiting_for_user') return this.snapshot();
    this.#running = true;
    if (!this.#started) {
      this.#started = true; this.#deadline = this.#clock.now() + this.#limits.deadlineMs;
      this.#timer = this.#clock.setTimer(() => this.#finish('failed', 'timeout'), this.#limits.deadlineMs);
    }
    try {
      while (!terminal.has(this.#state) && this.#state !== 'waiting_for_user') {
        if (this.#continuation) { await this.#query(); continue; }
        const context = immutable({ plan: this.#plan, has_result: this.#result !== null });
        const decision = parseDecision(await this.#call('planner', signal => this.#planner.next(context, { signal })));
        if (decision.action === 'clarify') this.#ask('planner', decision.field);
        else if (decision.action === 'query_private') await this.#query();
        else if (decision.action === 'delegate_cloud') await this.#delegate(decision.capability);
        else {
          requireThat(this.#plan.output === 'answer'); this.#currentResult();
          this.#output = immutable({ kind: 'answer', dataset: validateDataset(this.#result.dataset) });
          this.#finish('completed');
        }
      }
    } catch (error) {
      this.#finish('failed', error instanceof Stop ? error.code
        : error instanceof DisclosureDenied ? 'disclosure_denied'
          : error instanceof ContractError ? 'invalid_contract' : 'adapter_failure');
    } finally { this.#running = false; }
    return this.snapshot();
  }
}
