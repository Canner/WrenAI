import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { cases } from '../eval/scenarios.mjs';
import { scoreData } from '../eval/scoring.mjs';
import { releaseFor, harnessIds } from '../harnesses/releases.mjs';
import { Store } from './store.mjs';
import { Host } from './controller.mjs';
import { artifactPorts } from './artifacts.mjs';
import { scriptedPorts } from './scripted.mjs';
import { scriptedWren } from './scripted-wren.mjs';
import { uiCommand } from './tui.mjs';

const [out, configFile, browser] = process.argv.slice(2);
if (!out || !configFile || (browser && browser !== '--browser')) throw Error('usage: node host/verify.mjs OUT WORKER_CONFIG [--browser]');
const directory = resolve(out); await mkdir(directory, { mode: 0o700 });
const service = await scriptedWren(JSON.parse(await readFile(configFile, 'utf8')), join(directory, 'service'));
const records = [];
try {
  for (const item of cases) for (const route of ['private-only', 'fixed-cloud', 'adaptive']) {
    const folder = join(directory, `${item.id}-${route}`), sent = [];
    await mkdir(folder, { mode: 0o700 });
    const ports = scriptedPorts({ observe: request => sent.push(request) });
    const host = new Host(new Store(join(folder, 'state')), { ...ports, worker: service.worker, policy: service.policy,
      ...artifactPorts(join(folder, 'artifacts')),
      ...(!browser ? { inspect: async () => ({ pass: true, repair_codes: [], scripted: true }) } : {}) });
    const started = performance.now();
    try {
      host.command({ id: randomUUID(), expected_revision: host.snapshot().revision, type: 'submit',
        payload: { message: item.question, route, plan_only: false } }); await host.idle();
      if (item.clarify) {
        assert.equal(host.snapshot().task.pending?.source, 'planner');
        host.command(uiCommand(host.snapshot(), item.human_answers[0])); await host.idle();
      }
      const cloud = route === 'fixed-cloud' || route === 'adaptive' && item.expected_route === 'dashboard_design';
      if (cloud) {
        assert.equal(host.snapshot().task.pending?.source, 'export'); assert.equal(sent.length, 0);
        host.command(uiCommand(host.snapshot(), '/approve')); await host.idle();
      }
      const task = host.snapshot().task;
      assert.equal(task.state, 'completed'); assert.equal(task.reason, cloud ? 'cloud_design' : 'private_route');
      const score = scoreData(task, { groups: 2, scalar: 770, weekly: [['2025-12-29', 50], ['2026-01-05', 220], ['2026-01-12', 500]] });
      assert.equal(score.passed, true); assert.equal(JSON.stringify(sent).includes('PRIVATE_'), false);
      const record = { case: item.id, route, passed: true, state: task.state, reason: task.reason, score,
        elapsed_ms: Math.round(performance.now() - started), cloud_attempts: sent.length, attempts: task.attempts,
        planner_calls: ports.planner.calls, tokens: null, cost_usd: null };
      records.push(record); console.log(JSON.stringify({ case: item.id, route, passed: true }));
      await writeFile(join(folder, 'result.json'), JSON.stringify(record, null, 2), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      await writeFile(join(folder, 'failure.json'), JSON.stringify({ message: error.message, state: host.snapshot() }), { flag: 'wx', mode: 0o600 });
      throw error;
    } finally { await host.close(); }
  }
} finally {
  await service.close();
  await writeFile(join(directory, 'summary.json'), JSON.stringify({ model_quality_measured: false, browser_qa: !!browser,
    paid_model_calls: 0, environment: service.environment, releases: harnessIds.map(id => releaseFor(id)),
    scheduled: 12, completed: records.length, records, worker_attempts: service.attempts }, null, 2), { flag: 'wx', mode: 0o600 });
}
