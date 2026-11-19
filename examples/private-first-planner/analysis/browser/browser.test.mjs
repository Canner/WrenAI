import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
import {ReportSession} from '../../host/report.mjs';import {ports,model,choose,plan,query} from '../test/fixture.mjs';
import {isolatedBrowser} from '../../design/browser.mjs';import {digest} from '../../contracts.mjs';import {aggregateReportDocument} from './export.mjs';
test('aggregate report can drive free frontend code in an offline sandboxed HTML file', async()=>{
 const q=query(['country','channel']),report=(await new ReportSession(ports(model(choose(q)),model(plan(q)))).submit('Revenue')).report;
 const bundle={export_id:'12345678-1234-1234-1234-123456789abc',payload:report.payload,data_version:digest(report.payload)};
 const spec={version:1,export_id:bundle.export_id,data_version:bundle.data_version,html:'<main><button>Country A</button><output></output></main>',css:'body{font-size:16px}',javascript:`document.querySelector('button').onclick=async()=>{const r=await reportData.query({lower:'2024-01-01',upper:'2024-03-01',dimension:'channel',filters:{country:['A']},path:[]});document.querySelector('output').textContent=r.result.totals.net;};`};
 const dir=await mkdtemp(join(tmpdir(),'aggregate-report-file-')),file=join(dir,'report.html'),browser=await isolatedBrowser();
 try{
  await writeFile(file,aggregateReportDocument(spec,bundle,report));const context=await browser.browser.newContext({offline:true,viewport:{width:390,height:900}}),page=await context.newPage(),requests=[],errors=[];
  await context.route('**/*',r=>{if(r.request().url()===pathToFileURL(file).href)return r.continue();requests.push(r.request().url());return r.abort()});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(file).href);const frame=page.frames().find(f=>f!==page.mainFrame());await frame.waitForFunction(()=>document.documentElement.dataset.hostReady==='true');await frame.locator('button').click();await frame.waitForFunction(()=>document.querySelector('output').textContent==='140');
  assert.equal(await page.locator('iframe').getAttribute('sandbox'),'allow-scripts');assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);assert.equal(await frame.evaluate(()=>Object.isFrozen(reportData.capabilities)),true);await context.close();
 }finally{await browser.close();await rm(dir,{recursive:true,force:true})}
});
