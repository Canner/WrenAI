import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Host } from '../controller.mjs';
import { Store } from '../store.mjs';
import { scriptedPorts } from '../scripted.mjs';
import { artifactPorts } from '../artifacts.mjs';
import { viewState, uiCommand } from '../tui.mjs';
import { cases } from '../../eval/scenarios.mjs';
import { evidenceCase, validationCases, validationUnit, scoreValidation, period } from '../../eval/data-validation.mjs';
import { assessData, combineData } from '../../harnesses/data-validation.mjs';
import { assessFixtureData, fixturePolicy } from '../policy.mjs';
import { scoreWorker } from '../../eval/scorers.mjs';

for (const c of validationCases) test(`independent data regression: ${c.id}`, async () => {
  const unit = await validationUnit({ input: c.input });
  try { assert.equal(scoreValidation({ state: 'completed', output: await unit.run() }, c.expected).passed, true); }
  finally { await unit.close(); }
});
test('missing evidence never passes the independent worker scorer despite correct values', async () => {
  const unit = await validationUnit({ input: { treatment: 'missing-period' } });
  try {
    const output = await unit.run();
    const record = { state: 'completed', output: { final: output.result, turns: [output.result] } };
    assert.equal(scoreWorker(record, { status: 'completed', weekly: [['2025-12-29', 50], ['2026-01-05', 220], ['2026-01-12', 500]] }).passed, false);
  } finally { await unit.close(); }
});
test('partial weeks and midnight spellings are valid; omitted period or old records are unverified', () => {
  const item = evidenceCase(); item.evidence.applied_period.lower += 'T00:00:00Z';
  assert.equal(assessData({ ...item, grain: 'week', period }).status, 'verified');
  assert.equal(assessData({ ...item, grain: 'week' }).status, 'unverified');
  assert.equal(combineData([undefined]).status, 'unverified');
});
async function hostFixture(t, treatment, { recover = false, clarifyRepair = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'data-validation-')); const ports = scriptedPorts();
  const factory = ports.worker; let corrupted = 0, pending;
  ports.worker = async () => {
    const worker = await factory(); const execute = worker.execute;
    worker.execute = async input => {
      if (pending) { input = pending; pending = null; }
      if (clarifyRepair && input.grain === 'week' && corrupted === 1) { pending = input; corrupted++;
        return { response: { status: 'needs_clarification', question: '確認期間' }, question_id: 'repair-question' }; }
      const value = structuredClone(await execute(input));
      if (input.grain === 'week' && (!recover || corrupted === 0)) {
        const item = evidenceCase(treatment); value.response.result = item.result; value.evidence = item.evidence; corrupted++;
        // A model/adapter-supplied optimistic status must not bypass the host.
        value.validation = { contract: 'data-verification/1', status: 'verified', blockers: [], warnings: [] };
      }
      return value;
    }; return worker;
  };
  const host = new Host(new Store(join(dir, 'state')), { ...ports, ...artifactPorts(join(dir, 'artifacts')) });
  t.after(async () => { await host.close(); await rm(dir, { recursive: true, force: true }); });
  host.command({ id: randomUUID(), expected_revision: host.snapshot().revision, type: 'submit',
    payload: { message: cases[0].question, route: 'fixed-cloud', plan_only: false } });
  await host.idle(); return { host, ports };
}
test('missing period delivers labeled preview, never export, never repairs or redesigns', async t => {
  const { host, ports } = await hostFixture(t, 'missing-period'); const task = host.snapshot().task;
  assert.equal(task.state, 'completed'); assert.equal(task.reason, 'data_unverified');
  assert.equal(task.data_validation.status, 'unverified'); assert.equal(task.export, null);
  assert.equal(ports.counters.queries, 2); assert.equal(ports.counters.cloud, 0);
  assert.match(viewState(host.snapshot()), /預覽可用（尚未驗證）/);
  const html = await readFile(task.artifact, 'utf8'); assert.match(html, /查詢期間證據不足/);
  assert.doesNotMatch(html, /validated private query results/);
  assert.throws(() => host.command(uiCommand(host.snapshot(), '/redesign default')));
});
for (const treatment of ['wrong-period', 'wrong-value', 'failed-rule']) test(`${treatment}: only one repair, no invalid delivery`, async t => {
  const { host, ports } = await hostFixture(t, treatment); const task = host.snapshot().task;
  assert.equal(task.state, 'failed'); assert.equal(task.reason, 'data_validation_failed');
  assert.equal(task.data_validation.status, 'rejected'); assert.equal(ports.counters.queries, 3);
  assert.equal(task.artifact, undefined); assert.equal(task.results.length, 1); assert.equal(task.export, null);
  assert.equal(task.data_attempts.filter(a => a.validation.status === 'rejected').length, 2);
  assert.match(viewState(host.snapshot()), /不能交付/);
});
test('successful bounded repair retains evidence and still requires export approval', async t => {
  const { host, ports } = await hostFixture(t, 'wrong-period', { recover: true }); const task = host.snapshot().task;
  assert.equal(task.state, 'waiting'); assert.equal(task.pending.source, 'export');
  assert.equal(task.data_validation.status, 'verified'); assert.equal(ports.counters.queries, 3);
  assert.equal(ports.counters.cloud, 0); assert.equal(task.data_attempts.length, 3);
});
test('worker clarification during repair does not reset the repair limit', async t => {
  const { host } = await hostFixture(t, 'wrong-period', { clarifyRepair: true });
  assert.equal(host.snapshot().task.pending.source, 'wren');
  host.command(uiCommand(host.snapshot(), '同一期間')); await host.idle();
  assert.equal(host.snapshot().task.reason, 'data_validation_failed');
  assert.equal(Object.values(host.snapshot().task.data_repairs)[0], 1);
});

test('a service with no applicable rules need not invent extra evidence', () => {
  const item = evidenceCase(); item.evidence.checks_summary = 'none_applicable'; item.evidence.checks = {};
  assert.equal(assessData({ ...item, grain: 'week', period }).status, 'verified');
});

test('fixture value oracle never rejects other metrics, custom filters or an unverified source as wrong values', async () => {
  for (const mutate of [x => { x.group.metric = 'Order count'; }, x => { x.constraints.filters = ['region=west']; },
    x => { x.constraints.requested_statuses = ['cancelled']; }]) {
    const item = evidenceCase('wrong-value'); mutate(item);
    const value = assessFixtureData({ ...item, grain: 'week', period });
    assert.equal(value.status, 'unverified'); assert.equal(value.blockers.length, 0);
  }
  const item = evidenceCase('wrong-value');
  assert.equal((await fixturePolicy(async () => false).assessData({ ...item, grain: 'week', period })).status, 'unverified');
  const wrongPeriod = evidenceCase('wrong-period');
  assert.equal((await fixturePolicy(async () => false).assessData({ ...wrongPeriod, grain: 'week', period })).status, 'rejected');
});
