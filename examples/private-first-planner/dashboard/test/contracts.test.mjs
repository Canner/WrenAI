import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {ExportBroker} from '../../host/export.mjs';import {digest} from '../../contracts.mjs';
import {fixtureReport,fixturePlan,specimen,scope} from '../fixtures.mjs';import {validatePlan} from '../contracts.mjs';
import {dashboardPipeline,planDashboard} from '../units.mjs';import {evaluateScripted,releaseFor} from '../eval.mjs';import {proportional} from '../view-check.mjs';
async function setup(){const report=fixtureReport(),broker=new ExportBroker({policy:{id:'test',version:'1',briefs:{default:'Revenue'},project:async()=>report.payload},current:async()=>null,audit:async()=>{},epoch:'test'});const bundle=await broker.propose({recipient:'scripted',brief_id:'default'});broker.approve(bundle.export_id,digest(bundle));return{report,broker,bundle};}
test('independent plan/frontend offline suites execute contracts and keep expected rejection distinct',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dashboard-units-'));try{for(const unit of ['dashboard-plan','dashboard-frontend']){const r=await evaluateScripted(unit,join(dir,unit));assert.equal(r.passed,r.scheduled);assert.equal(r.mode,'scripted');assert(r.records.some(x=>x.state==='rejected'||x.state==='planning_failed'));assert(r.records.every(x=>!x.quality_measured));}
 assert.notDeepEqual(await releaseFor('dashboard-plan'),await releaseFor('dashboard-frontend'));}finally{await rm(dir,{recursive:true,force:true});}
});
test('plan is bound to report, period, supported charts and complete metrics',async()=>{
 const {bundle,report}=await setup(),base=fixturePlan(bundle,report);assert.equal(validatePlan(base,bundle,report,scope).primary_metric,'net');
 for(const mutate of [p=>p.sections[0].metrics.pop(),p=>p.sections[1].chart='pie',p=>p.interactions.drill.to='city',p=>p.sections[1].metrics=['profit'],p=>p.export_id='other',p=>p.period.lower='2025-04-01',p=>p.sections[1].id='metrics']){const p=structuredClone(base);mutate(p);assert.throws(()=>validatePlan(p,bundle,report,scope));}
});
test('invalid cloud plan never reaches frontend',async()=>{
 const {broker,bundle,report}=await setup();let generations=0;const saved=[];const invalid=fixturePlan(bundle,report);invalid.primary_metric='profit';
 const result=await dashboardPipeline({broker,report,scope,signal:new AbortController().signal,planner:{design:async()=>({spec:invalid})},savePlan:async r=>saved.push(r),makeDesigner:()=>{generations++;},inspect:async()=>{},save:async()=>{}});
 assert.equal(result.state,'planning_failed');assert.equal(saved.length,1);assert.equal(generations,0);
});
test('geometry catches flex distortion but allows subpixel differences',()=>{
 proportional([100,15,10],[125,19.5,12.5]);assert.throws(()=>proportional([100,15,10],[100,22,17]),/chart_scale_mismatch/);assert.throws(()=>proportional([100,80,60],[100,100,100]),/chart_scale_mismatch/);
});
test('extended grant still expires and can be revoked',async()=>{
 let now=0;const broker=new ExportBroker({ttlMs:900000,now:()=>now,policy:{id:'test',version:'1',briefs:{default:'test'},project:async()=>({rows:[]})},current:async()=>null,audit:async()=>{},epoch:'test'});const b=await broker.propose({recipient:'test',brief_id:'default'});broker.approve(b.export_id,digest(b));now=899999;await broker.authorize(b,'send');now=900000;await assert.rejects(broker.authorize(b,'use'));
});
test('cancelled planner cannot keep the host waiting for an uncooperative model',async()=>{
 const {broker,report}=await setup(),controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20);
 try{const r=await planDashboard({broker,report,scope,signal:controller.signal,planner:{design:()=>new Promise(()=>{})}});assert.equal(r.reason,'cancelled_or_deadline');}finally{clearTimeout(timer);}
});

test('valid plan is immutable and shared unchanged through one frontend repair',async()=>{
 const {broker,bundle,report}=await setup();const plan=fixturePlan(bundle,report),seen=[],records=[];let inspected=0;
 const r=await dashboardPipeline({broker,report,scope,signal:new AbortController().signal,planner:{design:async()=>({spec:plan})},savePlan:async()=>{},makeDesigner:({plan,attempt})=>{seen.push(plan);assert(Object.isFrozen(plan));assert.throws(()=>{plan.sections[0].chart='bar'});return {recipient:bundle.recipient,design:async()=>({spec:specimen(bundle,plan)})}},inspect:async()=>({pass:++inspected===2,repair_codes:['chart_rendering']}),save:async r=>records.push(r)});
 assert.equal(r.state,'completed');assert.equal(records.length,2);assert.equal(seen[0],seen[1]);assert.equal(records[0].plan_digest,records[1].plan_digest);
});
