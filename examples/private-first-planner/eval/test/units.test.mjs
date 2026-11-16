import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, cp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSuite } from '../runner.mjs';
import { scriptedPlanner, scriptedCloud, scriptedBinding } from '../scripted.mjs';
import { plannerCases, cloudCases } from '../cases.mjs';
import { scorePlanner, scoreCloud, scoreWorker, scorerVersion } from '../scorers.mjs';
import { releaseFor, admitBinding } from '../../harnesses/releases.mjs';
import { WorkerSession } from '../../harnesses/worker.mjs';
import { fileURLToPath } from 'node:url';
import { sourceHashes, sha256 } from '../../behaviors/artifact.mjs';
const temp = () => mkdtemp(join(tmpdir(), 'harness-unit-'));
async function run(harnessId, cases, createUnit, score, extra = {}) {
  return runSuite({ harnessId, cases, createUnit, score, scorerVersion,
    binding: scriptedBinding, out: join(await temp(), 'run'), ...extra });
}

test('planner uses production transport/parser, never calls Wren/cloud, and oracle stays outside requests', async () => {
  const requests = [], oldFetch = globalThis.fetch;
  globalThis.fetch = () => { throw Error('unexpected network'); };
  try {
    const cases = structuredClone(plannerCases); cases[0].expected.secretOracle = 'HIDDEN_ORACLE_CANARY';
    const result = await run('private-planner', cases,
      o => scriptedPlanner(o, { observeRequest: b => requests.push(b) }), scorePlanner);
    assert.equal(result.summary.passed, 6); assert.equal(result.summary.model_quality_measured, false);
    assert.equal(result.records[1].attempts.length, 2);
    assert.equal(result.records[4].state, 'failed'); assert.equal(result.records[4].attempts.length, 1);
    assert.equal(result.records[5].resources.input_tokens, null);
    assert.equal(JSON.stringify(requests).includes('HIDDEN_ORACLE_CANARY'), false);
    for (const request of requests) assert.deepEqual(request.tools.map(t => t.function.name), ['resolve_intent']);
  } finally { globalThis.fetch = oldFetch; }
});

test('cloud unit preserves fixture grant, recipient, revocation and code admission without upstream models', async () => {
  const requests = [], oldFetch = globalThis.fetch;
  globalThis.fetch = () => { throw Error('unexpected network'); };
  try {
    const result = await run('cloud-planner', cloudCases,
      o => scriptedCloud(o, { observeRequest: b => requests.push(b) }), scoreCloud);
    assert.equal(result.summary.passed, 5);
    assert.equal(result.records[1].attempts.length, 0);
    assert.equal(result.records[0].output.quality_measured, false);
    assert.equal(result.records[0].resources.cost_usd, null);
    for (const request of requests) assert.deepEqual(Object.keys(request).sort(), ['data_version','design_brief','export_id','payload']);
    assert.doesNotMatch(JSON.stringify(requests), /PRIVATE_LABEL|evidence_ref|session_id|SELECT |raw_orders/);
  } finally { globalThis.fetch = oldFetch; }
});

test('planner scorer detects a validly shaped but wrong period or unwanted clarification', async () => {
  const result = await run('private-planner', [plannerCases[0]], scriptedPlanner, scorePlanner);
  const bad = structuredClone(result.records[0]); bad.output.final.args.constraints.period.upper = '2026-01-20';
  assert.equal(scorePlanner(bad, plannerCases[0].expected).passed, false);
  bad.output.final = { name: 'clarify_intent', args: { question: 'Again?' } };
  assert.equal(scorePlanner(bad, plannerCases[0].expected).passed, false);
});

test('reports preserve every repeat, known usage, unknown costs and exclusive output directories', async () => {
  const out = join(await temp(), 'run');
  const result = await run('private-planner', [plannerCases[0]], scriptedPlanner, scorePlanner, { out, repeat: 2 });
  assert.equal(result.records.length, 2);
  assert.notEqual(result.records[0].run_id, result.records[1].run_id);
  assert.equal(result.records[0].resources.input_tokens, 20);
  assert.equal((await stat(join(out, 'manifest.json'))).mode & 0o777, 0o600);
  const before = await readFile(join(out, 'manifest.json'), 'utf8');
  await assert.rejects(run('private-planner', [plannerCases[0]], scriptedPlanner, scorePlanner, { out }));
  assert.equal(await readFile(join(out, 'manifest.json'), 'utf8'), before);
});

test('release mismatch and secret-bearing bindings refuse before a model is created', async () => {
  let calls = 0;
  await assert.rejects(run('private-planner', [plannerCases[0]], () => { calls++; }, scorePlanner, { expectedRelease: 'wrong' }));
  assert.equal(calls, 0);
  assert.throws(() => admitBinding({ ...scriptedBinding, apiKey: 'secret' }));
  assert.throws(() => admitBinding({ ...scriptedBinding, model: 'https://host/?token=secret' }));
  assert.notEqual(releaseFor('private-planner').release_id, releaseFor('cloud-planner').release_id);
});

test('failed setup produces a failed record for every scheduled sample', async () => {
  const result = await run('private-planner', plannerCases.slice(0, 2), async () => { throw Error('private diagnostic'); }, scorePlanner);
  assert.equal(result.records.length, 2); assert.equal(result.summary.passed, 0);
  assert.equal(result.records[0].error, 'unit_failed');
  assert.equal(JSON.stringify(result).includes('private diagnostic'), false);
});

test('deadline aborts an active unit and awaits cleanup without publishing late output', async () => {
  let closed = false, aborted = false;
  const result = await run('private-planner', [plannerCases[0]], ({ signal }) => ({
    run: () => new Promise((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(Error('eval_deadline')); }, { once: true })),
    close: async () => { closed = true; },
  }), scorePlanner, { binding: { ...scriptedBinding, limits: { timeout_ms: 20, max_turns: 1 } } });
  assert.equal(aborted, true); assert.equal(closed, true);
  assert.equal(result.records[0].state, 'failed'); assert.equal(result.records[0].output, null);
});

test('cleanup failure cannot pass a successful quality scorer', async () => {
  const result = await run('private-planner', [plannerCases[0]], () => ({ run: async () => ({}), close: async () => { throw Error('closed badly'); } }),
    () => ({ passed: true }));
  assert.equal(result.summary.passed, 0); assert.equal(result.records[0].cleanup_error, true);
});

function port({ mismatch = false } = {}) {
  let revision = 0; const calls = [];
  const result = { kind: 'table', timezone: 'UTC', columns: [{ key: 'x' }], rows: [{ x: 770 }] };
  return { calls, async call(name, args) {
    calls.push({ name, args });
    if (name === 'open_session') return { session_id: 'owned', revision };
    if (name === 'close_session') return { status: 'closed' };
    if (name === 'get_evidence') return { result: mismatch ? { ...result, rows: [{ x: 999 }] } : result,
      evidence: { checks_summary: 'all_satisfied', checks: { scope: { applicable: true, result: 'satisfied' } }, unverified: [], applied_period: { lower: '2026-01-01', upper: '2026-01-19', lower_inclusive: true, upper_inclusive: false } } };
    assert.equal(args.request.expected_revision, revision);
    revision++;
    if (name === 'ask_data') return { status: 'needs_clarification', question: 'Which metric?', continuation_ref: 'opaque', revision };
    assert.equal(args.request.continuation_ref, 'opaque');
    return { status: 'completed', revision, result_ref: 'r', evidence_ref: 'e', result };
  } };
}
test('worker isolated entry preserves revision and opaque continuation; wrong answer ID never reaches Wren', async () => {
  const p = port(), session = new WorkerSession(p);
  const wait = await session.execute({ capability: 'analytics', grain: 'scalar', period: { lower: '2026-01-01', upper: '2026-01-19', timezone: 'UTC' }, question: 'Revenue?' });
  const before = p.calls.length;
  await assert.rejects(session.execute({ question_id: 'forged', answer: 'Revenue' }));
  assert.equal(p.calls.length, before);
  const result = await session.execute({ question_id: wait.question_id, answer: 'Revenue' });
  assert.equal(result.response.result.rows[0].x, 770);
  assert.equal(scoreWorker({ state: 'completed', output: { final: result, turns: [wait, result] } }, { status: 'completed', scalar: 770, clarification: true }).passed, true);
  await session.close();
  await assert.rejects(session.execute({ capability: 'analytics', grain: 'scalar', period: { lower: '2026-01-01', upper: '2026-01-19', timezone: 'UTC' }, question: 'Revenue?' }));
  assert.equal(p.calls.some(c => c.name === 'run_sql'), false);
});

test('worker evidence mismatch is rejected instead of scored as a result', async () => {
  const p = port({ mismatch: true }), session = new WorkerSession(p);
  const wait = await session.execute({ capability: 'analytics', grain: 'scalar', period: { lower: '2026-01-01', upper: '2026-01-19', timezone: 'UTC' }, question: 'Revenue?' });
  await assert.rejects(session.execute({ question_id: wait.question_id, answer: 'Revenue' }));
  await session.close();
});

test('browser QA is a separate quality result, not implied by code admission', async () => {
  const result = await run('cloud-planner', [cloudCases[0]], o => scriptedCloud(o, { inspect: async () => ({ passed: false, font: false }) }), scoreCloud);
  assert.equal(result.records[0].output.state, 'generated');
  assert.equal(result.records[0].output.quality_measured, true);
  assert.equal(result.summary.passed, 0);
});

test('a cloud prompt release can change without changing the planner or worker pin', async () => {
  const sourceRoot = join(await temp(), 'source');
  await cp(fileURLToPath(new URL('../../', import.meta.url)), sourceRoot, { recursive: true,
    filter: path => !path.split('/').some(p => ['node_modules', '__pycache__'].includes(p)) });
  const before = Object.fromEntries(['private-planner', 'data-worker', 'cloud-planner'].map(id => [id, releaseFor(id, { sourceRoot }).release_id]));
  const behaviorRoot = join(sourceRoot, 'behaviors');
  const prompt = join(behaviorRoot, 'profile/components/design_free_dashboard/respond.md');
  await writeFile(prompt, await readFile(prompt, 'utf8') + '\nCandidate typography instructions.\n');
  const irFile = join(behaviorRoot, 'compiled/ir.json'), ir = JSON.parse(await readFile(irFile, 'utf8'));
  const component = ir.components.find(c => c.id === 'design_free_dashboard');
  component.llm_calls[0].prompt += '\nCandidate typography instructions.\n';
  component.prompt_fragment = `## respond\n\n${component.llm_calls[0].prompt}`;
  const bytes = JSON.stringify(ir); await writeFile(irFile, bytes);
  const manifestFile = join(behaviorRoot, 'compiled/manifest.json'), manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  manifest.ir_sha256 = sha256(bytes); manifest.sources = sourceHashes(join(behaviorRoot, 'profile'));
  await writeFile(manifestFile, JSON.stringify(manifest));
  assert.equal(releaseFor('private-planner', { sourceRoot }).release_id, before['private-planner']);
  assert.equal(releaseFor('data-worker', { sourceRoot }).release_id, before['data-worker']);
  assert.notEqual(releaseFor('cloud-planner', { sourceRoot }).release_id, before['cloud-planner']);
});

test('late factory completion is closed after timeout and cannot mutate the saved record', async () => {
  let closed = false;
  const result = await run('private-planner', [plannerCases[0]], async ({ observeAttempt }) => {
    await new Promise(resolve => setTimeout(resolve, 40));
    return { run: async () => { throw Error('must not run'); }, close: async () => {
      closed = true; observeAttempt({ status: 'completed', input_tokens: 999 });
    } };
  }, scorePlanner, { binding: { ...scriptedBinding, limits: { max_turns: 1, timeout_ms: 10 } } });
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(closed, true); assert.equal(result.records[0].attempts.length, 0);
  assert.equal(result.records[0].attempts_complete, false);
});

test('cancelling while Wren opens a session closes the late session and makes no query', async () => {
  let finishOpen; const calls = [];
  const p = { async call(name) {
    calls.push(name);
    if (name === 'open_session') return new Promise(resolve => { finishOpen = resolve; });
    if (name === 'close_session') return { status: 'closed' };
    throw Error('must not query');
  } };
  const session = new WorkerSession(p);
  const pending = session.execute({ capability: 'analytics', question: 'Revenue', grain: 'scalar' });
  await session.close(); finishOpen({ session_id: 'late', revision: 0 });
  await assert.rejects(pending);
  assert.deepEqual(calls, ['open_session', 'close_session']);
});

test('an omitted provider temperature is recorded as unknown/default, never invented as zero', () => {
  assert.equal(admitBinding({ ...scriptedBinding, parameters: { ...scriptedBinding.parameters, temperature: null } }).parameters.temperature, null);
});
