import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerSession } from '../../harnesses/worker.mjs';
import { evidenceCase, period } from '../../eval/data-validation.mjs';
import { stepsFor, testEnvironment } from '../check.mjs';

function fixture({ clarify = false, status, treatment = 'valid', tamper = false, revisionJump = false } = {}) {
  const item = evidenceCase(treatment), calls = []; let revision = 0;
  const worker = new WorkerSession({ async call(name, args) {
    calls.push({ name, args });
    if (name === 'open_session') return { session_id: 'service-session', revision: 0 };
    if (name === 'close_session') return { status: 'closed' };
    if (name === 'get_evidence') return { result: tamper ? { ...item.result, rows: [] } : item.result, evidence: item.evidence };
    assert.equal(args.request.session_id, 'service-session');
    assert.equal(args.request.expected_revision, revision);
    if (status) return { status, reason: 'fixture_failure' };
    revision += revisionJump ? 2 : 1;
    if (clarify && name === 'ask_data') return { status: 'needs_clarification', revision,
      continuation_ref: 'service-continuation', question: 'Which metric and period?' };
    return { status: 'completed', revision, result_ref: `result-${revision}`, evidence_ref: `evidence-${revision}`, result: item.result };
  } });
  return { worker, calls };
}
const task = { capability: 'analytics', question: 'Weekly revenue for the explicit UTC range.', grain: 'week', period };

test('worker contract: query, evidence, known-result follow-up, and closure use service-owned identity', async () => {
  const { worker, calls } = fixture();
  try {
    const first = await worker.execute(task);
    assert.equal(first.validation.status, 'verified');
    await assert.rejects(worker.execute({ ...task, reply_to: 'unknown-result' }));
    const next = await worker.execute({ ...task, reply_to: first.response.result_ref });
    assert.equal(next.response.revision, 2);
    const asks = calls.filter(c => c.name === 'ask_data');
    assert.equal(asks.length, 2);
    assert.notEqual(asks[0].args.request.request_id, asks[1].args.request.request_id);
    assert.equal(asks[1].args.request.reply_to, 'result-1');
    assert.deepEqual(Object.keys(asks[0].args.request).sort(), ['capability', 'expected_revision', 'question', 'request_id', 'session_id']);
  } finally { await worker.close(); }
  assert.equal(calls.at(-1).name, 'close_session');
  await assert.rejects(worker.execute(task));
});
test('worker contract: only the pending host question can resume a service continuation', async () => {
  const { worker, calls } = fixture({ clarify: true });
  try {
    const pending = await worker.execute(task);
    assert.notEqual(pending.question_id, 'service-continuation');
    await assert.rejects(worker.execute({ question_id: 'wrong', answer: 'Revenue' }));
    await assert.rejects(worker.execute(task));
    const completed = await worker.execute({ question_id: pending.question_id, answer: 'Revenue for the stated period' });
    assert.equal(completed.validation.status, 'verified');
    const request = calls.find(c => c.name === 'continue_task').args.request;
    assert.equal(request.expected_revision, 1);
    assert.equal(request.continuation_ref, 'service-continuation');
    assert.equal(request.answer, 'Revenue for the stated period');
    assert.equal(request.reply_to, undefined);
  } finally { await worker.close(); }
});
for (const status of ['denied', 'unavailable', 'failed']) test(`worker contract: ${status} never supplies a successful result`, async () => {
  const { worker, calls } = fixture({ status });
  try {
    assert.deepEqual(await worker.execute(task), { response: { status, reason: 'fixture_failure' } });
    assert.equal(calls.some(c => c.name === 'get_evidence'), false);
  } finally { await worker.close(); }
});
for (const [treatment, expected] of [['valid', 'verified'], ['missing-period', 'unverified'], ['wrong-period', 'rejected']]) {
  test(`worker contract: execution and ${expected} data remain separate`, async () => {
    const { worker } = fixture({ treatment });
    try { const value = await worker.execute(task); assert.equal(value.response.status, 'completed'); assert.equal(value.validation.status, expected); }
    finally { await worker.close(); }
  });
}
for (const options of [{ tamper: true }, { revisionJump: true }]) test(`worker contract rejects ${JSON.stringify(options)}`, async () => {
  const { worker } = fixture(options);
  try { await assert.rejects(worker.execute(task)); } finally { await worker.close(); }
});
test('handoff gates select only scripted worker entry and drop provider credentials', async () => {
  const steps = await stepsFor('worker-service', '/tmp/new-handoff-run', '/tmp/worker.json');
  assert.deepEqual(steps, [[process.execPath, ['eval/run.mjs', 'data-worker', '/tmp/new-handoff-run/worker', '/tmp/worker.json']]]);
  assert.deepEqual(testEnvironment({ PATH: '/bin', HOME: '/tmp/test', ANTHROPIC_API_KEY: 'secret', NVIDIA_INFERENCE_API_KEY: 'secret', NODE_OPTIONS: '--import=bad', HTTPS_PROXY: 'bad' }), { PATH: '/bin', HOME: '/tmp/test' });
  await assert.rejects(stepsFor('worker-service', '/tmp/run'));
  await assert.rejects(stepsFor('live', '/tmp/run'));
  await assert.rejects(stepsFor('offline', '/tmp/run', '/tmp/config'));
});
