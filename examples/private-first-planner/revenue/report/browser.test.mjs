import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isolatedBrowser } from '../../design/browser.mjs';
import { digest } from '../../contracts.mjs';
import { payload } from '../test/fixture.mjs';
import { createCapabilities } from './contract.mjs';
import { offlineReportDocument } from './export.mjs';

test('single file opens offline with CSP, immutable query API and no external assets', async () => {
  const p = payload(), bundle = { export_id: '12345678-1234-1234-1234-123456789abc', data_version: digest(p), payload: p };
  const cap = createCapabilities(p, { cube_id: 'revenue_health', cube_revision: 'a'.repeat(64) });
  const query = { lower: p.default_period.lower, upper: p.default_period.upper_exclusive, country: '', channel: '', dimension: 'country', parent: null, comparison: 'prior_year' };
  const spec = { version: 1, export_id: bundle.export_id, data_version: bundle.data_version,
    html: '<main><button>Query</button><output>Waiting</output></main>', css: 'body{font-size:16px}',
    javascript: `document.querySelector('button').onclick=async()=>{const api=window.reportData;try{const r=await api.query(${JSON.stringify(query)});document.querySelector('output').textContent=JSON.stringify({total:r.result.totals.net_units,groups:r.result.groups.length,frozen:Object.isFrozen(api.catalog.country),revision:r.cube_revision});}catch(e){document.querySelector('output').textContent=e.message;}};` };
  const html = offlineReportDocument(spec, bundle, cap), dir = await mkdtemp(join(tmpdir(), 'report-file-test-'));
  const file = join(dir, 'report.html'); await writeFile(file, html);
  const isolated = await isolatedBrowser();
  try {
    // file:// plus the opaque sandbox/CSP deny workers. Playwright's worker-block
    // init script itself throws when reading navigator.serviceWorker in this origin.
    const context = await isolated.browser.newContext({ offline: true }), page = await context.newPage();
    const requests = [], errors = [];
    await context.route('**/*', r => { if (r.request().url() === pathToFileURL(file).href) return r.continue(); requests.push(r.request().url()); return r.abort(); });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(file).href);
    const frame = page.frames().find(x => x !== page.mainFrame());
    await frame.waitForFunction(() => document.documentElement.dataset.hostReady === 'true');
    await frame.locator('button').click();
    await frame.waitForFunction(() => document.querySelector('output').textContent.startsWith('{'));
    const got = JSON.parse(await frame.locator('output').innerText());
    const rows = p.rows.filter(r => r[0] >= query.lower && r[0] < query.upper);
    assert.equal(got.total, rows.reduce((n, r) => n + r[3] - r[4], 0)); assert.equal(got.groups, 2); assert.equal(got.frozen, true); assert.equal(got.revision, cap.cube.revision);
    assert.deepEqual(requests, []); assert.deepEqual(errors, []);
    assert.equal(await page.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
    await context.close();
  } finally { await isolated.close(); await rm(dir, { recursive: true, force: true }); }
});
