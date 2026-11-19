import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { digest, requireThat } from '../contracts.mjs';
import { PiPlanner, privateModel } from '../host/pi.mjs';
import { ExportBroker } from '../host/export.mjs';
import { designWithRepair } from '../host/cloud.mjs';
import { ClaudeCode, maxSseBytes } from '../design/claude.mjs';
import { codeSchema } from '../design/contracts.mjs';
import { runQA } from '../design/qa-process.mjs';
import { createPlannerContract, admitPlan, periodOptions, cloudBrief } from './contracts.mjs';
import { artifact } from './behaviors/index.mjs';
import { openReplay } from './replay.mjs';

export const protocol = Object.freeze({ version: 'revenue-replay-run/2', planner_max_tokens: 4096,
  planner_timeout_ms: 120000, planner_attempts: 1, cloud_max_output_tokens: 12288,
  cloud_max_repairs: 1, cloud_cli_budget_usd: 0.50, max_sse_bytes: maxSseBytes,
  data_worker: 'verified_aggregate_replay', sample_policy: 'Preserve all failures; no replacement samples.' });

export async function runReplay(config, directory, { planner, makeDesigner, inspect, signal = new AbortController().signal } = {}) {
  requireThat(typeof config.question === 'string' && config.question.trim().length > 0 && config.question.length <= 4096
    && config.cloud_authorized === true);
  const out = resolve(directory); await mkdir(out, { mode: 0o700 });
  const write = (name, value) => writeFile(join(out, name), JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
  const start = performance.now(), started_at = new Date().toISOString();
  const report = { protocol, mode: planner ? 'scripted' : 'live', started_at, state: 'started',
    planner_calls: [], attempts: [], cloud_requests: 0, cloud_results: [], audit: [] };
  const saveReport = () => writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  let requestCount = 0, resultCount = 0, qaIndex = 0, saveIndex = 0;
  try {
    const replay = await openReplay(config.replay), p = replay.payload;
    const decisionContract = createPlannerContract(p.coverage);
    report.data_version = digest(p); report.evidence = replay.evidence;
    await write('preregistered.json', { protocol, question: config.question, model: config.planner,
      cloud: config.claude, data_version: report.data_version, behavior: artifact.provenance,
      revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: new URL('../', import.meta.url), encoding: 'utf8' }).trim(), started_at });
    planner ??= new PiPlanner({ model: privateModel(config.planner), apiKey: process.env[config.planner.credentialEnv],
      maxTokens: protocol.planner_max_tokens, timeoutMs: protocol.planner_timeout_ms, decisionContract,
      observeRequest: value => write('planner-request.json', value), observeResult: value => write('planner-response.json', value) });
    const planStart = performance.now();
    const proposed = await planner.decide({ signal, timeoutMs: protocol.planner_timeout_ms,
      conversation: [{ role: 'user', content: config.question }],
      capabilities: { id: 'replay_monthly_revenue', windows: periodOptions(p.coverage), grain: 'month', dimensions: ['country', 'channel'],
        metrics: ['net', 'gross', 'refunds', 'refund_ratio', 'yoy'] },
      metadata: { synthetic: true, currency: 'USD', timezone: 'UTC', coverage: p.coverage, definitions: p.definitions,
        unavailable: ['profit', 'order counts', 'product allocation', 'causal explanations'], private_marker: 'PRIVATE_REPLAY_CONTEXT' } });
    report.planner_ms = Math.round(performance.now() - planStart); report.planner_calls = planner.calls ?? [];
    await write('planner-proposal.json', proposed);
    const plan = admitPlan(proposed, p.coverage); report.plan = plan; await write('plan.json', plan);
    if (plan.status === 'clarify') { report.state = 'waiting_for_user'; return report; }
    const brief = cloudBrief(plan); await write('replay-evidence.json', replay.evidence);
    const designOptions = { apiKey: process.env[config.claude.credentialEnv] };
    const recipient = makeDesigner ? makeDesigner({ attempt: 0, preview: true }).recipient : new ClaudeCode(config.claude, designOptions).recipient;
    const broker = new ExportBroker({ policy: { id: 'monthly-revenue-replay', version: '1', briefs: { default: brief }, project: replay.read },
      current: async () => null, epoch: 'revenue-replay/1', audit: async value => report.audit.push(value) });
    const bundle = await broker.propose({ recipient, brief_id: 'default' });
    // This grant originates in explicit operator configuration, never model output.
    broker.approve(bundle.export_id, digest(bundle)); await write('approved-export.json', bundle);
    const result = await designWithRepair({ broker, signal, timeoutMs: 120000,
      makeDesigner: options => makeDesigner ? makeDesigner(options) : new ClaudeCode(config.claude, { ...designOptions,
        contract: { systemPrompt: artifact.components.design_revenue_dashboard.prompt + (options.attempt
          ? `\n${artifact.components.repair_revenue_dashboard.prompt}\nHost categories: ${options.diagnostics.join(',')}` : ''),
          schema: codeSchema, maxOutputTokens: protocol.cloud_max_output_tokens, brief },
        observeRequest: async value => {
          const sent = JSON.parse(value.messages[0].content[0].text);
          requireThat(digest(sent.payload) === report.data_version && sent.design_brief === brief
            && !JSON.stringify(value).includes('PRIVATE_REPLAY_CONTEXT'));
          await write(`cloud-request-${requestCount++}.json`, value); report.cloud_requests = requestCount;
        },
        observeResult: async value => { await write(`cloud-response-${resultCount++}.json`, value);
          report.cloud_results.push({ cost_usd: value.total_cost_usd ?? null, usage: value.usage ?? null, status: value.subtype }); },
      }),
      inspect: async (generated, control) => {
        const folder = join(out, `qa-${qaIndex++}`); await mkdir(folder, { mode: 0o700 });
        const input = join(folder, 'candidate.json'); await writeFile(input, JSON.stringify({ ...generated, analysis_plan: plan }, null, 2), { mode: 0o600 });
        const qa = inspect ? await inspect(generated, plan) : await runQA(input, folder, {
          entrypoint: new URL('./qa.mjs', import.meta.url), timeoutMs: Math.min(60000, control.timeoutMs), signal: control.signal });
        return inspect || (qa.process_exit === 0 && qa.version === 'revenue-browser/2') ? qa
          : { pass: false, repair_codes: [], reason: 'qa_unavailable' };
      },
      save: async record => { const file = join(out, `attempt-${saveIndex++}.json`);
        await writeFile(file, JSON.stringify(record, null, 2), { flag: 'wx', mode: 0o600 });
        report.attempts.push({ attempt: record.attempt, state: record.result.state, reason: record.result.reason,
          pass: record.qa?.pass ?? false, warnings: record.qa?.warnings ?? [], design_ms: record.design_ms,
          qa_ms: record.qa_ms, cost_usd: record.result.cost_usd ?? null, artifact: file }); await saveReport(); return file; },
    });
    report.state = result.state; report.artifact = result.artifact;
  } catch (error) { report.state = 'failed'; report.reason = ['invalid_contract', 'disclosure_denied', 'planner_failed'].includes(error.message) ? error.message : 'runtime_failed'; }
  finally {
    report.planner_calls = planner?.calls ?? report.planner_calls;
    report.elapsed_ms = Math.round(performance.now() - start); report.finished_at = new Date().toISOString();
    report.cost = { planner_usd: null, cli_reported_usd: report.cloud_results.length && report.cloud_results.every(r => Number.isFinite(r.cost_usd))
      ? report.cloud_results.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0) : null,
      billed_total_usd: null, note: 'CLI totals do not certify costs of failed/partial streams or retries. Audit provider records separately.' };
    await saveReport();
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [configPath, directory] = process.argv.slice(2);
  if (!configPath || !directory || process.argv.length !== 4) throw Error('usage: node revenue/run.mjs CONFIG NEW_OUTPUT');
  const report = await runReplay(JSON.parse(await readFile(configPath, 'utf8')), directory);
  console.log(JSON.stringify({ state: report.state, elapsed_ms: report.elapsed_ms, planner_calls: report.planner_calls.length,
    cloud_requests: report.cloud_requests, attempts: report.attempts, question: report.plan?.question, cost: report.cost }));
  if (report.state !== 'completed') process.exitCode = 1;
}
