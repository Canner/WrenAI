import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { validatePayload, periodOptions, admitPlan, cloudBrief, createPlannerContract } from '../contracts.mjs';
import { PiPlanner, privateModel } from '../../host/pi.mjs';
import { runReplay } from '../run.mjs';
import { openReplay } from '../replay.mjs';
import { payload, proposal } from './fixture.mjs';

test('host derives complete calendar periods, handles year rollover and suppresses uncovered comparisons', () => {
  const windows = periodOptions(payload().coverage);
  assert.deepEqual(windows.latest_complete_quarter, { lower: '2024-04', upper_exclusive: '2024-07', timezone: 'UTC', prior_year_available: true });
  assert.equal(windows.full_coverage.prior_year_available, false);
  const partial = periodOptions({ lower: '2024-02', upper_exclusive: '2024-06' });
  assert(!partial.latest_complete_quarter); assert(!partial.latest_complete_half_year); assert(!partial.latest_six_months);
  assert.deepEqual([partial.latest_complete_month.lower, partial.latest_complete_month.upper_exclusive], ['2024-05', '2024-06']);
  assert.equal(periodOptions({ lower: '2023-01', upper_exclusive: '2024-01' }).latest_complete_quarter.lower, '2023-10');
  for (const lower of ['2024-13', '2024-00', '2024-1', '0000-01', '2025-01']) assert.throws(() => periodOptions({ lower, upper_exclusive: '2024-07' }));
});
test('model selects a period but cannot invent dates, missing comparisons or user confirmation', () => {
  const p = payload(), v = proposal(), accepted = admitPlan(v, p.coverage);
  assert.equal(accepted.period.lower, '2024-04'); assert.equal(accepted.period.basis, 'latest_complete_quarter');
  assert(!cloudBrief(accepted).includes('PRIVATE_REPLAY_CONTEXT'));
  for (const mutate of [x => x.period_choice = 'yesterday', x => x.period_choice = 'full_coverage',
    x => x.period = { lower: '2020-01' }, x => x.clarification = 'dashboard title', x => x.kpis.push('profit'),
    x => x.assumptions = [], x => x.primary_metric = 'yoy', x => x.primary_dimension = 'product']) {
    const bad = proposal(); mutate(bad.args); assert.throws(() => admitPlan(bad, p.coverage));
  }
  const question = proposal(); question.args.status = 'clarify'; question.args.clarification = 'Which business goal?';
  assert.deepEqual(admitPlan(question, p.coverage), { status: 'clarify', question: 'Which business goal?' });
  const full = proposal(); full.args.period_choice = 'full_coverage'; full.args.comparison = 'none';
  assert.equal(admitPlan(full, p.coverage).period.lower, '2023-01');
  full.args.analyses.push('change_contribution'); assert.throws(() => admitPlan(full, p.coverage));
});
test('replay shape rejects duplicates, unsafe integers, invalid coverage and unapproved dimensions', () => {
  assert.equal(validatePayload(payload()).rows.length, 72);
  for (const mutate of [p => p.rows.push(p.rows[0]), p => p.rows[0][3] = Number.MAX_SAFE_INTEGER,
    p => p.rows[0][0] = '2022-12', p => p.columns.push('email'), p => p.amount_scale = 0, p => p.synthetic = false,
    p => p.raw_records = [{ email: 'private-canary' }], p => p.definitions.sql = 'private query',
    p => p.default_period.lower = '2022-01']) {
    const p = payload(); mutate(p); assert.throws(() => validatePayload(p));
  }
});
test('real pi transport uses the injected compiled monthly planning tool', async () => {
  const requests = [], decision = proposal();
  const server = createServer(async (req, res) => {
    let body = ''; for await (const b of req) body += b; const value = JSON.parse(body); requests.push(value);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const chunk = (delta, finish_reason) => ({ id: 'offline', object: 'chat.completion.chunk', created: 1, model: value.model,
      choices: [{ index: 0, delta, finish_reason }] });
    res.end(`data: ${JSON.stringify(chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'plan', type: 'function',
      function: { name: decision.name, arguments: JSON.stringify(decision.args) } }] }, null))}\n\ndata: ${JSON.stringify(chunk({}, 'tool_calls'))}\n\ndata: [DONE]\n\n`);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const model = new PiPlanner({ model: privateModel({ id: 'nvidia/nemotron-fixture', baseUrl: `http://127.0.0.1:${server.address().port}/v1` }),
      apiKey: 'offline', decisionContract: createPlannerContract(payload().coverage) });
    const got = await model.decide({ conversation: [{ role: 'user', content: 'Show revenue health' }], capabilities: { windows: periodOptions(payload().coverage) }, metadata: {} });
    assert.equal(admitPlan(got, payload().coverage).period.lower, '2024-04');
    assert.equal(requests.length, 1); assert.deepEqual(requests[0].tools.map(t => t.function.name), ['plan_revenue_dashboard']);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});

test('formal coordinator admits, replays, authorizes and persists; clarification/changed evidence never calls designer', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'revenue-replay-'));
  const sha = s => createHash('sha256').update(s).digest('hex');
  const p = payload(), bytes = JSON.stringify(p), source = join(dir, 'source'), data = join(dir, 'payload.json'), grant = join(dir, 'grant.json');
  try {
    await writeFile(source, 'verified fixture'); await writeFile(data, bytes);
    await writeFile(grant, JSON.stringify({ version: 'verified-replay/1', payload_sha256: sha(bytes), verified_checks: { gross: true, refunds: true }, sources: [{ path: source, sha256: sha('verified fixture') }] }));
    const config = { question: 'Understand revenue health', cloud_authorized: true, planner: { id: 'scripted' }, claude: { model: 'scripted' }, replay: { payload: data, grant } };
    for (const mode of ['ready', 'clarify', 'changed']) {
      let cloudCalls = 0; const planner = { calls: [], async decide(input) {
        assert.equal(input.conversation[0].content, config.question); assert.equal(input.capabilities.windows.latest_complete_quarter.lower, '2024-04');
        if (mode === 'changed') await writeFile(source, 'changed');
        const proposed = proposal(); if (mode === 'clarify') Object.assign(proposed.args, { status: 'clarify', clarification: 'Which goal?' }); return proposed;
      } };
      const report = await runReplay(config, join(dir, mode), { planner,
        makeDesigner: () => ({ recipient: 'offline', async design(bundle, { beforeSend }) {
          await beforeSend(); cloudCalls++; assert.deepEqual(bundle.payload, p); assert(!bundle.design_brief.includes('PRIVATE_REPLAY_CONTEXT'));
          return { spec: { version: 1, export_id: bundle.export_id, data_version: bundle.data_version, html: '<main>Fixture</main>', css: 'main{color:black}', javascript: 'void 0;' }, cost_usd: 0 };
        } }), inspect: async () => ({ pass: true, warnings: [], repair_codes: [] }) });
      assert.equal(report.state, mode === 'ready' ? 'completed' : mode === 'clarify' ? 'waiting_for_user' : 'failed');
      assert.equal(cloudCalls, mode === 'ready' ? 1 : 0);
      assert.equal(JSON.parse(await readFile(join(dir, mode, 'report.json'))).state, report.state);
    }
    await assert.rejects(openReplay(config.replay));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
