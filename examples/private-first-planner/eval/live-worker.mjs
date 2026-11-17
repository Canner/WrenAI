import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { connectWren } from '../worker/mcp.mjs';
import { retrievalQuestion } from '../worker/retrieval.mjs';
import { prepareServiceConfig } from '../host/runtime.mjs';
import { checkWorkerEnvironment } from './worker-service.mjs';
import { workerUnit } from './units.mjs';
import { scoreWorker } from './scorers.mjs';
import { runSuite } from './runner.mjs';
import { verifyFiles } from '../eval/files.mjs';
import { requireThat } from '../contracts.mjs';

// Deliberately excludes planner and cloud. Four independently opened sessions;
// all observations (including incomplete/unverified ones) remain in the cohort.
export async function runLiveWorker(configPath, directory) {
  const config = JSON.parse(await readFile(configPath, 'utf8')), out = resolve(directory);
  requireThat(!config.claude && await verifyFiles(config.fixtureGrant));
  const credential = process.env[config.wren.credentialEnv]; requireThat(credential?.length);
  const environment = await checkWorkerEnvironment(config.environment);
  const constraints = { period: { lower: '2026-01-01', upper: '2026-01-19', timezone: 'UTC' }, filters: [], requested_statuses: [] };
  const cases = ['scalar', 'week'].map(grain => ({ id: grain, input: { task: {
    capability: 'analytics', grain, period: constraints.period,
    question: retrievalQuestion({ grain, metric: 'Revenue using the project definition' }, constraints) } },
    expected: { status: 'completed', validation: 'verified', scalar: 770, weekly: [['2025-12-29', 50], ['2026-01-05', 220], ['2026-01-12', 500]] } }));
  const work = out + '-services'; await mkdir(work, { mode: 0o700 });
  await writeFile(join(work, 'preregistered.json'), JSON.stringify({ environment, config, cases, repeat: 2,
    sample_policy: 'No replacement; four independent worker sessions; no retries, planner or cloud calls.',
    runtime_unchanged: true, cost_usd: null }, null, 2), { flag: 'wx', mode: 0o600 });
  const binding = { mode: 'live', model: config.planner.id, deployment: 'existing-nvidia-hosted',
    runtime: `wren-${environment.wren}+pi-${environment.runtime}+node-${environment.node}`,
    parameters: { temperature: null, max_tokens: 8192, thinking: 'on' }, limits: { timeout_ms: 180_000, max_turns: 12 } };
  const createUnit = async options => {
    const folder = join(work, randomUUID()); const { args, serviceConfig } = await prepareServiceConfig(folder, config.wren);
    requireThat(serviceConfig.private_model.id === binding.model && serviceConfig.execution.max_tokens === 8192
      && serviceConfig.execution.max_turns === 12 && serviceConfig.execution.provider_max_retries === 0
      && serviceConfig.execution.deadline_ms === 120000 && serviceConfig.execution.thinking === 'on');
    let port, unit, closing;
    try {
      port = await connectWren({ ...config.wren, args }, { credential });
      unit = workerUnit({ ...options, port, collectAttempts: async () => {
        const lines = (await readFile(serviceConfig.audit_path, 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
        for (const call of lines.filter(x => x.event === 'model_call')) options.observeAttempt({
          status: call.status === 'ok' ? 'completed' : 'failed', elapsed_ms: call.elapsed_ms,
          input_tokens: call.input, output_tokens: call.output,
          cost_usd: null });
      } });
      return { traceRefs: [serviceConfig.audit_path], async run() {
        console.log(JSON.stringify({ event: 'worker_start', grain: options.input.task.grain }));
        const output = await unit.run();
        console.log(JSON.stringify({ event: 'worker_done', grain: options.input.task.grain,
          status: output.final.response.status, verification: output.final.validation?.status }));
        return output;
      }, close: () => closing ??= (async () => { try { await unit.close(); } finally { await port.close(); } })() };
    } catch (error) { await port?.close(); throw error; }
  };
  const result = await runSuite({ harnessId: 'data-worker', out, binding, cases, repeat: 2, createUnit,
    score: scoreWorker, scorerVersion: 'worker-values-evidence/2' });
  requireThat(await verifyFiles(config.fixtureGrant));
  console.log(JSON.stringify(result.summary, null, 2)); return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { summary } = await runLiveWorker(...process.argv.slice(2));
  if (summary.passed !== summary.scheduled) process.exitCode = 1;
}
