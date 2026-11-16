import { readFile, open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { requireThat } from '../contracts.mjs';
import { NemotronPlanner } from './model.mjs';
import { PrivateSession } from './session.mjs';
import { connectWren } from './mcp.mjs';
import { scoreData } from './scoring.mjs';

export function scoreFlow(snapshot, expected) {
  const plan = snapshot.plans.at(-1);
  return {
    completed: snapshot.state === 'completed',
    group_count: plan?.groups.length === expected.groups,
    grains: JSON.stringify(plan?.groups.map(g => g.grain).sort()) === JSON.stringify([...expected.grains].sort()),
    planner_clarification: snapshot.questions.some(q => q.source === 'planner') === expected.planner_clarification,
    wren_clarification: expected.wren_clarification === undefined ? null
      : snapshot.questions.some(q => q.source === 'wren') === expected.wren_clarification,
  };
}

async function main() {
  const [flag, configPath, casesPath, outputPath] = process.argv.slice(2);
  requireThat(['--live', '--preflight'].includes(flag) && configPath && outputPath && casesPath);
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const cases = JSON.parse(await readFile(casesPath, 'utf8'));
  requireThat(Array.isArray(cases) && cases.length > 0 && cases.length <= 4);
  // Exclusive local report: never overwrite previous runs or symlink destinations.
  const file = await open(outputPath, 'wx', 0o600);
  const report = { mode: flag, started_at: new Date().toISOString(), model: config.model.id,
    endpoint: config.model.baseUrl, cases: [], model_calls: [], error: null };
  let port, model;
  try {
    port = await connectWren(config.service); report.tools = port.tools;
    if (flag === '--preflight') {
      report.capabilities = await port.call('capabilities', {}, { timeoutMs: 30_000 });
      const session = await port.call('open_session', {}, { timeoutMs: 30_000 });
      report.session_revision = session.revision;
      report.closed = await port.call('close_session', { session_id: session.session_id }, { timeoutMs: 10_000 });
    } else {
      model = new NemotronPlanner(config.model, { apiKey: process.env[config.model.credentialEnv] });
      for (const item of cases) {
        console.log(JSON.stringify({ case: item.id, event: 'started' }));
        const session = new PrivateSession({ port, model });
        let snapshot;
        try {
          snapshot = await session.start(item.question);
          for (const answer of item.human_answers ?? []) {
            if (snapshot.state !== 'waiting_for_user') break;
            snapshot = await session.answer({ question_id: snapshot.pending.id,
              plan_revision: snapshot.pending.plan_revision, answer });
          }
          report.cases.push({ id: item.id, question: item.question,
            scripted_human_answers: item.human_answers, snapshot, flow_score: scoreFlow(snapshot, item.expect),
            data_score: scoreData(snapshot, item.expect) });
        } finally { await session.close(); }
        console.log(JSON.stringify({ case: item.id, state: snapshot.state, score: report.cases.at(-1).flow_score,
          data_score: report.cases.at(-1).data_score }));
      }
    }
  } catch {
    report.error = 'evaluation_failed'; process.exitCode = 1;
  } finally {
    report.model_calls = model?.calls ?? [];
    report.finished_at = new Date().toISOString();
    try { if (port) { report.diagnostics = port.diagnostics(); await port.close(); } }
    catch { report.cleanup_error = true; process.exitCode = 1; }
    await file.writeFile(JSON.stringify(report, null, 2)); await file.close();
  }
  if (report.cases.some(c => Object.values(c.flow_score).includes(false) || !c.data_score.passed)) process.exitCode = 1;
  console.log(JSON.stringify({ report: outputPath, cases: report.cases.length, error: report.error }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => { console.error('evaluation_configuration_error'); process.exitCode = 1; });
