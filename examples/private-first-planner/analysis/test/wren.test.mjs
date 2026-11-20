import test from 'node:test';
import assert from 'node:assert/strict';
import { WrenReportExecutor } from '../../host/report-wren.mjs';
import { ReportSession } from '../../host/report.mjs';
import { ports, model, choose, plan, query, result } from './fixture.mjs';

function wrenPort(q, { clarification = false, mismatch = false } = {}) {
  const calls = []; let revision = 0;
  return { calls, async call(name, args, options) {
    calls.push({ name, args, options });
    if (name === 'open_session') { revision = 0; return { session_id: 'session', revision: 0 }; }
    if (name === 'close_session') return { status: 'closed' };
    if (name === 'get_evidence') return { result: mismatch ? { ...result(q), rows: [] } : result(q), evidence: { private_sql: 'PRIVATE_SQL', complete: true } };
    assert(['ask_data', 'continue_task'].includes(name));
    assert.equal(args.request.expected_revision, revision);
    if (clarification && name === 'ask_data') return { status: 'needs_clarification', question: 'Which status scope?', continuation_ref: 'continuation', revision: ++revision };
    if (name === 'continue_task') assert.equal(args.request.continuation_ref, 'continuation');
    return { status: 'completed', revision: ++revision, result: result(q), result_ref: 'result-1', evidence_ref: 'evidence-1' };
  } };
}
test('host report flow executes via existing Wren tool envelope and validates fetched evidence', async () => {
  const q = query(['channel']), port = wrenPort(q), executor = new WrenReportExecutor(port);
  const p = ports(model(choose(q)), model(plan(q))); p.execute = x => executor.execute(x);
  try {
    const state = await new ReportSession(p).submit('Revenue by channel'); assert.equal(state.state, 'completed');
    assert.deepEqual(port.calls.map(x => x.name), ['open_session', 'ask_data', 'get_evidence']);
    const request = port.calls[1].args.request; assert.equal(request.capability, 'analytics');
    assert(request.question.includes('sales_semantics')); assert(request.question.includes('Private source binding:')); assert(request.question.includes('PRIVATE_MODEL')); assert(request.question.includes('host keys c1, c2')); assert(request.question.includes('Return only the successful evidence token'));
    assert(request.question.includes('GROUP BY the exact date bucket expression'));
    assert(!JSON.stringify(state.report).includes('PRIVATE_'));
  } finally { await executor.close(); }
  assert.equal(port.calls.at(-1).name, 'close_session');
});
test('Wren clarification resumes exactly its continuation and revision, without replanning or new ask_data', async () => {
  const q = query(['channel']), port = wrenPort(q, { clarification: true }), executor = new WrenReportExecutor(port);
  const p = ports(model(choose(q)), model(plan(q))); p.execute = x => executor.execute(x); p.continueExecution = x => executor.continueExecution(x);
  const host = new ReportSession(p);
  try {
    const waiting = await host.submit('Revenue'); assert.equal(waiting.state, 'waiting_for_user'); assert.equal(waiting.source, 'execution');
    const final = await host.answer(waiting.question_id, 'Use declared defaults'); assert.equal(final.state, 'completed');
    assert.equal(p.planner.calls.length, 1); assert.equal(p.worker.calls.length, 1);
    assert.deepEqual(port.calls.map(x => x.name), ['open_session', 'ask_data', 'continue_task', 'get_evidence']);
  } finally { await executor.close(); }
});
test('evidence result substitution cannot issue a report', async () => {
  const q = query(), port = wrenPort(q, { mismatch: true }), executor = new WrenReportExecutor(port);
  const p = ports(); p.execute = x => executor.execute(x);
  try { assert.equal((await new ReportSession(p).submit('Revenue')).state, 'failed'); }
  finally { await executor.close(); }
});

test('independent report requests isolate previous tables while clarification retains its session', async () => {
  const q = query(['channel']), port = wrenPort(q, { clarification: true });
  const executor = new WrenReportExecutor(port, { isolateReports: true });
  try {
    for (let i = 0; i < 2; i++) {
      const p = ports(model(choose(q)), model(plan(q))); p.execute = x => executor.execute(x); p.continueExecution = x => executor.continueExecution(x);
      const host = new ReportSession(p), waiting = await host.submit('Revenue');
      assert.equal(waiting.state, 'waiting_for_user');
      assert.equal((await host.answer(waiting.question_id, 'Use declared defaults')).state, 'completed');
      host.close();
    }
    assert.deepEqual(port.calls.map(x => x.name), ['open_session', 'ask_data', 'continue_task', 'get_evidence',
      'close_session', 'open_session', 'ask_data', 'continue_task', 'get_evidence']);
    assert.deepEqual(port.calls.filter(x => x.name === 'ask_data').map(x => x.args.request.expected_revision), [0, 0]);
  } finally { await executor.close(); }
});
