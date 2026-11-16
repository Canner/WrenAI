import { isDeepStrictEqual as equal } from 'node:util';
import { scoreData } from '../p1/scoring.mjs';

export const scorerVersion = 'unit-contracts/2';
const finish = checks => ({ passed: Object.values(checks).every(x => x === true), checks });
export function scorePlanner(record, expected) {
  if (expected.error) return finish({ rejection: record.state === 'failed' && record.error === expected.error });
  const output = record.output, d = output?.final;
  return finish({ executed: record.state === 'completed', decision: d?.name === expected.final,
    turns: equal(output?.decisions?.map(x => x.name), expected.decisions),
    grains: !expected.grains || equal(d?.args.groups?.map(g => g.grain), expected.grains),
    period: !expected.period || equal(d?.args.constraints?.period, expected.period),
    presentation: !expected.presentation || d?.args.presentation === expected.presentation,
    question: !expected.question_terms || expected.question_terms.every(t => d?.args.question.includes(t)) });
}
export function scoreWorker(record, expected) {
  const result = record.output?.final;
  const checks = { executed: record.state === 'completed', status: result?.response?.status === expected.status,
    clarification: !expected.clarification || !!record.output?.turns.some(t => t.response.status === 'needs_clarification') };
  if (expected.status === 'completed' || expected.validation) checks.validation = result?.validation?.status === (expected.validation ?? 'verified');
  if (expected.status === 'completed') checks.data = !!result?.evidence && scoreData({ results: [{ group: { id: 'eval', grain: result.grain },
    result: result.response.result, evidence: result.evidence }] }, { ...expected, groups: 1 }).passed;
  return finish(checks);
}
export function scoreCloud(record, expected) {
  const output = record.output;
  return finish({ executed: record.state === 'completed', state: output?.state === expected.state,
    reason: !expected.reason || output?.reason === expected.reason,
    calls: expected.calls === undefined || record.attempts.length === expected.calls,
    browser: !output?.quality_measured || output.qa?.passed === true });
}
export const scorers = { 'private-planner': scorePlanner, 'data-worker': scoreWorker, 'cloud-planner': scoreCloud };
