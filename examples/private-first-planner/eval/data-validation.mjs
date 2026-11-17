import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { WorkerSession } from '../harnesses/worker.mjs';
import { assessFixtureData } from '../host/policy.mjs';
import { runSuite } from './runner.mjs';
import { scriptedBinding } from './scripted.mjs';
import { snapshot } from '../design/test/fixtures.mjs';

export const period = { lower: '2026-01-01', upper: '2026-01-19', timezone: 'UTC' };
// Mutations are fault injection, not production prompts. No hidden expectation is
// passed to WorkerSession or to the service port. Historical regression preserves
// the relevant evidence fields from a real result, without refs or private SQL.
export function evidenceCase(treatment = 'valid') {
  const item = structuredClone(snapshot().results[1]);
  item.group.metric = 'Revenue'; item.constraints = { period, filters: [], requested_statuses: [] };
  item.evidence.observed.date_windows = [{ column: 'orders.order_date', ...item.evidence.applied_period }];
  if (treatment === 'missing-period') { item.evidence.applied_period = null; item.evidence.observed.date_windows = [];
    item.evidence.unverified = ['date_window_unverified', 'fiscal_calendar_bounds']; }
  if (treatment === 'wrong-period') item.evidence.applied_period.upper = '2026-01-20';
  if (treatment === 'wrong-inclusive') item.evidence.applied_period.upper_inclusive = true;
  if (treatment === 'wrong-value') item.result.rows[0].c1 = 51;
  if (treatment === 'failed-rule') { item.evidence.checks['exclude-test-orders'].result = 'failed'; item.evidence.checks_summary = 'not_all_satisfied'; }
  if (treatment === 'missing-checks') { delete item.evidence.checks; delete item.evidence.checks_summary; }
  if (treatment === 'unknown-semantics') item.evidence.unverified.push('currency');
  if (treatment === 'timezone') item.result.timezone = 'America/New_York';
  if (treatment === 'wrong-grain') item.result.rows = [{ c0: '2026-01-01', c1: 770 }];
  return item;
}
export const validationCases = [
  ['valid', 'verified', 'verified'], ['missing-period', 'unverified', 'unverified'],
  ['wrong-period', 'rejected', 'rejected'], ['wrong-inclusive', 'rejected', 'rejected'],
  ['wrong-value', 'verified', 'rejected'], ['failed-rule', 'rejected', 'rejected'],
  ['missing-checks', 'unverified', 'unverified'], ['unknown-semantics', 'unverified', 'unverified'],
  ['timezone', 'rejected', 'rejected'], ['wrong-grain', 'rejected', 'rejected'],
].map(([id, worker, host]) => ({ id, input: { treatment: id }, expected: { worker, host } }));
export async function validationUnit({ input }) {
  const item = evidenceCase(input.treatment); let revision = 0;
  const session = new WorkerSession({ async call(name) {
    if (name === 'open_session') return { session_id: 'local', revision };
    if (name === 'close_session') return { status: 'closed' };
    if (name === 'get_evidence') return { result: item.result, evidence: item.evidence };
    return { status: 'completed', revision: ++revision, result_ref: 'local-result', evidence_ref: 'local-evidence', result: item.result };
  } });
  return { async run() {
    const result = await session.execute({ capability: 'analytics', question: 'Weekly revenue for the explicit UTC period.', grain: 'week', period });
    return { worker: result.validation, host: assessFixtureData({ ...item, grain: 'week', period }), result };
  }, close: () => session.close() };
}
export function scoreValidation(record, expected) {
  const checks = { executed: record.state === 'completed', worker: record.output?.worker.status === expected.worker,
    host: record.output?.host.status === expected.host };
  return { passed: Object.values(checks).every(Boolean), checks };
}
export async function runValidation(out) {
  return runSuite({ harnessId: 'data-worker', out: resolve(out), binding: scriptedBinding, cases: validationCases,
    createUnit: validationUnit, score: scoreValidation, scorerVersion: 'data-verification-regression/1' });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { summary } = await runValidation(process.argv[2]); console.log(JSON.stringify(summary, null, 2));
  if (summary.passed !== summary.scheduled) process.exitCode = 1;
}
