import { randomUUID } from 'node:crypto';
import { digest, immutable, requireThat } from '../contracts.mjs';
import { registry, plannerContext, covers, admitDecision, admitWorker } from '../analysis/contracts.mjs';
import { issueReport } from '../analysis/report.mjs';

// Separate report-planning entry, sharing the existing host-owned model/client
// ports. No cloud call, database credential, export grant or cube mutation here.
export class ReportSession {
  #ports; #state = { state: 'idle', revision: 0 }; #conversation = []; #request; #stage; #busy = false; #controller; #effect = false; #closed = false; #pending; #calls = { planner: 0, worker: 0, execution: 0 };
  constructor(ports) {
    requireThat(['loadRegistry', 'authorize', 'execute', 'verify'].every(k => typeof ports[k] === 'function')
      && typeof ports.planner?.decide === 'function' && typeof ports.worker?.decide === 'function');
    this.#ports = ports;
  }
  snapshot() { return immutable(this.#state); }
  #change(fields) { this.#state = { ...fields, revision: this.#state.revision + 1 }; }
  cancel() { this.#controller?.abort(); if (!this.#busy && this.#state.state === 'waiting_for_user') { this.#pending = null; this.#change({ state: 'cancelled', reason: 'user_cancelled' }); } }
  close() { this.cancel(); this.#closed = true; }
  async submit(message, options = {}) {
    requireThat(!this.#closed && !this.#busy && !this.#effect && ['idle', 'completed', 'unsupported', 'failed', 'cancelled'].includes(this.#state.state));
    this.#conversation = [{ role: 'user', content: this.#text(message) }]; this.#calls = { planner: 0, worker: 0, execution: 0 }; this.#pending = null; this.#request = null; this.#stage = 'planner';
    return this.#run(options);
  }
  async answer(question_id, answer, options = {}) {
    requireThat(!this.#closed && !this.#busy && !this.#effect && this.#state.state === 'waiting_for_user' && this.#state.question_id === question_id);
    this.#conversation.push({ role: 'user', content: this.#text(answer) }); return this.#run(options);
  }
  #text(t) { requireThat(typeof t === 'string' && t.trim().length > 0 && t.length <= 4096); return t; }
  async #run({ signal, timeoutMs = 120000 } = {}) {
    requireThat(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 180000);
    this.#busy = true; this.#controller = new AbortController();
    const control = AbortSignal.any([this.#controller.signal, AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
    const check = () => control.throwIfAborted();
    const call = async (fn, arg) => { check(); const result = await fn(immutable(arg)); check(); return result; };
    const authorize = async input => { if (await call(this.#ports.authorize, input) !== true) throw Error('authorization_denied'); };
    const wait = (a, stage) => {
      this.#conversation.push({ role: 'assistant', content: a.question }); this.#stage = stage;
      this.#change({ state: 'waiting_for_user', source: stage, question_id: randomUUID(), question: a.question });
    };
    let abort;
    const cancelled = new Promise((_, reject) => { abort = () => reject(Error('cancelled')); control.addEventListener('abort', abort, { once: true }); });
    const flow = async () => {
      this.#change({ state: 'planning' });
      await authorize({ phase: 'plan' });
      const r = registry(await call(this.#ports.loadRegistry, {}));
      const common = () => ({ conversation: this.#conversation, signal: control, timeoutMs });
      let source;
      if (this.#stage === 'planner') {
        requireThat(++this.#calls.planner <= 3);
        const decision = admitDecision(await this.#ports.planner.decide({ ...common(), capabilities: plannerContext(r), metadata: {} })); check();
        if (decision.status === 'clarify') return wait(decision, 'planner');
        if (decision.status === 'unsupported') return this.#change({ state: 'unsupported', reason: decision.reason });
        this.#request = decision.request;
        if (decision.route === 'cube') source = r.sources.find(s => s.kind === 'cube' && s.id === decision.cube_id && covers(s, this.#request));
        // An incompatible/missing cube never licenses a narrower request. Preserve
        // the admitted intent and ask the worker for an alternative semantic plan.
      }
      const q = this.#request;
      if (!source) {
        const candidates = r.sources.filter(s => s.kind === 'semantic' && covers(s, q));
        if (!candidates.length) return this.#change({ state: 'unsupported', reason: 'No authorized semantic source covers the requested measures, dimensions, filters and period.' });
        requireThat(++this.#calls.worker <= 3);
        this.#change({ state: 'planning_query' });
        const decision = admitDecision(await this.#ports.worker.decide({ ...common(), capabilities: { request: q, sources: candidates.map(({ metadata, ...s }) => s) },
          metadata: Object.fromEntries(candidates.map(s => [s.id, s.metadata])) }), true); check();
        if (decision.status === 'clarify') return wait(decision, 'worker');
        if (decision.status === 'unsupported') return this.#change({ state: 'unsupported', reason: decision.reason });
        source = admitWorker(decision, q, r);
      }
      const plan = immutable({ version: 'semantic-report-plan/1', registry_revision: r.revision, source_id: source.id, source_revision: source.revision, source_kind: source.kind, query: q });
      const current = async () => { const fresh = registry(await call(this.#ports.loadRegistry, {})); if (digest(fresh) !== digest(r)) throw Error('source_changed'); };
      await current(); await authorize({ phase: 'execute', plan });
      requireThat(++this.#calls.execution <= 4); this.#change({ state: 'querying' });
      const execution = await this.#ports.execute({ plan, source, signal: control, timeoutMs }); check();
      if (execution.status === 'needs_clarification') {
        // Existing Wren adapter exposes its own continuation token. Do not guess
        // a new query or turn it into unsupported; preserve the exact pending plan.
        this.#pending = { execution, plan, source, registry: r };
        return wait({ question: this.#text(execution.question) }, 'execution');
      }
      await this.#complete(r, source, q, plan, execution, { call, current, authorize });
    };
    const resume = async () => {
      const pending = this.#pending; requireThat(pending && typeof this.#ports.continueExecution === 'function');
      const { plan, source, registry: r } = pending;
      const current = async () => { if (digest(registry(await call(this.#ports.loadRegistry, {}))) !== digest(r)) throw Error('source_changed'); };
      await current(); await authorize({ phase: 'execute', plan });
      requireThat(++this.#calls.execution <= 4);
      const execution = await this.#ports.continueExecution({ pending: pending.execution, answer: this.#conversation.at(-1).content, plan, source, signal: control, timeoutMs }); check();
      if (execution.status === 'needs_clarification') { pending.execution = execution; return wait({ question: this.#text(execution.question) }, 'execution'); }
      await this.#complete(r, source, plan.query, plan, execution, { call, current, authorize });
      this.#pending = null;
    };
    try { check(); this.#effect = true; const effect = (this.#stage === 'execution' ? resume() : flow()).finally(() => { this.#effect = false; }); await Promise.race([effect, cancelled]); }
    catch (error) { this.#change({ state: control.aborted ? 'cancelled' : 'failed', reason: ['authorization_denied', 'source_changed'].includes(error.message) ? error.message : control.aborted ? 'cancelled_or_deadline' : 'report_planning_failed' }); }
    finally { control.removeEventListener('abort', abort); this.#busy = false; this.#controller = null; }
    return this.snapshot();
  }
  async #complete(r, source, q, plan, execution, { call, current, authorize }) {
    requireThat(execution.status === 'completed' && execution.plan_digest === digest(plan));
    const receipt = await call(this.#ports.verify, { plan, source, execution });
    const report = issueReport({ registry: r, source, query: q, execution, receipt });
    await current(); await authorize({ phase: 'issue_report', plan, data_version: report.capabilities.data_version });
    this.#change({ state: 'completed', report });
  }
}
