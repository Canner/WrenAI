import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { artifactPorts } from './artifacts.mjs';
import { validationContract } from './validation.mjs';
import { sourceHashes } from '../eval/files.mjs';
import { requireThat, digest } from '../contracts.mjs';

// Retrospective browser replay only. No model, worker, export approval or live
// delivery is performed; historical grants are not renewed by this command.
export async function revalidate(reportPath, output) {
  const bytes = await readFile(reportPath), original = JSON.parse(bytes), out = resolve(output);
  const candidates = original.flows.flatMap(flow => (flow.candidates ?? []).map(candidate => ({ flow, candidate })));
  requireThat(candidates.length > 0 && candidates.length <= 24);
  await mkdir(out, { mode: 0o700 });
  const root = fileURLToPath(new URL('../', import.meta.url));
  const report = { version: 'dashboard-revalidation/1', contract: validationContract,
    retrospective_only: true, paid_model_calls: 0, started_at: new Date().toISOString(),
    input_sha256: createHash('sha256').update(bytes).digest('hex'), source_before: await sourceHashes(root), candidates: [] };
  const save = async () => {
    await writeFile(join(out, 'report.tmp'), JSON.stringify(report, null, 2), { mode: 0o600 });
    await rename(join(out, 'report.tmp'), join(out, 'report.json'));
  };
  await save();
  for (const { flow, candidate } of candidates) {
    requireThat(candidate.result.state === 'generated');
    const folder = join(out, `flow-${flow.index}-attempt-${candidate.attempt}`);
    const started = performance.now();
    const assessment = await artifactPorts(folder).inspect(candidate.result);
    report.candidates.push({ flow: flow.index, case_id: flow.case_id, route: flow.route, attempt: candidate.attempt,
      input_digest: digest({ spec: candidate.result.spec, bundle: candidate.result.bundle }),
      previous_host_pass: candidate.qa?.pass === true, previous_strict_quality_pass: candidate.raw_qa?.passed === true,
      assessment, elapsed_ms: Math.round(performance.now() - started) });
    await save();
    console.log(JSON.stringify({ flow: flow.index, attempt: candidate.attempt, decision: assessment.decision,
      blockers: assessment.blockers.map(x => x.code), warnings: [...new Set(assessment.warnings.map(x => x.code))] }));
  }
  report.source_after = await sourceHashes(root); report.source_unchanged = digest(report.source_before) === digest(report.source_after);
  report.input_unchanged = createHash('sha256').update(await readFile(reportPath)).digest('hex') === report.input_sha256;
  report.finished_at = new Date().toISOString();
  report.summary = { candidates: report.candidates.length,
    accept: report.candidates.filter(x => x.assessment.decision === 'accept').length,
    accept_with_warnings: report.candidates.filter(x => x.assessment.decision === 'accept_with_warnings').length,
    reject: report.candidates.filter(x => x.assessment.decision === 'reject').length,
    strict_quality_pass: report.candidates.filter(x => x.assessment.strict_quality_pass).length };
  await save(); requireThat(report.source_unchanged && report.input_unchanged);
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await revalidate(...process.argv.slice(2)); console.log(JSON.stringify(report.summary));
}
