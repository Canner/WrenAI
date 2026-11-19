import test from 'node:test';
import assert from 'node:assert/strict';
import { ReportSession } from '../../host/report.mjs';
import { registry, covers, admitDecision, admitWorker } from '../contracts.mjs';
import { catalog, query, choose, plan, clarify, model, ports, result } from './fixture.mjs';
import { digest } from '../../contracts.mjs';

test('private planner cube reuse bypasses worker; capabilities reflect only requested scope', async () => {
  const p = ports(), host = new ReportSession(p), state = await host.submit('Revenue by country');
  assert.equal(state.state, 'completed'); assert.equal(p.worker.calls.length, 0); assert.equal(p.planner.calls.length, 1);
  const c = state.report.capabilities; assert.equal(c.source.kind, 'cube'); assert.equal(c.dimensions.length, 1); assert.deepEqual(c.hierarchies, []);
  assert(!JSON.stringify(state).includes('PRIVATE_')); assert.equal(c.data_version, digest(state.report.payload));
  assert.deepEqual(p.calls, ['plan', 'execute', 'execute_query', 'issue_report']);
});
test('insufficient cube falls back without dropping channel or product; worker sees private metadata only', async () => {
  for (const dimensions of [['channel'], ['country', 'product_category']]) {
    const q = query(dimensions), p = ports(model(choose(q)), model(plan(q))), s = await new ReportSession(p).submit('Break down revenue');
    assert.equal(s.state, 'completed'); assert.equal(s.report.capabilities.source.kind, 'semantic_query');
    assert.deepEqual(s.report.capabilities.dimensions.map(d => d.id), dimensions);
    assert.equal(p.worker.calls.length, 1); assert(JSON.stringify(p.worker.calls[0].metadata).includes('PRIVATE_RULE'));
    assert(!JSON.stringify(p.planner.calls[0]).includes('PRIVATE_')); assert(!JSON.stringify(s.report).includes('PRIVATE_'));
    assert(!Object.hasOwn(s.report.capabilities, 'cube'));
  }
});
test('clarification pauses before execution and resumes correct component with conversation', async () => {
  for (const worker of [false, true]) {
    const q = query(['channel']); const p = ports(worker ? model(choose(q)) : model(clarify(false), choose(q)), worker ? model(clarify(true), plan(q)) : model(plan(q)));
    const host = new ReportSession(p), waiting = await host.submit('Revenue');
    assert.equal(waiting.state, 'waiting_for_user'); assert(!p.calls.includes('execute_query'));
    await assert.rejects(host.answer('wrong-id', 'Gross'));
    const ready = await host.answer(waiting.question_id, 'Use confirmed gross definition'); assert.equal(ready.state, 'completed');
    assert.equal(p.planner.calls.length, worker ? 1 : 2); assert.equal(p.worker.calls.length, worker ? 2 : 1);
  }
});
test('unknown metrics and periods do not shrink intent or execute', async () => {
  for (const q of [{ ...query(), measures: ['profit'] }, { ...query(), period: { lower: '2030-01-01', upper: '2030-02-01', grain: 'month' } }]) {
    const p = ports(model(choose(q))); const s = await new ReportSession(p).submit('Question');
    assert.equal(s.state, 'unsupported'); assert(!p.calls.includes('execute_query')); assert.equal(p.worker.calls.length, 0);
  }
});
test('worker cannot alter scope, invent a source, add SQL or choose an unsupported join', async () => {
  const q = query(['channel']);
  for (const alter of [a => { a.query.filters = [{ dimension: 'channel', values: ['Direct'] }]; }, a => { a.source_id = 'invented'; }, a => { a.sql = 'SELECT *'; }, a => { a.query.dimensions = []; }]) {
    const response = structuredClone(plan(q)); alter(response.args); const p = ports(model(choose(q)), model(response));
    const s = await new ReportSession(p).submit('By channel'); assert.equal(s.state, 'failed'); assert(!p.calls.includes('execute_query'));
  }
});
test('host rejects unverified, partial, extra/raw, duplicate, invalid ratio and stale results', async () => {
  for (const kind of ['unverified', 'partial', 'raw', 'duplicate', 'ratio', 'stale', 'null_ratio', 'bad_bucket']) {
    const p = ports(), exec = p.execute, verify = p.verify;
    p.execute = async x => { const e = await exec(x);
      if (kind === 'raw') e.result.rows[0].email = 'private@example.invalid';
      if (kind === 'duplicate') e.result.rows.push(e.result.rows[0]);
      if (kind === 'ratio') e.result.rows[0].refund_ratio = .9;
      if (kind === 'null_ratio') e.result.rows[0].refund_ratio = null;
      if (kind === 'bad_bucket') e.result.rows[0].period = '2024-01-02';
      if (kind === 'stale') e.plan_digest = 'wrong'; return e; };
    p.verify = async x => { const receipt = await verify(x); return { ...receipt, verified: kind !== 'unverified', complete: kind !== 'partial' }; };
    const s = await new ReportSession(p).submit('Country revenue'); assert.equal(s.state, 'failed', kind); assert(!s.report);
  }
});
test('authorization is checked before execution and issue; registry change prevents report issuance', async () => {
  for (const phase of ['plan', 'execute', 'issue_report']) {
    const p = ports(); p.authorize = async x => x.phase !== phase;
    const s = await new ReportSession(p).submit('Revenue'); assert.equal(s.state, 'failed'); assert.equal(s.reason, 'authorization_denied'); assert(!s.report);
    if (phase !== 'issue_report') assert(!p.calls.includes('execute_query'));
  }
  const p = ports(); let reads = 0; p.loadRegistry = async () => { const r = catalog(); if (++reads > 2) r.revision = digest('new'); return r; };
  const s = await new ReportSession(p).submit('Revenue'); assert.equal(s.reason, 'source_changed'); assert(!s.report);
});
test('cancellation rejects late output and prevents overlap while an uncooperative query is pending', async () => {
  const p = ports(); let resolve, started; const pending = new Promise(r => { started = r; });
  const exec = p.execute; p.execute = async x => { started(); await new Promise(r => { resolve = r; }); return exec(x); };
  const h = new ReportSession(p), run = h.submit('Revenue'); await pending; h.cancel();
  assert.equal((await run).state, 'cancelled'); await assert.rejects(h.submit('Next'));
  resolve(); await new Promise(r => setTimeout(r, 0)); assert.equal(h.snapshot().state, 'cancelled'); assert(!h.snapshot().report);
});
test('unit admission keeps request and source compatibility independently testable', () => {
  const r = registry(catalog()), q = query(['channel']); assert.equal(covers(r.sources[0], q), false); assert.equal(covers(r.sources[1], q), true);
  assert.equal(admitDecision(choose()).route, 'cube'); assert.equal(admitWorker(admitDecision(plan(q), true), q, r).kind, 'semantic');
  assert.throws(() => registry({ ...catalog(), sql: 'SELECT' }));
});
test('ratio-only report cannot advertise additive roll-up; valid empty intersections remain explicit', async () => {
  const q = { ...query(), measures: ['refund_ratio'] }, p = ports(model(choose(q)));
  const s = await new ReportSession(p).submit('Refund ratio'); assert.equal(s.state, 'completed'); assert.equal(s.report.capabilities.measures[0].rollup, false);
  const empty = query(); empty.filters = [{ dimension: 'country', values: ['No match'] }];
  const e = await new ReportSession(ports(model(choose(empty)))).submit('Empty scope'); assert.equal(e.state, 'completed'); assert.equal(e.report.capabilities.empty, true); assert.deepEqual(e.report.payload.rows, []);
});
test('repeated clarifications stop at the per-component budget without executing queries', async () => {
  const p = ports(model(clarify(false), clarify(false), clarify(false), choose())), h = new ReportSession(p);
  let s = await h.submit('Ambiguous');
  for (let i = 0; i < 3; i++) s = await h.answer(s.question_id, 'Still ambiguous');
  assert.equal(s.state, 'failed'); assert.equal(p.planner.calls.length, 3); assert(!p.calls.includes('execute_query'));
});
test('cancel while waiting removes the question; a closed host cannot resume or submit', async () => {
  const p = ports(model(clarify(false))), h = new ReportSession(p), waiting = await h.submit('Question');
  h.cancel(); assert.equal(h.snapshot().state, 'cancelled'); assert(!h.snapshot().question_id);
  await assert.rejects(h.answer(waiting.question_id, 'Answer'));
  h.close(); await assert.rejects(h.submit('Another question')); assert(!p.calls.includes('execute_query'));
});
