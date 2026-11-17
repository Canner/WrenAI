import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { syntheticPayload,validatePayload,initialState } from '../data.mjs';
import { expected,journeys } from '../oracle.mjs';
import { designContract,release } from '../harness.mjs';
import { admitBehaviors } from '../../behaviors/artifact.mjs';
import { behaviorContract } from '../behaviors/contract.mjs';
import { codeSchema } from '../../design/contracts.mjs';
import { stepsFor } from '../../collaboration/check.mjs';

test('aggregate contract rejects unsupported grain, private fields, duplicate cells and ambiguous hierarchies',()=>{
  for(const mutate of [p=>p.complete=false,p=>p.sql='SELECT secret',p=>p.rows.push(p.rows[0]),
    p=>p.rows[0].customer_id='private',p=>p.rows[0].date=p.period.upper,p=>p.rows[0].orders=-1,
    p=>p.rows[0].revenue_cents=.5,p=>p.capabilities.execution='query',
    p=>p.rows[0].region='Ambiguous',p=>p.period.lower='2026-02-31']) {
    const p=structuredClone(syntheticPayload());mutate(p);assert.throws(()=>validatePayload(p));
  }
  for(const v of ['base','changed','edge','empty'])assert.ok(validatePayload(syntheticPayload(v)));
});
test('oracle checks weighted AOV, half-open date filtering and parent context independently',()=>{
  const p=structuredClone(syntheticPayload());p.rows=[
    {...p.rows[0],date:'2026-02-02',revenue_cents:10000,orders:1},
    {...p.rows[0],date:'2026-02-10',revenue_cents:5000,orders:9},
    {...p.rows[0],date:'2026-02-20',region:'Other',country:'Other country',revenue_cents:9000,orders:0}];
  validatePayload(p);let s=initialState(p);
  assert.deepEqual(expected(p,s),{revenue:240,orders:10,aov:24,groups:[
    {label:'APAC',revenue:150,orders:10,aov:15},{label:'Other',revenue:90,orders:0,aov:null}]});
  s={...s,parent:'APAC',upper:'2026-02-10'};assert.equal(expected(p,s).aov,100);assert.equal(expected(p,s).groups[0].label,'Japan');
  s={...s,lower:'2026-02-03'};assert.deepEqual(expected(p,s),{revenue:0,orders:0,aov:null,groups:[]});
});
test('journeys include two hierarchies, filter ordering, invalid input, empty result and reset',()=>{
  const p=syntheticPayload();const steps=journeys(p);assert.ok(steps.length>=18);
  assert.ok(steps.some(s=>s.action==='drill'&&s.state.dimension==='product'));
  assert.ok(steps.some(s=>s.action==='drill'&&s.state.dimension==='geography'));
  assert.ok(steps.some(s=>s.action==='invalid-lower'));
  assert.deepEqual(steps.at(-1).state,initialState(p));
  const both=steps.filter(s=>s.state.region&&s.state.category&&s.state.parent===null&&s.state.lower===p.period.lower&&s.state.upper===p.period.upper);
  assert.deepEqual(expected(p,both[0].state),expected(p,both.at(-1).state));
});
test('new design and repair contracts use admitted Warble components with bounded diagnostics',async()=>{
  const contract=designContract();assert.deepEqual(contract.schema,codeSchema);assert.equal(contract.maxOutputTokens,4096);
  const repaired=designContract({attempt:1,diagnostics:['interaction','private SQL text']});
  assert.ok(repaired.systemPrompt.endsWith('Diagnostics: interaction'));assert.throws(()=>designContract({attempt:2}));
  const ir=JSON.parse(readFileSync(new URL('../behaviors/compiled/ir.json',import.meta.url)));
  assert.equal(Object.keys(admitBehaviors(ir,behaviorContract)).length,2);
  ir.components[0].required_capabilities.push('run_sql');assert.throws(()=>admitBehaviors(ir,behaviorContract));
  const manifest=await release();assert.equal(manifest.release_id.length,64);
  const steps=await stepsFor('interactive','/tmp/test-run');assert.equal(steps.length,2);
});
