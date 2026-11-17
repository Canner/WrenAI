import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Store } from '../store.mjs';
import { Host } from '../controller.mjs';
import { scriptedPorts } from '../scripted.mjs';
import { artifactPorts } from '../artifacts.mjs';
import { ExportBroker } from '../export.mjs';
import { fixturePolicy } from '../policy.mjs';
import { snapshot } from '../../design/test/fixtures.mjs';
import { cases } from '../../eval/scenarios.mjs';
import { digest } from '../../contracts.mjs';
import { serveHost } from '../http.mjs';
import { uiCommand, viewState } from '../tui.mjs';

const scope = cases[0].question;
function command(host, type, payload) { return { id: randomUUID(), expected_revision: host.snapshot().revision, type, payload }; }
async function fixture(t, overrides = {}, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'private-host-test-')), ports = scriptedPorts(options);
  const host = new Host(new Store(join(dir, 'state')), { ...ports, ...artifactPorts(join(dir, 'artifacts')),
    inspect: async () => ({ pass: true, repair_codes: [] }), ...overrides });
  t.after(async () => { await host.close(); await rm(dir, { recursive: true, force: true }); });
  return { dir, ports, host };
}
async function submit(host, message = scope, route = 'adaptive', plan_only = false) {
  host.command(command(host, 'submit', { message, route, plan_only })); await host.idle(); return host.snapshot().task;
}
async function answer(host, value) { host.command(uiCommand(host.snapshot(), value)); await host.idle(); return host.snapshot().task; }

for (const item of cases) for (const route of ['private-only', 'fixed-cloud', 'adaptive']) {
  test(`shared request through pi and host: ${item.id}/${route}`, async t => {
    const sent = [], { host, ports } = await fixture(t, {}, { observe: value => sent.push(value) });
    let task = await submit(host, item.question, route);
    if (item.clarify) {
      assert.equal(task.pending.source, 'planner'); assert.equal(ports.counters.queries, 0);
      task = await answer(host, item.human_answers[0]);
    }
    const cloud = route === 'fixed-cloud' || route === 'adaptive' && item.expected_route === 'dashboard_design';
    assert.equal(ports.counters.queries, 2);
    if (cloud) {
      assert.equal(task.pending.source, 'export'); assert.equal(sent.length, 0);
      task = await answer(host, '/approve');
    }
    assert.equal(task.state, 'completed'); assert.equal(sent.length, cloud ? 1 : 0);
    assert.equal(JSON.stringify(sent).includes('PRIVATE_'), false);
    assert.equal(task.attempts[0]?.cost_usd ?? null, null);
    assert.equal(task.reason, cloud ? 'cloud_design' : 'private_route');
    assert.ok((await readFile(task.artifact)).length);
  });
}
test('command receipts are durable; duplicate payload cannot trigger another effect', async t => {
  const { host, ports, dir } = await fixture(t);
  const c = command(host, 'submit', { message: scope, route: 'private-only', plan_only: false });
  const receipt = host.command(c); assert.deepEqual(host.command(c), receipt); await host.idle();
  assert.deepEqual(host.command(c), receipt); assert.equal(ports.counters.queries, 2);
  assert.throws(() => host.command({ ...c, payload: { ...c.payload, message: 'other' } }));
  const disk = JSON.parse(await readFile(join(dir, 'state/state.json')));
  assert.deepEqual(disk.receipts[c.id].receipt, receipt);
  assert.throws(() => host.command({ ...command(host, 'submit', c.payload), expected_revision: 0 }));
});
test('planner, Wren continuation and export question IDs are distinct and checked', async t => {
  const { host, ports } = await fixture(t, {}, { clarifyWorker: true });
  let task = await submit(host, cases[3].question, 'fixed-cloud');
  const old = task.pending.id; task = await answer(host, cases[3].human_answers[0]);
  assert.equal(task.pending.source, 'wren'); assert.notEqual(task.pending.id, old);
  assert.throws(() => host.command(command(host, 'answer', { question_id: old, answer: 'yes' })));
  task = await answer(host, '使用專案營收定義'); assert.equal(task.pending.source, 'export');
  assert.throws(() => host.command(command(host, 'answer', { question_id: task.pending.id, answer: 'approved' })));
  assert.equal(ports.counters.cloud, 0); task = await answer(host, '/deny'); assert.equal(task.reason, 'export_denied');
});
test('plan-only never queries; redesign reuses results and obtains a fresh grant', async t => {
  const { host, ports } = await fixture(t);
  await submit(host, scope, 'private-only', true); assert.equal(ports.counters.queries, 0);
  await submit(host, scope, 'private-only'); const queries = ports.counters.queries;
  let task = await answer(host, '/redesign default'); assert.equal(task.pending.source, 'export');
  const first = task.export.export_id; await answer(host, '/approve');
  task = await answer(host, '/redesign default'); assert.notEqual(task.export.export_id, first);
  await answer(host, '/deny'); assert.equal(ports.counters.queries, queries);
});
test('bounded repair preserves both candidates and sends only diagnostic enums', async t => {
  let inspections = 0; const sent = [];
  const { host, ports } = await fixture(t, { inspect: async () => ({ pass: ++inspections === 2, repair_codes: ['contrast', 'PRIVATE_DIAGNOSTIC'] }) },
    { observe: value => sent.push(value) });
  await submit(host, scope, 'fixed-cloud'); const task = await answer(host, '/approve');
  assert.equal(task.state, 'completed'); assert.equal(task.attempts.length, 2);
  assert.equal(ports.counters.cloud, 2); assert.deepEqual(sent[1].diagnostics, ['contrast']);
  for (const record of task.attempts) assert.ok((await readFile(record.artifact)).length);
});
test('two failed QA attempts fall back to private results', async t => {
  const { host, ports } = await fixture(t, { inspect: async () => ({ pass: false, repair_codes: ['layout'] }) });
  await submit(host, scope, 'fixed-cloud'); const task = await answer(host, '/approve');
  assert.equal(task.reason, 'design_qa_failed'); assert.equal(ports.counters.cloud, 2); assert.match(task.artifact, /private.html$/);
});
test('cancel invalidates pending export and cannot be resumed by an old UI', async t => {
  const { host, ports } = await fixture(t); await submit(host, scope, 'fixed-cloud');
  const approve = uiCommand(host.snapshot(), '/approve'); await answer(host, '/cancel');
  assert.equal(host.snapshot().task.state, 'cancelled'); assert.throws(() => host.command(approve)); assert.equal(ports.counters.cloud, 0);
});
test('restart retains evidence, interrupts waiting tasks and never resumes grants', async t => {
  const { host, dir } = await fixture(t); await submit(host, scope, 'fixed-cloud');
  const before = host.snapshot(); await host.close();
  const store = new Store(join(dir, 'state'));
  const after = store.snapshot(); assert.equal(after.task.state, 'interrupted');
  assert.equal(after.task.export, null); assert.equal(after.task.reusable, false);
  assert.notEqual(after.epoch, before.epoch); assert.deepEqual(after.task.results, before.task.results);
  assert.throws(() => new Store(join(dir, 'state'))); store.close();
});
test('expired, changed or revoked grants fail even after user approval', async () => {
  let now = 1, current = snapshot(); const audit = [];
  const broker = new ExportBroker({ policy: fixturePolicy(async () => true), current: async () => current, epoch: 'epoch',
    audit: event => audit.push(event), now: () => now });
  const bundle = await broker.propose({ recipient: 'cloud', brief_id: 'default' });
  await assert.rejects(broker.prepare());
  assert.throws(() => broker.approve(bundle.export_id, 'incorrect'));
  broker.approve(bundle.export_id, digest(bundle)); await broker.authorize(bundle, 'send');
  current.results[0].result.rows[0].c0 = 771; await assert.rejects(broker.authorize(bundle, 'send'));
  current = snapshot(); now = bundle.expires_at; await assert.rejects(broker.prepare());
  now = 2; broker.revoke(); await assert.rejects(broker.prepare()); assert.equal(audit.length, 1);
});
test('active policy version and approved brief must still match at send time', async () => {
  const policy = { ...fixturePolicy(async () => true), briefs: { default: 'Approved design' } };
  const broker = new ExportBroker({ policy, current: async () => snapshot(), epoch: 'epoch', audit: async () => {} });
  const bundle = await broker.propose({ recipient: 'cloud', brief_id: 'default' });
  broker.approve(bundle.export_id, digest(bundle));
  policy.version = '2'; await assert.rejects(broker.authorize(bundle, 'send'));
  policy.version = '1'; policy.briefs.default = 'Another design'; await assert.rejects(broker.authorize(bundle, 'send'));
  policy.briefs.default = 'Approved design';
  const changing = new ExportBroker({ policy, current: async () => snapshot(), epoch: 'epoch', audit: async () => { policy.version = '2'; } });
  const second = await changing.propose({ recipient: 'cloud', brief_id: 'default' });
  changing.approve(second.export_id, digest(second)); await assert.rejects(changing.authorize(second, 'send'));
});
test('host deadline returns failure and rejects late planner output', async t => {
  let release; const { host, ports } = await fixture(t, { effectTimeoutMs: 20,
    planner: { decide: () => new Promise(resolve => { release = resolve; }) } });
  await submit(host); assert.equal(host.snapshot().task.state, 'failed'); assert.equal(ports.counters.queries, 0);
  release({ name: 'unsupported', args: { reason: 'late' } }); await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(host.snapshot().task.state, 'failed');
});
test('loopback API authenticates, rejects browser origins, and reconnect reads state', async t => {
  const { host } = await fixture(t), token = 'a'.repeat(40), api = await serveHost(host, { token });
  t.after(() => api.close());
  assert.equal((await fetch(`${api.url}/state`)).status, 403);
  assert.equal((await fetch(`${api.url}/state`, { headers: { Authorization: `Bearer ${token}`, Origin: 'https://evil.invalid' } })).status, 403);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const c = command(host, 'submit', { message: scope, route: 'private-only', plan_only: true });
  assert.equal((await fetch(`${api.url}/commands`, { method: 'POST', headers, body: JSON.stringify(c) })).status, 202);
  await host.idle(); const state = await (await fetch(`${api.url}/state`, { headers })).json();
  assert.equal(state.task.state, 'completed');
  assert.equal(viewState({ task: { state: '\x1b[31mtext\x07', reason: 'test' }, revision: 1 }).includes('\x1b'), false);
});
test('actual process death leaves a recoverable journal without a live grant', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'private-host-crash-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const source = `import {Store} from ${JSON.stringify(new URL('../store.mjs', import.meta.url).href)};
    const store=new Store(process.argv[1]);store.change('working',s=>{s.task={id:'crash',state:'querying',export:{id:'old'}}});
    console.log('ready');setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source, dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  await once(child.stdout, 'data'); const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit;
  const store = new Store(dir);
  try { assert.equal(store.snapshot().task.state, 'interrupted'); assert.equal(store.snapshot().task.export, null); }
  finally { store.close(); }
});
test('cancel while a cloud call is pending rejects the late candidate', async t => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const { host } = await fixture(t, { makeDesigner: () => ({ recipient: 'scripted-cloud', design: async (_bundle, { beforeSend }) => {
    await beforeSend(); entered(); return new Promise(resolve => { release = resolve; });
  } }) });
  await submit(host, scope, 'fixed-cloud'); host.command(uiCommand(host.snapshot(), '/approve')); await started;
  host.command(uiCommand(host.snapshot(), '/cancel')); await host.idle();
  release({ spec: {} }); await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(host.snapshot().task.state, 'cancelled'); assert.equal(host.snapshot().task.artifact, undefined);
});
