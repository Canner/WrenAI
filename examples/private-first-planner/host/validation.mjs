// Delivery policy for the revenue fixture contract, not a generic visual judge.
// Raw browser measurements and the historical strict score remain unchanged.
import { chartContract } from '../design/chart.mjs';
export const validationContract = 'revenue-dashboard-delivery/2';
const viewports = [{ width: 1280, height: 900 }, { width: 390, height: 844 }];
const dataChecks = ['values_pass', 'dates_pass', 'period_pass', 'chart_present', 'synthetic_label'];
const bool = value => typeof value === 'boolean';
const strings = value => Array.isArray(value) && value.every(x => typeof x === 'string');
const runtimeComplete = value => value && Array.isArray(value.network) && strings(value.errors) && strings(value.console_errors);
const dataComplete = value => value && dataChecks.every(key => bool(value[key]))
  && value.chart?.contract === chartContract && value.chart.present === value.chart_present
  && (value.chart_present ? ['svg','canvas','css'].includes(value.chart.renderer) && ['matched','fallback'].includes(value.chart.marker)
    : value.chart.renderer === null && value.chart.marker === 'missing');

export function assessDashboard(qa) {
  const blockers = [], warnings = [];
  const add = (target, code, scope, details = {}) => target.push({ code, scope, ...details });
  const finish = () => {
    const pass = blockers.length === 0;
    // Only deterministic functional failures request automatic repair. Unknown
    // evidence or a network/security failure does not cause another cloud call.
    const repairable = new Set(['values_pass', 'dates_pass', 'period_pass', 'chart_present', 'synthetic_label', 'interaction', 'runtime_error']);
    const repair_codes = !pass && blockers.every(x => repairable.has(x.code))
      ? [...new Set(blockers.map(x => ['interaction', 'runtime_error'].includes(x.code) ? 'interaction' : x.code === 'chart_present' ? 'chart_rendering' : 'data_binding'))] : [];
    return { contract: validationContract, pass,
      decision: pass ? (warnings.length ? 'accept_with_warnings' : 'accept') : 'reject',
      quality_pass: pass && warnings.length === 0, blockers, warnings, repair_codes };
  };
  const complete = qa?.evidence_version === 'revenue-browser-evidence/2' && qa.process_exit === 0 && !qa.error
    && Array.isArray(qa.views) && qa.views.length === viewports.length
    && viewports.every((viewport, i) => {
      const v = qa.views[i];
      return v?.viewport?.width === viewport.width && v.viewport.height === viewport.height
        && runtimeComplete(v) && dataComplete(v.checks) && bool(v.interaction)
        && bool(v.checks.no_overflow) && Array.isArray(v.checks.small_text)
        && v.checks.small_text.every(x => typeof x.text === 'string' && Number.isFinite(x.px))
        && Number.isFinite(v.checks.min_font_px)
        && Array.isArray(v.contrast?.violations) && Array.isArray(v.contrast?.incomplete);
    }) && dataComplete(qa.counterfactual) && runtimeComplete(qa.counterfactual_runtime);
  if (!complete) { add(blockers, 'qa_incomplete', 'artifact'); return finish(); }
  const checkRuntime = (value, scope) => {
    if (value.network.length) add(blockers, 'external_request', scope, { count: value.network.length });
    if (value.console_errors.some(x => /Content Security Policy|refused|blocked/i.test(x))) add(blockers, 'security_policy_violation', scope);
    if (value.errors.length) add(blockers, 'runtime_error', scope, { count: value.errors.length });
  };
  const checkData = (checks, scope) => {
    for (const key of dataChecks) if (!checks[key]) add(blockers, key, scope);
    if (checks.chart.marker === 'fallback') add(warnings, 'chart_marker_mismatch', scope);
  };
  for (const [i, v] of qa.views.entries()) {
    const scope = i === 0 ? 'desktop' : 'mobile';
    checkRuntime(v, scope); checkData(v.checks, scope);
    if (!v.interaction) add(blockers, 'interaction', scope);
    if (!v.checks.no_overflow) add(warnings, 'horizontal_overflow', scope);
    if (v.checks.small_text.length) add(warnings, 'small_text', scope,
      { count: v.checks.small_text.length, min_px: v.checks.min_font_px });
    if (v.contrast.violations.length) add(warnings, 'contrast_violation', scope, { count: v.contrast.violations.length });
    if (v.contrast.incomplete.length) add(warnings, 'contrast_unverified', scope, { count: v.contrast.incomplete.length });
  }
  checkData(qa.counterfactual, 'changed_data'); checkRuntime(qa.counterfactual_runtime, 'changed_data');
  return finish();
}

const warningLabels = {
  chart_marker_mismatch: '圖表可見，但語意標記位置不符',
  small_text: '部分文字偏小', horizontal_overflow: '版面有橫向溢出',
  contrast_violation: '部分文字對比不足', contrast_unverified: '部分文字對比尚未確認',
};
export function warningSummary(qa) {
  if (qa?.decision !== 'accept_with_warnings') return '';
  const labels = [...new Set((qa.warnings ?? []).map(x => warningLabels[x.code] ?? '其他品質提醒'))];
  return `可交付，附品質提醒（不代表品質全通過）：${labels.join('；')}。`;
}
