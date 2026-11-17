import { mkdir, readFile, writeFile, open, rename, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { cases, schedule as scenarioSchedule } from '../eval/scenarios.mjs';
import { briefs } from '../eval/scenarios.mjs';
import { fixturePayload, projectFixture } from './fixture.mjs';
import { verifyFiles } from '../eval/files.mjs';
import { sourceHashes } from '../eval/files.mjs';
import { scoreData } from '../eval/scoring.mjs';
import { digest, immutable, requireThat } from '../contracts.mjs';
import { fixturePolicy } from './policy.mjs';
import { repairCodes } from './cloud.mjs';
import { liveHost } from './runtime.mjs';
import { uiCommand } from './tui.mjs';
import { checkWorkerEnvironment } from '../eval/worker-service.mjs';

const modeMap = { private_only: 'private-only', fixed_claude: 'fixed-cloud', adaptive: 'adaptive' };
export const protocol = immutable({ version: 1, repeats: 2, flows: 24, max_cloud_invocations: 32,
  max_wall_ms: 90 * 60_000, cases, briefs, planner: { max_tokens: 1536, timeout_ms: 45_000, thinking: 'off', retries: 0 },
  design: { max_tokens: 4096, timeout_ms: 90_000, max_repairs: 1, max_cli_budget_usd_per_invocation: 0.50 },
  private_design: 'inert private result table, no designer model',
  private_stages_shared: false, sample_policy: 'Every scheduled flow once. Preserve all failures. No replacement samples.',
  comparison: 'Independent host E2E across three routes with bounded repair. Historical comparisons are not a causal model or architecture ranking.' });
export const schedule = () => scenarioSchedule().flatMap(block => block.order.map(mode => ({ case: block.case, repeat: block.repeat, route: modeMap[mode] })));
const write = (path, value) => writeFile(path, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
async function append(path, value) { const fd = await open(path, 'a', 0o600); try { await fd.writeFile(JSON.stringify(value) + '\n'); await fd.sync(); } finally { await fd.close(); } }
export function verifyCloudRequest(body, task, caseId, attempt) {
  const prompt = JSON.parse(body.messages[0].content[0].text);
  requireThat(Object.keys(prompt).sort().join() === ['data_version', 'design_brief', 'export_id', 'payload'].sort().join()
    && digest(prompt.payload) === digest(fixturePayload) && prompt.data_version === digest(fixturePayload)
    && prompt.export_id === task.export.export_id && task.approvals.at(-1)?.approve === true
    && task.approvals.at(-1).request_digest === digest(task.export));
  const expected = briefs[caseId];
  requireThat(prompt.design_brief === expected || (attempt === 1 && prompt.design_brief.startsWith(`${expected}\nRepair checks: `)
    && prompt.design_brief.slice(`${expected}\nRepair checks: `.length).split(', ').every(x => repairCodes.includes(x))));
  requireThat(!JSON.stringify(prompt).includes('PRIVATE_BENCHMARK_CANARY'));
  return true;
}

export async function runLive(configPath, output) {
  const config = JSON.parse(await readFile(configPath, 'utf8')), out = resolve(output);
  requireThat(await verifyFiles(config.fixtureGrant));
  requireThat(config.planner.id === 'nvidia/nemotron-3.5-lightning-30b-a3b' && config.claude.model === 'claude-sonnet-5-5');
  requireThat(process.env[config.planner.credentialEnv] && process.env[config.claude.credentialEnv]);
  await mkdir(out, { mode: 0o700 });
  const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
  const report = { protocol, started_at: new Date().toISOString(), environment: await checkWorkerEnvironment(config.environment),
    source_before: await sourceHashes(root), flows: [], cloud_invocations: 0, error: null };
  await write(join(out, 'preregistered.json'), { protocol, config, schedule: schedule(), source: report.source_before });
  const save = async () => { await writeFile(join(out, 'report.tmp'), JSON.stringify(report, null, 2), { mode: 0o600 }); await rename(join(out, 'report.tmp'), join(out, 'report.json')); };
  const deadline = Date.now() + protocol.max_wall_ms;
  await save();
  for (const [index, entry] of schedule().entries()) {
    if (Date.now() > deadline) { report.error = 'run_deadline'; break; }
    const folder = join(out, `flow-${String(index + 1).padStart(2, '0')}`); await mkdir(folder, { mode: 0o700 });
    const record = { index: index + 1, case_id: entry.case.id, repeat: entry.repeat, route: entry.route,
      started_at: new Date().toISOString(), state: 'started', planner_calls: [], cloud_outputs: [], cloud_requests: 0, questions: [] };
    report.flows.push(record); await save(); console.log(JSON.stringify({ event: 'flow_start', index: record.index, case: record.case_id, route: record.route }));
    let host, previousPhase, monitor;
    const policy = { ...fixturePolicy(() => verifyFiles(config.fixtureGrant)), briefs: { default: briefs[entry.case.id] } };
    const started = performance.now();
    try {
      host = await liveHost(folder, config, { policy, observers: {
        plannerRequest: body => append(join(folder, 'planner-requests.jsonl'), body),
        plannerResult: async value => { record.planner_calls.push(value.call); await append(join(folder, 'planner-outputs.jsonl'), value); },
        cloudRequest: async ({ attempt, body }) => {
          verifyCloudRequest(body, host.snapshot().task, entry.case.id, attempt);
          if (!record.cloud_attempt_ids?.includes(attempt)) {
            record.cloud_attempt_ids ??= []; record.cloud_attempt_ids.push(attempt);
            requireThat(++report.cloud_invocations <= protocol.max_cloud_invocations);
          }
          record.cloud_requests++; await append(join(folder, 'cloud-requests.jsonl'), { attempt, body });
        },
        cloudResult: async value => { record.cloud_outputs.push({ attempt: value.attempt, usage: value.body.usage ?? null,
          cost_usd: value.body.total_cost_usd ?? null, duration_ms: value.body.duration_ms ?? null, success: value.body.subtype === 'success' });
          await append(join(folder, 'cloud-outputs.jsonl'), value); },
      } });
      monitor = setInterval(() => { const phase = host.snapshot().task?.state; if (phase !== previousPhase) {
        previousPhase = phase; console.log(JSON.stringify({ event: 'phase', index: record.index, phase })); } }, 2000);
      host.command({ id: randomUUID(), expected_revision: host.snapshot().revision, type: 'submit',
        payload: { message: entry.case.question, route: entry.route, plan_only: false } });
      await host.idle(); let answered = 0;
      for (;;) {
        const task = host.snapshot().task;
        if (task.state !== 'waiting') break;
        record.questions.push(task.pending);
        if (task.pending.source === 'export') {
          projectFixture({ ...task, state: 'completed' }, { requireDesignProposal: false });
          requireThat(digest(task.export.payload) === digest(fixturePayload) && task.export.design_brief === briefs[entry.case.id]);
          record.private_ms ??= Math.round(performance.now() - started);
          host.command(uiCommand(host.snapshot(), '/approve'));
        } else if (task.pending.source === 'planner' && answered < entry.case.human_answers.length) {
          host.command(uiCommand(host.snapshot(), entry.case.human_answers[answered++]));
        } else { record.error = 'unexpected_or_unanswered_clarification'; break; }
        await host.idle();
      }
      record.elapsed_ms = Math.round(performance.now() - started); record.private_ms ??= record.elapsed_ms;
      const task = host.snapshot().task; record.task = task; record.state = task.state;
      record.data_score = scoreData(task, { groups: 2, scalar: 770, weekly: [['2025-12-29', 50], ['2026-01-05', 220], ['2026-01-12', 500]] });
      record.data_score.evidence_verified = task.data_validation?.status === 'verified';
      record.data_score.passed &&= record.data_score.evidence_verified;
      record.route_correct = task.plans.at(-1)?.presentation === entry.case.expected_route;
      record.clarification_correct = record.questions.filter(q => q.source === 'planner').length === (entry.case.clarify ? 1 : 0)
        && !record.questions.some(q => q.source === 'wren');
      record.candidates = [];
      for (const attempt of task.attempts) {
        const candidate = JSON.parse(await readFile(attempt.artifact, 'utf8'));
        const qa = candidate.qa?.artifact_dir ? JSON.parse(await readFile(join(candidate.qa.artifact_dir, 'qa.json'), 'utf8')) : null;
        record.candidates.push({ ...candidate, raw_qa: qa });
      }
      record.cloud_cost_usd = record.cloud_outputs.length && record.cloud_outputs.every(x => Number.isFinite(x.cost_usd))
        ? record.cloud_outputs.reduce((sum, x) => sum + x.cost_usd, 0) : record.cloud_requests === 0 ? 0 : null;
      record.total_cost_usd = null;
    } catch (error) { record.state = 'runner_failed'; record.error = error.message; if (host) record.task = host.snapshot().task; }
    finally {
      clearInterval(monitor); record.elapsed_ms ??= Math.round(performance.now() - started);
      try { await host?.close(); } catch { record.cleanup_error = true; }
      record.worker_calls = [];
      for (const name of await readdir(folder)) if (/^audit-.*\.jsonl$/.test(name)) {
        record.worker_calls.push(...(await readFile(join(folder, name), 'utf8')).split('\n').filter(Boolean).map(x => JSON.parse(x)).filter(x => x.event === 'model_call'));
      }
      record.finished_at = new Date().toISOString(); await write(join(folder, 'result.json'), record); await save();
      console.log(JSON.stringify({ event: 'flow_done', index: record.index, state: record.state, reason: record.task?.reason,
        data: record.data_score?.passed, elapsed_ms: record.elapsed_ms, cloud_requests: record.cloud_requests }));
    }
  }
  report.finished_at = new Date().toISOString(); report.source_after = await sourceHashes(root);
  report.source_unchanged = digest(report.source_before) === digest(report.source_after);
  report.fixture_unchanged = await verifyFiles(config.fixtureGrant); await save();
  console.log(JSON.stringify({ event: 'benchmark_done', flows: report.flows.length, source_unchanged: report.source_unchanged, error: report.error }));
  if (report.error || report.flows.length !== 24 || !report.source_unchanged || !report.fixture_unchanged || report.flows.some(f => f.state !== 'completed' || !f.data_score?.passed)) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runLive(...process.argv.slice(2)).catch(() => { console.error('live_benchmark_configuration_failed'); process.exitCode = 1; });
