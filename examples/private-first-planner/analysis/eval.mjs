import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ReportSession } from '../host/report.mjs';
import { registry, plannerContext, admitDecision, admitWorker, covers } from './contracts.mjs';
import { artifact } from './behaviors/index.mjs';
import { catalog, query, choose, plan, clarify, model, ports } from './test/fixture.mjs';

// Same parser and host as the live entry. These deterministic fixtures verify the
// protocol and sequencing, not real-model planning quality or database semantics.
export async function evaluate(unit, directory) {
  if (!['planner', 'worker', 'host'].includes(unit)) throw Error('unknown_analysis_unit');
  const out = resolve(directory); await mkdir(out, { mode: 0o700 });
  const records = [], r = registry(catalog());
  const cases = [
    { id: 'reuse-country', q: query(), expected: 'cube' },
    { id: 'fallback-channel', q: query(['channel']), expected: 'semantic_query' },
    { id: 'fallback-product', q: query(['country', 'product_category']), expected: 'semantic_query' },
    { id: 'missing-profit', q: { ...query(), measures: ['profit'] }, expected: 'unsupported' },
  ];
  for (const c of cases) {
    const start = performance.now(); let actual;
    if (unit === 'planner') {
      const m = model(c.expected === 'unsupported' ? { name: 'select_report_source', args: { status: 'unsupported', route: 'none', cube_id: null, request: null, question: null, reason: 'No confirmed profit definition' } } : choose(c.q, c.expected));
      const decision = admitDecision(await m.decide({ conversation: [{ role: 'user', content: c.id }], capabilities: plannerContext(r), metadata: {} }));
      actual = decision.status === 'unsupported' ? 'unsupported' : decision.route;
      if (actual === 'cube' && !r.sources.some(s => s.kind === 'cube' && s.id === decision.cube_id && covers(s, decision.request))) actual = 'invalid';
    } else if (unit === 'worker') {
      if (c.expected === 'unsupported') {
        const m = model({ name: 'plan_semantic_query', args: { status: 'unsupported', source_id: null, query: null, question: null, reason: 'No authorized source covers profit' } });
        actual = admitDecision(await m.decide({ capabilities: { request: c.q } }), true).status;
      } else {
        const m = model(plan(c.q)); const decision = admitDecision(await m.decide({ capabilities: { request: c.q, sources: r.sources.filter(s => s.kind === 'semantic') } }), true);
        actual = admitWorker(decision, c.q, r).kind === 'semantic' ? 'semantic_query' : 'invalid';
      }
    } else {
      const p = ports(model(choose(c.q)), model(plan(c.q))), host = new ReportSession(p), result = await host.submit(c.id);
      actual = result.state === 'completed' ? result.report.capabilities.source.kind : result.state;
      await writeFile(join(out, `${c.id}.json`), JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
    }
    const expected = unit === 'worker' && c.expected !== 'unsupported' ? 'semantic_query' : c.expected;
    records.push({ id: c.id, expected, actual, pass: actual === expected, elapsed_ms: Math.round(performance.now() - start) });
  }
  if (unit === 'host') {
    const q = query(['channel']), p = ports(model(clarify(false), choose(q)), model(clarify(true), plan(q))), host = new ReportSession(p);
    let s = await host.submit('Ambiguous request'); const stages = [];
    while (s.state === 'waiting_for_user' && stages.length < 3) { stages.push(s.source); s = await host.answer(s.question_id, 'Use confirmed definitions'); }
    records.push({ id: 'planner-worker-clarification', pass: s.state === 'completed' && stages.join(',') === 'planner,worker', stages, state: s.state });
  }
  const report = { version: 'report-planning-eval/1', unit, mode: 'scripted', new_paid_model_calls: 0, behavior: artifact.provenance,
    passed: records.every(r => r.pass), records };
  await writeFile(join(out, 'summary.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 }); return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [unit, out] = process.argv.slice(2); if (!out || process.argv.length !== 4) throw Error('usage: node analysis/eval.mjs planner|worker|host NEW_OUTPUT');
  const report = await evaluate(unit, out); console.log(JSON.stringify({ unit, passed: report.passed, cases: report.records.length })); if (!report.passed) process.exitCode = 1;
}
