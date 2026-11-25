import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {evaluateScripted} from '../eval.mjs';import {fixtureReport,fixturePlan,specimen} from '../fixtures.mjs';
import {digest} from '../../contracts.mjs';import {inspectDashboard} from '../browser-qa.mjs';
test('fixed plans generate bar/line/area frontends with actual numeric and interaction journeys',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dashboard-browser-unit-'));try{const r=await evaluateScripted('dashboard-frontend',join(dir,'suite'),{browser:true});assert.equal(r.passed,r.scheduled);}finally{await rm(dir,{recursive:true,force:true});}
});
test('browser rejects stale KPI, plan chart substitution and distorted visible geometry',async()=>{
 const report=fixtureReport(),bundle={export_id:'00000000-0000-0000-0000-000000000001',data_version:digest(report.payload),payload:report.payload},plan=fixturePlan(bundle,report);
 const dir=await mkdtemp(join(tmpdir(),'dashboard-mutations-'));
 try{for(const [name,mutate,expected] of [
  ['wrong-kpi',s=>s.javascript+=";setInterval(()=>{document.querySelector('[data-kpi=net]').textContent='$1.00'},10)",'KPI net'],
  ['wrong-plan',s=>s.html=s.html.replace('data-chart-type="bar"','data-chart-type="line"'),'plan_section_content'],
  ['wrong-scale',s=>s.css+=' [data-drill-mark]{width:100%!important}','chart_scale_mismatch'],
 ]){const spec=specimen(bundle,plan);mutate(spec);const input=join(dir,name+'.json');await writeFile(input,JSON.stringify({spec,bundle,report,plan}));const q=await inspectDashboard(input,join(dir,name));assert.equal(q.pass,false);assert(q.failures.some(x=>x.error.includes(expected)),JSON.stringify(q.failures));}}
 finally{await rm(dir,{recursive:true,force:true});}
});
