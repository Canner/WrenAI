import test from 'node:test';
import assert from 'node:assert/strict';
import {cases,protocol,schedule,route,aggregate,visualFingerprint} from '../protocol.mjs';
import {NemotronDesigner} from '../private-design.mjs';
import {EvidenceLease} from '../evidence.mjs';
import {fixturePayload,projectFixture} from '../../p2/broker.mjs';
import {digest} from '../../contracts.mjs';

test('preregistered schedule is eight paired blocks with every arm once',()=>{
  assert.equal(schedule().length,8);assert.equal(cases.length,4);assert.equal(protocol.repeats,2);
  for(const s of schedule())assert.deepEqual([...s.order].sort(),['adaptive','fixed_claude','private_only']);
  assert.equal(cases.filter(c=>c.expected_route==='dashboard_design').length,2);
});
test('routing compares three policies without giving private_only a cloud fallback',()=>{
  for(const p of ['local_answer','dashboard_design']){assert.equal(route('private_only',p),'nemotron');assert.equal(route('fixed_claude',p),'claude');}
  assert.equal(route('adaptive','local_answer'),'nemotron');assert.equal(route('adaptive','dashboard_design'),'claude');
  assert.throws(()=>route('adaptive','unknown'));assert.throws(()=>route('gpt','local_answer'));
});
test('aggregate keeps failures, unknown cost, and shared time separate',()=>{
  const blocks=[{private_ms:100,arms:[{mode:'fixed_claude',provider:'claude',state:'completed',elapsed_ms:20,cost_usd:.01,spec:{export_id:'a',data_version:'b',theme:'ivory'}}]},
    {private_ms:200,arms:[{mode:'fixed_claude',provider:'claude',state:'design_unavailable',elapsed_ms:90,cost_usd:undefined}]}];
  const s=aggregate(blocks).find(x=>x.mode==='fixed_claude');assert.equal(s.scheduled,2);assert.equal(s.completed,1);assert.equal(s.cloud_invocations,2);
  assert.equal(s.known_claude_list_usd,.01);assert.equal(s.missing_claude_costs,1);assert.equal(s.total_cost_usd,null);assert.equal(s.composed_p50_ms,120);
  assert.equal(visualFingerprint({theme:'ivory',export_id:'x',data_version:'y'}),visualFingerprint({theme:'ivory',export_id:'a',data_version:'b'}));
});
const spec=b=>({version:1,export_id:b.export_id,data_version:b.data_version,theme:'ivory',accent:'teal',layout:'balanced',cards:[{dataset_id:'revenue_total',kind:'kpi',title:'Total revenue'},{dataset_id:'revenue_weekly',kind:'bar',title:'Weekly revenue'}]});
test('private design uses real Nemotron transport with same bundle/schema and no transcript',async()=>{
  const bundle={export_id:'00000000-0000-0000-0000-000000000001',data_version:digest(fixturePayload),payload:fixturePayload};let body,authorized=0;
  const d=new NemotronDesigner({id:'nvidia/nemotron-test',baseUrl:'https://test.invalid'},{apiKey:'secret',fetchImpl:async(_,o)=>{
    body=JSON.parse(o.body);assert.equal(authorized,1);return Response.json({usage:{prompt_tokens:100,completion_tokens:30},choices:[{finish_reason:'tool_calls',message:{tool_calls:[{type:'function',function:{name:'design_dashboard',arguments:JSON.stringify(spec(bundle))}}]}}]});
  }});
  const result=await d.design(bundle,{timeoutMs:1000,beforeSend:async()=>authorized++});assert.equal(result.spec.theme,'ivory');assert.equal(result.cost_usd,null);
  assert.equal(body.tools.length,1);assert.deepEqual(JSON.parse(body.messages.at(-1).content),bundle);assert.equal(d.calls.length,1);
});
test('evidence lease uses actual service refs, rejects modified evidence and bounds calls',async()=>{
  const s={state:'completed',trace:[{name:'open_session',response:{session_id:'real-session'}}],results:[{evidence_ref:'actual-ref',result:{v:770},evidence:{ok:true}}]};let changed=false;
  const lease=new EvidenceLease({call:async(name,args)=>{assert.equal(name,'get_evidence');assert.equal(args.request.session_id,'real-session');assert.equal(args.request.evidence_ref,'actual-ref');return{result:{v:770},evidence:changed?{}:{ok:true}};}},s,Date.now()+10000);
  await lease.reauthorize();changed=true;await assert.rejects(lease.reauthorize());changed=false;
  while(lease.calls<32)await lease.reauthorize();await assert.rejects(lease.reauthorize());
});
test('fixed route override cannot bypass the existing data allowlist',()=>{
  assert.throws(()=>projectFixture({state:'completed',results:[],plans:[{presentation:'local_answer'}]},{requireDesignProposal:false}));
});
