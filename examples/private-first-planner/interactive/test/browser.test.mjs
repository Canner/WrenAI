import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest } from '../../contracts.mjs';
import { runQA } from '../../design/qa-process.mjs';
import { runInteractive } from '../harness.mjs';
import { syntheticPayload } from '../data.mjs';
import { specimen } from './specimen.mjs';
const bundle=()=>{const payload=syntheticPayload();return {export_id:randomUUID(),data_version:digest(payload),payload};};
async function qa(fault,{timeoutMs=30_000,hardcode=false}={}) {
  const out=await mkdtemp(join(tmpdir(),'interactive-probe-'));
  try {
    const b=bundle(),spec=specimen(b,{fault});
    if(hardcode)spec.javascript=spec.javascript.replace('const p = window.dashboardData',`const p = ${JSON.stringify(b.payload)}`);
    await writeFile(join(out,'input.json'),JSON.stringify({bundle:b,spec}));
    return await runQA(join(out,'input.json'),out,{timeoutMs,entrypoint:new URL('../qa.mjs',import.meta.url)});
  }finally{await rm(out,{recursive:true,force:true});}
}
test('stale KPI, broken reset and missing chart fail real browser journeys',async()=>{
  for(const [fault,code] of [['stale-kpi','data_binding'],['broken-reset','interaction'],['no-chart','chart_rendering']]) {
    const result=await qa(fault);assert.equal(result.process_exit,0);assert.equal(result.pass,false,fault);
    assert.ok(result.repair_codes.includes(code),JSON.stringify({fault,result}));
  }
});
test('hardcoded aggregates cannot pass the changed-data and changed-label probe',async()=>{
  const result=await qa(null,{hardcode:true});assert.equal(result.pass,false);
  assert.ok(result.records.filter(r=>r.input==='original').every(r=>!r.failures.length));
  assert.ok(result.records.some(r=>r.input==='changed'&&r.failures.length));
});
test('network violations and hung programs cannot be repaired into a silent pass',async()=>{
  const network=await qa('network');assert.equal(network.pass,false);assert.deepEqual(network.repair_codes,[]);
  const loop=await qa('infinite',{timeoutMs:3000});assert.equal(loop.error,'browser_deadline');assert.notEqual(loop.process_exit,0);
});
test('host runs one repair with scoped diagnostics and preserves both candidates',async()=>{
  const root=await mkdtemp(join(tmpdir(),'interactive-repair-'));const seen=[];
  try {
    const summary=await runInteractive({out:join(root,'run'),recipient:'scripted:test',makeDesigner:({attempt,diagnostics,contract})=>{
      seen.push({attempt,diagnostics,contract});return {recipient:'scripted:test',async design(b,{beforeSend}){
        await beforeSend();return {spec:specimen(b,{fault:attempt?null:'stale-kpi'}),cost_usd:0};
      }};
    }});
    assert.equal(summary.state,'completed');assert.equal(summary.attempts.length,2);
    assert.equal(summary.attempts[0].pass,false);assert.equal(summary.attempts[1].pass,true);
    assert.deepEqual(seen[1].diagnostics,['data_binding']);assert.ok(seen[1].contract.systemPrompt.includes('single repair attempt'));
    assert.ok(JSON.parse(await readFile(join(root,'run/attempt-0.json'))).result.spec);
    await assert.rejects(runInteractive({out:join(root,'run')}),/EEXIST/);
  }finally{await rm(root,{recursive:true,force:true});}
});
