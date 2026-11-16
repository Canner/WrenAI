import test from 'node:test';
import assert from 'node:assert/strict';
import { assessDashboard, validationContract, warningSummary } from '../validation.mjs';
import { viewState } from '../tui.mjs';

function evidence() {
  const checks = () => ({ values_pass: true, dates_pass: true, period_pass: true, chart_present: true,
    chart: {contract:'revenue-chart-presence/2',present:true,renderer:'svg',marker:'matched'},
    synthetic_label: true, no_overflow: true, small_text: [], min_font_px: 16 });
  const runtime = () => ({ network: [], errors: [], console_errors: [] });
  return { evidence_version: 'revenue-browser-evidence/2', process_exit: 0,
    views: [{ width: 1280, height: 900 }, { width: 390, height: 844 }].map(viewport => ({
      viewport, checks: checks(), interaction: true, contrast: { violations: [], incomplete: [] }, ...runtime() })),
    counterfactual: checks(), counterfactual_runtime: runtime() };
}
test('delivery and quality decisions are separate and versioned', () => {
  const qa = evidence(), clean = assessDashboard(qa);
  assert.equal(clean.contract, validationContract); assert.equal(clean.decision, 'accept'); assert.equal(clean.quality_pass, true);
  qa.views[1].contrast.incomplete.push({ id: 'color-contrast' });
  qa.views[1].checks.small_text.push({ text: 'week', px: 6.5 }); qa.views[1].checks.min_font_px = 6.5;
  qa.views[0].contrast.violations.push({ id: 'color-contrast' }); qa.views[0].checks.no_overflow = false;
  const result = assessDashboard(qa);
  assert.equal(result.pass, true); assert.equal(result.decision, 'accept_with_warnings'); assert.equal(result.quality_pass, false);
  assert.deepEqual(result.repair_codes, []); assert.equal(result.warnings.length, 4);
  assert.equal(result.warnings.find(x => x.code === 'small_text').min_px, 6.5);
  assert.match(warningSummary(result), /對比尚未確認/);
  assert.match(viewState({ task: { state: 'completed', reason: 'cloud_design', artifact: 'candidate',
    attempts: [{ artifact: 'candidate', qa: result }] } }), /可交付，附品質提醒/);
});
for (const check of ['values_pass', 'dates_pass', 'period_pass', 'chart_present', 'synthetic_label']) {
  test(`${check} still blocks, including after a data change`, () => {
    for (const scope of ['desktop', 'changed_data']) {
      const qa = evidence(); (scope === 'desktop' ? qa.views[0].checks : qa.counterfactual)[check] = false;
      if(check==='chart_present') (scope==='desktop'?qa.views[0].checks:qa.counterfactual).chart={contract:'revenue-chart-presence/2',present:false,renderer:null,marker:'missing'};
      const result = assessDashboard(qa);
      assert.equal(result.decision, 'reject'); assert.equal(result.quality_pass, false);
      assert.ok(result.blockers.some(x => x.code === check && x.scope === scope));
      assert.deepEqual(result.repair_codes, [check==='chart_present'?'chart_rendering':'data_binding']);
    }
  });
}
test('interaction and runtime errors block; visual warnings cannot override blockers', () => {
  const qa = evidence(); qa.views[1].interaction = false;
  qa.counterfactual_runtime.errors.push('failure'); qa.views[1].contrast.incomplete.push({});
  const result = assessDashboard(qa);
  assert.equal(result.pass, false); assert.equal(result.warnings.length, 1);
  assert.deepEqual(result.repair_codes, ['interaction']);
});
test('network and CSP attempts block without automated repair, including changed data', () => {
  for (const target of ['view', 'changed_data']) for (const kind of ['network', 'console_errors']) {
    const qa = evidence(), value = target === 'view' ? qa.views[0] : qa.counterfactual_runtime;
    value[kind].push(kind === 'network' ? { url: 'https://example.invalid' } : 'Refused by Content Security Policy');
    const result = assessDashboard(qa); assert.equal(result.pass, false); assert.deepEqual(result.repair_codes, []);
  }
});
test('missing, partial, wrong-version, duplicate-viewport and timed-out QA never become warning acceptance', () => {
  const bad = [null, {}, { passed: true }, { passed: false, error: 'browser_deadline' }];
  for (const mutate of [q => { delete q.evidence_version; }, q => { q.views = []; }, q => { q.views.pop(); },
    q => { q.views[1] = q.views[0]; }, q => { delete q.views[0].checks.values_pass; },
    q => { delete q.counterfactual_runtime; }, q => { q.views[0].contrast.incomplete = null; },
    q => { q.process_exit = 1; }, q => { q.error = 'browser_deadline'; }]) {
    const qa = evidence(); mutate(qa); bad.push(qa);
  }
  for (const qa of bad) {
    const result = assessDashboard(qa); assert.equal(result.pass, false);
    assert.equal(result.blockers[0].code, 'qa_incomplete'); assert.deepEqual(result.repair_codes, []);
  }
});

test('recovered chart is a visible warning without repair; legacy and incomplete evidence cannot silently pass v2', () => {
  const qa=evidence();qa.views[1].checks.chart.marker='fallback';
  const result=assessDashboard(qa);
  assert.equal(result.decision,'accept_with_warnings');assert.deepEqual(result.repair_codes,[]);
  assert.equal(result.warnings[0].code,'chart_marker_mismatch');assert.match(warningSummary(result),/圖表可見/);
  for(const mutate of [q=>{q.evidence_version='revenue-browser-evidence/1';},q=>{delete q.counterfactual.chart;},q=>{q.views[0].checks.chart.present=false;}]){
    const other=evidence();mutate(other);assert.equal(assessDashboard(other).blockers[0].code,'qa_incomplete');
  }
});
