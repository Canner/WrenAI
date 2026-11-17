import { immutable } from '../contracts.mjs';
import { validateResultGrain } from '../worker/retrieval.mjs';

export const dataContract = 'data-verification/1';
// This contract classifies service evidence, never SQL or model assurances.
// A deployment may add a trusted value check; hidden eval answers are not inputs.
export function dataAssessment(blockers = [], warnings = []) {
  return immutable({ contract: dataContract, status: blockers.length ? 'rejected' : warnings.length ? 'unverified' : 'verified',
    blockers: [...new Set(blockers)], warnings: [...new Set(warnings)] });
}
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.0+)?(?:Z|\+00:00)?)?$/.test(value)) return null;
  const day = value.slice(0, 10), ms = Date.parse(day + 'T00:00:00Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === day ? day : null;
}
export function assessData({ result, evidence, grain, period }) {
  const blockers = [], warnings = [];
  if (!validateResultGrain(result, grain)) blockers.push('result_grain_mismatch');
  const expected = period && instant(period.lower) && instant(period.upper) && period.lower < period.upper && period.timezone === 'UTC';
  if (!expected) warnings.push('requested_period_unverified');
  if (!result?.timezone) warnings.push('timezone_unverified');
  else if (expected && result.timezone !== period.timezone) blockers.push('timezone_mismatch');
  const applied = evidence?.applied_period;
  if (!applied || !instant(applied.lower) || !instant(applied.upper)
      || typeof applied.lower_inclusive !== 'boolean' || typeof applied.upper_inclusive !== 'boolean') warnings.push('period_unverified');
  else if (expected && (instant(applied.lower) !== instant(period.lower) || instant(applied.upper) !== instant(period.upper)
      || !applied.lower_inclusive || applied.upper_inclusive)) blockers.push('period_mismatch');
  const checks = Object.values(evidence?.checks ?? {});
  if (checks.some(c => c?.applicable !== false && ['unsatisfied', 'violated', 'failed'].includes(c.result))) blockers.push('semantic_check_failed');
  const noRules = evidence?.checks_summary === 'none_applicable' && evidence?.checks
    && checks.every(c => c?.applicable === false && c.result === 'not_applicable');
  if ((!noRules && (evidence?.checks_summary !== 'all_satisfied' || !checks.length))
      || checks.some(c => c?.applicable !== false && c.result !== 'satisfied' && !['unsatisfied', 'violated', 'failed'].includes(c.result))) warnings.push('semantic_checks_unverified');
  // Fiscal-calendar uncertainty is irrelevant to an explicit UTC calendar range.
  const unverified = evidence?.unverified;
  if (!Array.isArray(unverified)) warnings.push('semantics_unverified');
  else for (const code of unverified) {
    if (code === 'fiscal_calendar_bounds' && expected) continue;
    warnings.push(code === 'date_window_unverified' ? 'period_unverified' : 'semantics_unverified');
  }
  return dataAssessment(blockers, warnings);
}
export function combineData(assessments) {
  if (!assessments.length || assessments.some(a => a?.contract !== dataContract)) return dataAssessment([], ['evidence_unverified']);
  return dataAssessment(assessments.flatMap(a => a.blockers), assessments.flatMap(a => a.warnings));
}
const labels = {
  fixture_scope_unverified: '目前資料範圍未經合成資料驗證規則確認',
  result_grain_mismatch: '結果格式或粒度不符', timezone_mismatch: '時區不符', period_mismatch: '查詢期間不符',
  semantic_check_failed: '資料規則未通過', value_mismatch: '數值與已核准的合成資料不符',
  requested_period_unverified: '需求期間尚未確認', timezone_unverified: '時區證據不足', period_unverified: '查詢期間證據不足',
  semantic_checks_unverified: '資料規則證據不足', semantics_unverified: '資料語意尚未確認', evidence_unverified: '尚無驗證紀錄',
};
export function dataSummary(value) {
  if (value?.contract !== dataContract) return '資料尚未驗證：尚無驗證紀錄。';
  if (value.status === 'verified') return '資料驗證通過。';
  const prefix = value.status === 'rejected' ? '資料驗證未通過，不能交付' : '僅供預覽，資料尚未驗證';
  return `${prefix}：${[...value.blockers, ...value.warnings].map(x => labels[x] ?? '資料證據不足').join('；')}。`;
}
