import test from 'node:test';
import assert from 'node:assert/strict';
import { isolatedBrowser, loadPreview } from '../../design/browser.mjs';
import { probeDrillReachability } from '../reachability.mjs';
import { insightOracle, compareInsights, inspectInsights } from '../insights.mjs';
import { payload } from './fixture.mjs';

test('real isolated browser exposes immutable payload directly, not the generation envelope or private brief', async () => {
  const b = await isolatedBrowser();
  try {
    const p = payload(), spec = { html: '<main id="result"></main>', css: 'main{font-size:16px}', javascript: `
const P=window.dashboardData;const config={lower:'2024-04',upper:'2024-07'};
let denied=false;try{P.rows.push(['injected']);}catch{denied=true;}
document.getElementById('result').textContent=JSON.stringify({rows:P.rows.length,scale:P.amount_scale,denied,period:config,
 envelope:typeof P.payload,brief:typeof P.design_brief,globalBrief:typeof window.design_brief,frozen:Object.isFrozen(P.rows[0])});` };
    const v = await loadPreview(b.browser, spec, p, { width: 390, height: 900 });
    const got = JSON.parse(await v.frame.locator('#result').innerText());
    assert.equal(got.rows, p.rows.length); assert(got.denied && got.frozen);
    assert.equal(got.envelope, 'undefined'); assert.equal(got.brief, 'undefined'); assert.equal(got.globalBrief, 'undefined');
    assert.deepEqual(v.network, []); assert.deepEqual(v.errors, []); await v.context.close();
    const wrong = await loadPreview(b.browser, { ...spec, javascript: 'window.dashboardData.payload.amount_scale;' }, p, { width: 390, height: 900 });
    assert.equal(wrong.errors.length, 1); await wrong.context.close();
  } finally { await b.close(); }
});
test('scrollable controls are actually reachable, hidden/disabled controls stay invalid and probes never click', async () => {
  const b = await isolatedBrowser();
  try {
    const v = await loadPreview(b.browser, { html: '<div class="wrap"><div class="wide"><button data-drill="scroll">Drill</button></div></div><button hidden data-drill="hidden">Hidden</button><button disabled data-drill="disabled">Disabled</button>',
      css: '.wrap{width:300px;overflow:auto}.wide{width:700px}button{margin-left:500px}',
      javascript: 'document.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>document.body.dataset.clicked="yes"));' }, {}, { width: 390, height: 900 });
    const drills = ['scroll', 'hidden', 'disabled'].map(key => ({ key, ok: false })); await probeDrillReachability(v.frame, drills);
    assert.deepEqual(drills.map(d => d.ok), [true, false, false]); assert.equal(await v.frame.evaluate(() => document.body.dataset.clicked), undefined);
    await v.frame.locator('[data-drill="scroll"]').click(); assert.equal(await v.frame.evaluate(() => document.body.dataset.clicked), 'yes');
  } finally { await b.close(); }
});
test('insight oracle tests signed changes, missing prior data, and counterfactual browser-visible mistakes', async () => {
  const p = { amount_scale: 1, coverage: { lower: '2023-01', upper_exclusive: '2024-07' }, rows: [
    ['2023-04', 'A', 'Direct', 100, 0], ['2023-04', 'B', 'Search', 10, 0],
    ['2024-04', 'A', 'Direct', 80, 0], ['2024-04', 'B', 'Search', 15, 0] ] };
  const s = { lower: '2024-04', upper: '2024-07', country: '', channel: '', dimension: 'country', parent: null };
  const expected = insightOracle(p, s);
  assert.equal(expected.net_change.value, -15); assert.deepEqual(expected.country, { label: 'A', value: -20 });
  assert.equal(insightOracle(p, { ...s, parent: 'B' }).net_change.value, 5);
  assert.equal(insightOracle(p, s, { comparison: 'none' }).net_change.value, null);
  assert.equal(insightOracle(p, { ...s, lower: '2023-04', upper: '2023-07' }).net_change.value, null);
  assert.equal(compareInsights({}, expected).missing.length, 3);
  const b = await isolatedBrowser();
  try {
    const v = await loadPreview(b.browser, { html: '<section data-insight="net_change"><b data-insight-value>-$15.00</b></section>', css: 'b{font-size:16px}', javascript: 'void 0;' }, p, { width: 390, height: 900 });
    assert.deepEqual((await inspectInsights(v.frame, p, s)).failures, []);
    const changed = structuredClone(p); changed.rows[2][3] += 10;
    assert.deepEqual((await inspectInsights(v.frame, changed, s)).failures, ['net_change']);
  } finally { await b.close(); }
});
import { matchesBreadcrumb } from '../qa.mjs';

test('breadcrumb accepts ordinary singular/plural wording but still requires dimension and drill parent', () => {
  const country = { dimension: 'country', parent: null };
  for (const text of ['Country (root)', 'Breadcrumb: All Countries', 'By country']) assert.equal(matchesBreadcrumb(text, country), true);
  assert.equal(matchesBreadcrumb('All Channels', country), false);
  assert.equal(matchesBreadcrumb(null, country), false);
  assert.equal(matchesBreadcrumb('Country: GB > channels', { ...country, parent: 'GB' }), true);
  assert.equal(matchesBreadcrumb('All Countries', { ...country, parent: 'GB' }), false);
  assert.equal(matchesBreadcrumb('Channels > Email', { dimension: 'channel', parent: 'Email' }), true);
  assert.equal(matchesBreadcrumb('Country', { dimension: 'channel', parent: null }), false);
});
