import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskController } from '../controller.mjs';
import { ContractError, digest, parseContract, validateDashboard } from '../contracts.mjs';
import { FakePlanner, FakeWren, FakeCloud, FakeExportBroker, ManualClock, aggregate, design, makePlan, PRIVATE_CANARY } from '../fakes.mjs';

function harness(options = {}) {
  const config = { plan: makePlan(), planner: new FakePlanner(), wren: new FakeWren(),
    cloud: new FakeCloud(), broker: new FakeExportBroker(), clock: new ManualClock(), ...options };
  return { ...config, host: new TaskController(config) };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, no) => { resolve = ok; reject = no; });
  return { promise, resolve, reject };
}
function heldCloud() {
  const entered = deferred(), result = deferred();
  return { entered, result, requests: [], async design(bundle, { signal }) {
    this.requests.push(bundle); entered.resolve({ bundle, signal }); return result.promise;
  } };
}
function answer(waiting, choice) {
  return { question_id: waiting.question.question_id, plan_revision: waiting.question.plan_revision, choice };
}

test('dashboard runs offline; actual cloud payload is only a granted aggregate and template', async () => {
  const h = harness();
  const result = await h.host.run();
  assert.equal(result.state, 'completed');
  assert.equal(result.output.kind, 'dashboard');
  assert.deepEqual(result.output.dataset, aggregate());
  assert.equal(h.cloud.requests.length, 1);
  const sent = h.cloud.requests[0];
  assert.equal(sent.payload_digest, digest(sent.payload));
  assert.deepEqual(Object.keys(sent.payload).sort(), ['brief', 'dataset', 'theme']);
  const wire = JSON.stringify(h.cloud.requests);
  for (const forbidden of [PRIVATE_CANARY, 'SELECT', 'raw_rows', 'metadata', 'session_id', 'result_ref', 'continuation_ref'])
    assert.equal(wire.includes(forbidden), false, forbidden);
  assert.deepEqual(result.events.map(e => e.state), ['querying', 'understanding', 'export_ready', 'cloud_running', 'validating', 'completed']);
  assert.equal(h.wren.activeSessions, 0);
  assert.equal(h.clock.pendingTimers, 0);
  assert.equal(h.broker.audit.length, 2);
  assert.throws(() => { sent.payload.dataset.rows[0].revenue = 999; }, TypeError);
});

test('private-only answer makes no cloud calls', async () => {
  const h = harness({ plan: makePlan({ output: 'answer' }) });
  const result = await h.host.run();
  assert.equal(result.state, 'completed');
  assert.equal(result.output.kind, 'answer');
  assert.equal(h.cloud.requests.length, 0);
});

test('planner clarification suspends; rejects invented and stale answers without altering state', async () => {
  const h = harness({ plan: makePlan({ status_scope: null }) });
  const waiting = await h.host.run();
  assert.equal(waiting.state, 'waiting_for_user');
  assert.equal(waiting.question.source, 'planner');
  assert.equal(h.wren.calls.length, 0);
  for (const invalid of [{ ...answer(waiting, 'paid'), question_id: 'invented' },
    { ...answer(waiting, 'paid'), plan_revision: 99 }, answer(waiting, 'unknown')]) {
    await assert.rejects(h.host.answer(invalid), ContractError);
    assert.deepEqual(h.host.snapshot(), waiting);
  }
  const result = await h.host.answer(answer(waiting, 'paid'));
  assert.equal(result.state, 'completed');
  assert.equal(result.plan.revision, 1);
  assert.equal(h.wren.calls.filter(c => c.method === 'open').length, 1);
  await assert.rejects(h.host.answer(answer(waiting, 'paid')), ContractError);
});

test('Wren continuation receives the real answer and exact service revision', async () => {
  const regular = new FakePlanner();
  const h = harness({ plan: makePlan({ status_scope: null }),
    planner: { next: (context, options) => context.plan.status_scope === null
      ? { action: 'query_private' } : regular.next(context, options) } });
  const waiting = await h.host.run();
  assert.equal(waiting.question.source, 'wren');
  assert.equal(waiting.plan.revision, 0);
  assert.equal(waiting.session_revision, 1);
  assert.equal(h.wren.calls.some(c => c.method === 'continue'), false);
  const result = await h.host.answer(answer(waiting, 'all'));
  assert.equal(result.state, 'completed');
  assert.equal(result.plan.revision, 1);
  assert.equal(result.session_revision, 2);
  const continuation = h.wren.calls.find(c => c.method === 'continue');
  assert.equal(continuation.request.expected_revision, 1);
  assert.equal(continuation.request.answer, 'all');
  assert.equal(continuation.request.session_id, h.wren.calls.find(c => c.method === 'ask').request.session_id);
  assert.equal(h.cloud.requests[0].payload.dataset.status_scope, 'all');
});

test('cloud clarification returns to human, then uses a new bundle with updated revision', async () => {
  const cloud = new FakeCloud();
  cloud.design = async (bundle) => {
    cloud.requests.push(bundle);
    return cloud.requests.length === 1 ? { kind: 'needs_clarification', field: 'theme' } : design(bundle);
  };
  const h = harness({ cloud });
  const waiting = await h.host.run();
  assert.equal(waiting.question.source, 'cloud');
  const result = await h.host.answer(answer(waiting, 'dark'));
  assert.equal(result.state, 'completed');
  assert.equal(result.output.spec.theme, 'dark');
  assert.equal(cloud.requests[1].plan_revision, 1);
  assert.notEqual(cloud.requests[0].export_id, cloud.requests[1].export_id);
  assert.equal(h.wren.calls.filter(c => c.method === 'ask').length, 1);
});

test('ungranted data is refused before any cloud invocation', async () => {
  const h = harness({ broker: new FakeExportBroker({ datasets: [] }) });
  const result = await h.host.run();
  assert.equal(result.error, 'disclosure_denied');
  assert.equal(h.cloud.requests.length, 0);
  assert.equal(result.output, null);
  assert.equal(h.wren.activeSessions, 0);
});

for (const action of [
  { action: 'delegate_cloud', capability: 'run_sql' },
  { action: 'delegate_cloud', capability: 'dashboard_design', model: 'other-model' },
  { action: 'query_private', endpoint: 'https://example.invalid' },
  { action: 'answer', choice: 'paid' },
]) test(`model cannot override authority: ${JSON.stringify(action)}`, async () => {
  const h = harness({ planner: { next: () => action } });
  assert.equal((await h.host.run()).error, 'invalid_contract');
  assert.equal(h.wren.calls.length, 0);
  assert.equal(h.cloud.requests.length, 0);
});

for (const end of ['cancel', 'timeout']) test(`${end} aborts a pending cloud call; late success is ignored`, async () => {
  const cloud = heldCloud(), h = harness({ cloud });
  const running = h.host.run();
  const { bundle, signal } = await cloud.entered.promise;
  if (end === 'cancel') h.host.cancel(); else h.clock.advance(60_000);
  const result = await running;
  assert.equal(result.state, end === 'cancel' ? 'cancelled' : 'failed');
  assert.equal(result.error, end === 'cancel' ? 'cancelled' : 'timeout');
  assert.equal(signal.aborted, true);
  assert.equal(result.output, null);
  cloud.result.resolve(design(bundle));
  await Promise.resolve();
  assert.deepEqual(h.host.snapshot(), result);
  assert.equal(h.wren.activeSessions, 0);
  assert.equal(h.clock.pendingTimers, 0);
});

test('cancelled pending operation can reject later without leaking error or changing state', async () => {
  const cloud = heldCloud(), h = harness({ cloud });
  const running = h.host.run(); await cloud.entered.promise;
  h.host.cancel(); const final = await running;
  cloud.result.reject(Error(PRIVATE_CANARY)); await Promise.resolve();
  assert.deepEqual(h.host.snapshot(), final);
});

for (const mutate of ['revoke', 'expire', 'invalidate']) test(`${mutate} during cloud call prevents delivery`, async () => {
  const cloud = heldCloud(), h = harness({ cloud });
  const running = h.host.run(); const { bundle } = await cloud.entered.promise;
  if (mutate === 'revoke') h.broker.revoke();
  if (mutate === 'expire') h.clock.advance(30_000);
  if (mutate === 'invalidate') h.wren.invalidate();
  cloud.result.resolve(design(bundle));
  const result = await running;
  assert.equal(result.state, 'failed');
  assert.equal(result.output, null);
  assert.equal(result.error, mutate === 'invalidate' ? 'invalid_contract' : 'disclosure_denied');
});

test('task deadline remains active while waiting for a human', async () => {
  const h = harness({ plan: makePlan({ status_scope: null }) });
  const waiting = await h.host.run();
  h.clock.advance(60_000);
  assert.equal(h.host.snapshot().error, 'timeout');
  await assert.rejects(h.host.answer(answer(waiting, 'paid')), ContractError);
  assert.equal(h.cloud.requests.length, 0);
});

test('global budget includes planner, session open and queries; no hidden retries', async () => {
  const h = harness({ limits: { calls: 3 } });
  const result = await h.host.run();
  assert.equal(result.error, 'budget_exhausted');
  assert.deepEqual(result.usage, { total: 3, planner: 1, wren: 2, cloud: 0 });
  assert.equal(h.cloud.requests.length, 0);
});

test('cloud budget survives a human clarification', async () => {
  const cloud = new FakeCloud();
  cloud.design = async (bundle) => { cloud.requests.push(bundle); return { kind: 'needs_clarification', field: 'theme' }; };
  const h = harness({ cloud, limits: { cloud: 1 } });
  const waiting = await h.host.run();
  const result = await h.host.answer(answer(waiting, 'dark'));
  assert.equal(result.error, 'budget_exhausted');
  assert.equal(cloud.requests.length, 1);
});

test('repeated private calls consume the same total budget', async () => {
  const h = harness({ planner: { next: () => ({ action: 'query_private' }) }, limits: { calls: 6 } });
  const result = await h.host.run();
  assert.equal(result.error, 'budget_exhausted');
  assert.equal(result.usage.total, 6);
  assert.equal(h.wren.calls.filter(c => c.method === 'open').length, 1);
});

test('concurrent run is rejected and does not duplicate cloud requests', async () => {
  const cloud = heldCloud(), h = harness({ cloud });
  const running = h.host.run(); const { bundle } = await cloud.entered.promise;
  await assert.rejects(h.host.run(), ContractError);
  cloud.result.resolve(design(bundle));
  assert.equal((await running).state, 'completed');
  assert.equal(cloud.requests.length, 1);
  assert.equal((await h.host.run()).state, 'completed');
  assert.equal(cloud.requests.length, 1);
});

for (const mutation of [
  s => { s.plan_revision++; }, s => { s.task_id = 'another-task'; },
  s => { s.export_id = 'another-export'; }, s => { s.charts[0].dataset_version++; },
  s => { s.charts[0].dataset_id = 'another-dataset'; }, s => { s.charts[0].y = 'profit'; },
  s => { s.code = 'fetch("https://example.invalid")'; }, s => { s.charts[0].title = 'Revenue: 999'; },
]) test(`reject malformed or ungrounded cloud design ${mutation.toString()}`, async () => {
  const h = harness({ cloud: { design: b => { const s = design(b); mutation(s); return s; } } });
  const result = await h.host.run();
  assert.equal(result.error, 'invalid_contract'); assert.equal(result.output, null);
});

test('raw adapter errors are not exposed in event logs or output', async () => {
  const h = harness({ cloud: { design: () => { throw Error(`SELECT ${PRIVATE_CANARY}`); } } });
  const result = await h.host.run();
  assert.equal(result.error, 'adapter_failure');
  assert.equal(JSON.stringify(result.events).includes(PRIVATE_CANARY), false);
  assert.equal(result.output, null);
});

test('wrong service revision is rejected before a result is accepted', async () => {
  const wren = new FakeWren(), ask = wren.ask.bind(wren);
  wren.ask = async (...args) => ({ ...await ask(...args), revision: 99 });
  const h = harness({ wren });
  assert.equal((await h.host.run()).error, 'invalid_contract');
  assert.equal(h.cloud.requests.length, 0);
});

test('four contracts reject extra fields, invalid versions, types, and nonfinite values', () => {
  const broker = new FakeExportBroker(), plan = makePlan();
  const bundle = broker.issue({ plan, dataset: aggregate(), recipient: 'fake-designer', purpose: 'dashboard_design', now: 0 });
  const clarification = { version: 1, question_id: 'q', task_id: plan.task_id, plan_revision: 0,
    source: 'planner', field: 'status_scope', question: 'Which orders?', options: ['paid', 'all'] };
  for (const [name, input] of Object.entries({ TaskPlan: plan, Clarification: clarification, ExportBundle: bundle, DashboardSpec: design(bundle) })) {
    assert.deepEqual(parseContract(name, input), input);
    assert.throws(() => parseContract(name, { ...input, sql: PRIVATE_CANARY }), ContractError);
    assert.throws(() => parseContract(name, { ...input, version: 2 }), ContractError);
    const missing = { ...input }; delete missing.version;
    assert.throws(() => parseContract(name, missing), ContractError);
  }
  assert.throws(() => parseContract('TaskPlan', { ...plan, revision: NaN }), ContractError);
  assert.throws(() => parseContract('TaskPlan', { ...plan, revision: 0.5 }), ContractError);
  assert.throws(() => parseContract('TaskPlan', { ...plan, objective: 'x'.repeat(501) }), ContractError);
  assert.throws(() => parseContract('Clarification', { ...clarification, options: ['all', 'paid'] }), ContractError);
  const bad = structuredClone(bundle); bad.payload.dataset.rows[0].revenue = Infinity;
  assert.throws(() => parseContract('ExportBundle', bad), ContractError);
  assert.throws(() => parseContract('__proto__', {}), ContractError);
  assert.deepEqual(validateDashboard(design(bundle), bundle), design(bundle));
});

test('broker refuses tampered receipts even when attacker recomputes the payload digest', () => {
  const broker = new FakeExportBroker(), plan = makePlan();
  const original = broker.issue({ plan, dataset: aggregate(), recipient: 'fake-designer', purpose: 'dashboard_design', now: 0 });
  for (const mutate of [b => { b.payload.dataset.rows[0].revenue++; }, b => { b.recipient = 'other'; },
    b => { b.expires_at++; }, b => { b.plan_revision++; }]) {
    const b = structuredClone(original); mutate(b); b.payload_digest = digest(b.payload);
    assert.throws(() => broker.authorize(b, 0), /disclosure_denied/);
  }
});

test('late session-open response is closed after cancellation', async () => {
  const wren = new FakeWren(), original = wren.open.bind(wren), entered = deferred(), released = deferred();
  wren.open = async (options) => {
    const session = await original(options); entered.resolve();
    await released.promise; return session;
  };
  const h = harness({ wren }), running = h.host.run();
  await entered.promise;
  assert.equal(wren.activeSessions, 1);
  h.host.cancel(); const final = await running;
  released.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(wren.activeSessions, 0);
  assert.deepEqual(h.host.snapshot(), final);
  assert.equal(h.cloud.requests.length, 0);
});

test('timeout during private query cannot produce a later cloud request', async () => {
  const wren = new FakeWren(), original = wren.ask.bind(wren), entered = deferred(), released = deferred();
  wren.ask = async (...args) => {
    const result = await original(...args); entered.resolve();
    await released.promise; return result;
  };
  const h = harness({ wren }), running = h.host.run();
  await entered.promise; h.clock.advance(60_000);
  const final = await running;
  released.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(final.error, 'timeout');
  assert.deepEqual(h.host.snapshot(), final);
  assert.equal(h.cloud.requests.length, 0);
  assert.equal(wren.activeSessions, 0);
});

test('cancel during planner call does not execute its late decision', async () => {
  const entered = deferred(), released = deferred();
  const h = harness({ planner: { next: () => { entered.resolve(); return released.promise; } } });
  const running = h.host.run(); await entered.promise; h.host.cancel();
  const final = await running;
  released.resolve({ action: 'query_private' }); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.host.snapshot(), final);
  assert.equal(h.wren.calls.length, 0);
});

test('a data-agent result cannot label an arbitrary payload as exportable', async () => {
  const wren = new FakeWren(), original = wren.ask.bind(wren);
  wren.ask = async (...args) => {
    const result = structuredClone(await original(...args));
    result.dataset.rows[0].email = PRIVATE_CANARY;
    return result;
  };
  // Simulate a trusted source with a current result, but without an export grant.
  wren.isCurrent = () => true;
  const h = harness({ wren });
  assert.equal((await h.host.run()).error, 'disclosure_denied');
  assert.equal(h.cloud.requests.length, 0);
});

test('fixture labels and duplicate periods are validated beyond structural types', () => {
  const broker = new FakeExportBroker(), plan = makePlan();
  const original = broker.issue({ plan, dataset: aggregate(), recipient: 'fake-designer', purpose: 'dashboard_design', now: 0 });
  for (const mutate of [b => { b.payload.dataset.columns.reverse(); },
    b => { b.payload.dataset.rows[1].month = b.payload.dataset.rows[0].month; }]) {
    const bundle = structuredClone(original); mutate(bundle); bundle.payload_digest = digest(bundle.payload);
    assert.throws(() => parseContract('ExportBundle', bundle), ContractError);
  }
});

test('malformed session opening cleans up its handle before failing', async () => {
  const wren = new FakeWren(), open = wren.open.bind(wren);
  wren.open = async (...args) => ({ ...await open(...args), revision: 9 });
  const h = harness({ wren });
  assert.equal((await h.host.run()).error, 'invalid_contract');
  assert.equal(wren.activeSessions, 0);
  assert.equal(h.cloud.requests.length, 0);
});

test('authorization hooks must explicitly return true', async () => {
  for (const value of [false, undefined, Promise.resolve(true)]) {
    const broker = new FakeExportBroker();
    broker.authorize = () => value;
    const h = harness({ broker });
    assert.equal((await h.host.run()).error, 'invalid_contract');
    assert.equal(h.cloud.requests.length, 0);
  }
});
