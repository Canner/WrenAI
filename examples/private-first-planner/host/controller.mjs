import { assessData, combineData } from '../harnesses/data-validation.mjs';
import { randomUUID } from 'node:crypto';
import { digest, immutable, requireThat } from '../contracts.mjs';
import { decidePlanner } from '../harnesses/planner.mjs';
import { plannerContract } from '../planner/intent.mjs';
import { retrievalQuestion } from '../worker/retrieval.mjs';
import { ExportBroker } from './export.mjs';
import { designWithRepair } from './cloud.mjs';
import { harnessIds, releaseFor } from '../harnesses/releases.mjs';

const terminal = state => ['completed', 'failed', 'cancelled', 'unsupported', 'interrupted'].includes(state);
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 4096;
const exact = (value, keys) => requireThat(value && Object.keys(value).sort().join() === keys.sort().join());

// UI commands enter here; models never receive this object or a command tool.
// Only the host advances state or grants export. One active task per local host.
export class Host {
  #store; #ports; #worker; #broker; #run; #control; #closed = false; #inflight = false;
  constructor(store, ports) {
    this.#store = store; this.#ports = ports;
    store.change('runtime_bound', state => { state.runtime = { releases: harnessIds.map(id => releaseFor(id)), bindings: ports.bindings ?? null }; });
  }
  snapshot() { return this.#store.snapshot(); }
  async idle() { await this.#run; return this.snapshot(); }
  #change(type, fn) { return this.#store.change(type, state => fn(state.task, state)); }
  #wait(source, question, extra = {}) {
    this.#change('question', task => { task.state = 'waiting'; task.pending = { id: randomUUID(), source, question, ...extra }; });
  }
  command(command) {
    requireThat(!this.#closed);
    exact(command, ['id', 'expected_revision', 'type', 'payload']);
    requireThat(typeof command.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(command.id));
    const before = this.snapshot(), hash = digest(command), prior = before.receipts[command.id];
    if (prior) { requireThat(prior.hash === hash); return immutable(prior.receipt); }
    requireThat(command.expected_revision === before.revision);
    requireThat(command.type === 'cancel' || !this.#inflight);
    const p = command.payload, task = before.task;
    let action;
    if (command.type === 'submit') {
      exact(p, ['message', 'route', 'plan_only']);
      requireThat((!task || terminal(task.state)) && !this.#run && text(p.message)
        && ['private-only', 'fixed-cloud', 'adaptive'].includes(p.route) && typeof p.plan_only === 'boolean');
      action = () => this.#plan();
    } else if (command.type === 'answer') {
      exact(p, ['question_id', 'answer']);
      requireThat(task?.state === 'waiting' && task.pending.id === p.question_id && task.pending.source !== 'export'
        && text(p.answer) && !this.#run);
      const pending = task.pending;
      action = pending.source === 'planner' ? () => this.#plan() : () => this.#retrieve({ question_id: pending.worker_question_id, answer: p.answer });
    } else if (command.type === 'export') {
      exact(p, ['question_id', 'export_id', 'request_digest', 'approve']);
      requireThat(task?.state === 'waiting' && task.pending.source === 'export' && task.pending.id === p.question_id
        && task.export.export_id === p.export_id && digest(task.export) === p.request_digest && typeof p.approve === 'boolean' && !this.#run);
      action = async () => {
        if (!p.approve) { this.#broker.revoke(); return this.#fallback('export_denied'); }
        this.#broker.approve(p.export_id, p.request_digest); await this.#design();
      };
    } else if (command.type === 'redesign') {
      exact(p, ['brief_id']);
      requireThat(task?.state === 'completed' && task.reusable && !this.#run && Object.hasOwn(this.#ports.policy.briefs, p.brief_id));
      action = () => this.#route(p.brief_id, true);
    } else if (command.type === 'cancel') {
      exact(p, []); requireThat(task && !terminal(task.state));
    } else throw Error('invalid_command');
    // Record command and receipt atomically before any tool/provider effect.
    const receipt = { command_id: command.id, accepted_revision: before.revision + 1 };
    this.#change(`command_${command.type}`, (current, state) => {
      state.receipts[command.id] = { hash, receipt };
      if (command.type === 'submit') state.task = { id: randomUUID(), state: 'planning', pending: null, export: null,
        route: p.route, plan_only: p.plan_only, conversation: [{ role: 'user', content: p.message }],
        plan_revision: 0, plans: [], results: [], index: 0, planner_calls: 0, worker_calls: 0, reusable: false,
        data_attempts: [], data_repairs: {}, attempts: [], measurements: [], approvals: [], disclosures: [], export_history: [] };
      else if (command.type === 'cancel') { current.state = 'cancelled'; current.pending = null; current.export = null; current.reusable = false; }
      else {
        if (command.type === 'answer') current.conversation.push({ role: 'user', content: p.answer });
        if (command.type === 'export') current.approvals.push({ ...p, epoch: state.epoch, at: Date.now() });
        current.pending = null; current.state = command.type === 'answer' ? 'working' : 'designing';
      }
    });
    if (command.type === 'cancel') {
      this.#control?.abort(); this.#broker?.revoke();
      // A running effect owns cleanup; a waiting task has no effect to wake.
      if (!this.#run) this.#launch(async () => { await this.#disposeWorker(); }, true);
    } else this.#launch(action);
    return immutable(receipt);
  }
  #launch(action, cleanupOnly = false) {
    const id = this.snapshot().task.id, controller = new AbortController(); this.#control = controller;
    const timeout = setTimeout(() => controller.abort(), this.#ports.effectTimeoutMs ?? 300_000);
    // Calls are bounded, but abort also prevents accepting a late uncooperative result.
    const alive = () => !controller.signal.aborted && !this.#closed && this.snapshot().task?.id === id
      && (!terminal(this.snapshot().task.state) || this.snapshot().task.state === 'completed');
    this.#ports.active = { signal: controller.signal, alive };
    let rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = () => reject(Error('cancelled')); });
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
    this.#inflight = true;
    const effect = Promise.resolve().then(action).finally(() => { this.#inflight = false; });
    this.#run = Promise.race([effect, aborted]).catch(async () => {
      if (this.snapshot().task?.id === id && !['cancelled', 'interrupted'].includes(this.snapshot().task.state)) {
        this.#change('failed', task => { task.state = 'failed'; task.reason = controller.signal.aborted ? 'deadline' : 'flow_failed'; task.pending = null; task.reusable = false; });
      }
    }).finally(async () => {
      clearTimeout(timeout);
      controller.signal.removeEventListener('abort', rejectAbort);
      if (cleanupOnly || controller.signal.aborted || this.snapshot().task?.state === 'failed') {
        this.#broker?.revoke();
        try { await this.#disposeWorker(); } catch { this.#change('cleanup_failed', task => { task.cleanup_failed = true; }); }
      }
      this.#run = null;
    });
  }
  #check() { requireThat(this.#ports.active.alive()); this.#ports.active.signal.throwIfAborted(); }
  async #disposeWorker() { const worker = this.#worker; this.#worker = null; await worker?.close(); }
  async #plan() {
    this.#check();
    if (!this.#worker || this.snapshot().task.planner_calls === 0) {
      this.#broker?.revoke(); await this.#disposeWorker();
      const active = this.#ports.active, worker = await this.#ports.worker();
      if (!active.alive()) { await worker.close(); throw Error('cancelled'); }
      this.#worker = worker; this.#check();
    }
    const context = await this.#worker.context(); this.#check();
    const current = this.snapshot().task;
    requireThat(current.planner_calls < 3);
    this.#change('planner_started', task => { task.planner_calls++; task.state = 'planning'; });
    const conversation = current.conversation;
    const start = performance.now();
    const decision = await decidePlanner({ model: this.#ports.planner,
      parseDecision: (name, args, capabilities) => plannerContract.parse(name, args, capabilities, { conversation }),
      input: { ...context, conversation, signal: this.#ports.active.signal, timeoutMs: 120_000 } });
    this.#check();
    this.#change('planner_finished', task => { task.measurements.push({ stage: 'planner', elapsed_ms: Math.round(performance.now() - start),
      usage: this.#ports.planner.calls?.at(-1)?.usage ?? null, cost_usd: null }); });
    if (decision.name === 'clarify_intent') {
      this.#change('planner_question', task => { task.conversation.push({ role: 'assistant', content: decision.args.question }); });
      this.#wait('planner', decision.args.question); return;
    }
    if (decision.name === 'unsupported') { this.#change('unsupported', task => { task.state = 'unsupported'; task.reason = decision.args.reason; }); return; }
    this.#change('plan_accepted', task => { task.plans.push({ ...decision.args, revision: task.plan_revision }); });
    if (current.plan_only) { this.#change('plan_completed', task => { task.state = 'completed'; }); return; }
    await this.#retrieve();
  }
  async #retrieve(answer) {
    for (;;) {
      this.#check(); const task = this.snapshot().task, plan = task.plans.at(-1);
      if (task.index >= plan.groups.length) { await this.#route(); return; }
      requireThat(task.worker_calls < 8);
      const group = plan.groups[task.index];
      this.#change('worker_started', t => { t.state = 'querying'; t.worker_calls++; });
      const start = performance.now();
      const result = await this.#worker.execute(answer ?? { question: retrievalQuestion(group, plan.constraints) + (task.data_repairs?.[group.id] ? '\nCorrect the previously rejected result. Verify the requested period, grain and declared rules before returning evidence.' : ''),
        capability: group.capability, grain: group.grain, period: plan.constraints.period }, { timeoutMs: 180_000 });
      answer = undefined; this.#check();
      this.#change('worker_finished', task => { task.measurements.push({ stage: 'data-worker', group: group.id,
        elapsed_ms: Math.round(performance.now() - start), usage: null, cost_usd: null }); });
      if (result.response.status === 'needs_clarification') {
        this.#wait('wren', result.response.question, { worker_question_id: result.question_id }); return;
      }
      if (result.response.status !== 'completed' && result.response.status !== 'invalid_result') throw Error('invalid_contract');
      const item = { group, constraints: plan.constraints, plan_revision: task.plan_revision, result: result.response.result, evidence: result.evidence };
      const validation = result.response.status === 'invalid_result' ? result.validation
        : await (this.#ports.policy.assessData ?? assessData)({ ...item, grain: group.grain, period: plan.constraints.period });
      this.#check();
      requireThat(validation?.contract === 'data-verification/1');
      this.#change('data_assessed', t => { t.data_attempts.push({ group: group.id, validation,
        result_ref: result.response.result_ref ?? null, evidence_ref: result.response.evidence_ref ?? null,
        result: result.response.result ?? null, evidence: result.evidence ?? null }); });
      if (validation.status === 'rejected') {
        if (!(task.data_repairs?.[group.id])) {
          this.#change('data_repair_requested', t => { t.data_repairs[group.id] = 1; });
          continue;
        }
        this.#change('data_rejected', t => { t.state = 'failed'; t.reason = 'data_validation_failed';
          t.data_validation = validation; t.reusable = false; });
        return;
      }
      this.#change('result_accepted', t => {
        t.results.push({ group, plan_revision: t.plan_revision, result_ref: result.response.result_ref,
          evidence_ref: result.response.evidence_ref, result: result.response.result, evidence: result.evidence, validation });
        t.index++; t.data_validation = combineData(t.results.map(r => r.validation));
        t.reusable = t.data_validation.status === 'verified';
      });
    }
  }
  async #current() {
    this.#check(); const task = this.snapshot().task;
    await this.#worker.reauthorize(task.results); this.#check();
    return { ...task, state: 'completed' };
  }
  async #route(brief_id = 'default', force = false) {
    this.#check(); const task = this.snapshot().task;
    if (task.data_validation?.status !== 'verified') return this.#fallback('data_unverified');
    const cloud = force || task.route === 'fixed-cloud' || (task.route === 'adaptive' && task.plans.at(-1).presentation === 'dashboard_design');
    if (!cloud) return this.#fallback('private_route');
    this.#broker?.revoke();
    this.#broker = new ExportBroker({ policy: this.#ports.policy, current: () => this.#current(), epoch: this.snapshot().epoch,
      audit: event => { this.#check(); this.#change('export_checked', task => { task.disclosures.push({ ...event, at: Date.now() }); }); } });
    try {
      const bundle = await this.#broker.propose({ recipient: this.#ports.recipient, brief_id }); this.#check();
      this.#change('export_proposed', task => { task.export = bundle; task.export_history.push(bundle); });
      this.#wait('export', '是否允許將以下聚合資料與設計需求傳給指定設計模型？');
    } catch { this.#check(); await this.#fallback('export_not_allowed'); }
  }
  async #fallback(reason) {
    this.#check(); const task = this.snapshot().task;
    await this.#worker.reauthorize(task.results); this.#check();
    const artifact = await this.#ports.savePrivate(task); this.#check();
    this.#change('private_completed', t => { t.state = 'completed'; t.reason = reason; t.artifact = artifact; t.pending = null; });
  }
  async #design() {
    this.#check();
    const result = await designWithRepair({ broker: this.#broker, makeDesigner: this.#ports.makeDesigner,
      inspect: this.#ports.inspect, signal: this.#ports.active.signal,
      save: async record => {
        this.#check(); const artifact = await this.#ports.saveCandidate(record); this.#check();
        this.#change('candidate_saved', task => { task.attempts.push({ attempt: record.attempt, state: record.result.state,
          qa: record.qa, artifact, design_ms: record.design_ms, qa_ms: record.qa_ms,
          usage: record.result.usage ?? null, cost_usd: record.result.cost_usd ?? null }); });
        return artifact;
      } });
    this.#check(); this.#broker.revoke();
    if (result.state === 'fallback') return this.#fallback('design_qa_failed');
    this.#change('design_completed', task => { task.state = 'completed'; task.artifact = result.artifact; task.reason = 'cloud_design'; });
  }
  async close() {
    if (this.#closed) return;
    if (this.snapshot().task && !terminal(this.snapshot().task.state)) this.#change('host_stopped', task => {
      task.state = 'interrupted'; task.reason = 'host_stopped'; task.pending = null; task.export = null; task.reusable = false;
    });
    this.#closed = true; this.#control?.abort(); this.#broker?.revoke(); await this.#run;
    try { await this.#disposeWorker(); } finally {
      try { await this.#ports.closeResources?.(); } finally { this.#store.close(); }
    }
  }
}
