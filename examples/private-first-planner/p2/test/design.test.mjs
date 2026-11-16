import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixtureBroker, fixturePayload, projectFixture } from '../broker.mjs';
import { validateDesign } from '../contracts.mjs';
import { designDashboard } from '../design.mjs';
import { renderDashboard } from '../render.mjs';
import { ClaudeCode } from '../claude.mjs';
import { parse, plannerContract } from '../planning.mjs';
import { NemotronPlanner } from '../../p1/model.mjs';
import { PrivateSession } from '../../p1/session.mjs';
import { digest } from '../../contracts.mjs';

const clone=x=>structuredClone(x);
function snapshot() {
  const constraints={period:fixturePayload.period,filters:[],requested_statuses:[]};
  const evidence={ mandatory_scope:{kind:'project_defaults',declared_defaults_enforced:true},
    checks_summary:'all_satisfied',applied_period:{lower:'2026-01-01',upper:'2026-01-19',lower_inclusive:true,upper_inclusive:false},
    checks:{'exclude-test-orders':{result:'satisfied'},'count-paid-and-shipped':{result:'satisfied'}},
    observed:{aggregated:true,models:['orders'],columns:{orders:['amount','is_test','order_date','status']},joins:[],status_literals:{'orders.status':['paid','shipped']}},unverified:['fiscal_calendar_bounds']};
  const results=fixturePayload.datasets.map(d=>({plan_revision:0,group:{id:d.id,capability:'analytics',grain:d.grain,metric:'Revenue'},result_ref:'PRIVATE_REF',evidence_ref:'PRIVATE_EVIDENCE',
    result:{kind:'table',timezone:'UTC',columns:d.columns.map((key,i)=>({key:`c${i}`,label:'PRIVATE_COLUMN'})),rows:d.rows.map(r=>Object.fromEntries(d.columns.map((k,i)=>[`c${i}`,r[k]])))},evidence:clone(evidence)}));
  return {state:'completed',plan_revision:0,plans:[{constraints,groups:results.map(r=>r.group),presentation:'dashboard_design',objective:'PRIVATE_TRANSCRIPT'}],results};
}
function design(bundle) {return {version:1,export_id:bundle.export_id,data_version:bundle.data_version,theme:'midnight',accent:'teal',layout:'hero',cards:[
  {dataset_id:'revenue_total',kind:'kpi',title:'Total revenue'}, {dataset_id:'revenue_weekly',kind:'line',title:'Weekly revenue'}]};}
function setup({mutate,source=true,auditFailure=false}={}) {
  const s=snapshot();mutate?.(s);let calls=0;const events=[];
  const broker=new FixtureBroker({session:{reauthorize:async()=>{calls++;return clone(s);}},recipient:'test-recipient',verifySource:async()=>source,
    audit:async e=>{if(auditFailure) throw Error('private diagnostics');events.push(e);}});
  const cloud={recipient:'test-recipient',calls:[],async design(b){this.calls.push(clone(b));return {spec:design(b)};}};
  return {s,broker,cloud,events,get evidenceCalls(){return calls;}};
}
test('successful export reauthorizes before send and use, strips private labels and renders trusted values',async()=>{
  const x=setup(),result=await designDashboard(x);
  assert.equal(result.state,'completed');assert.equal(x.evidenceCalls,3);assert.deepEqual(x.events.map(e=>e.event),['send','use']);
  assert.deepEqual(result.bundle.payload,fixturePayload);
  assert.equal(JSON.stringify(x.cloud.calls).includes('PRIVATE_'),false);
  assert.match(result.html,/\$770/);assert.match(result.html,/\$220/);assert.match(result.html,/script-src 'none'/);
  assert.equal(result.html.includes('<script'),false);assert.equal(result.html.includes('https://'),false);
});
for(const [name,mutate] of Object.entries({
  raw:s=>s.results[0].evidence.observed.aggregated=false,
  other_value:s=>s.results[0].result.rows[0].c0=771,
  other_source:s=>s.results[0].evidence.observed.models=['customers'],
  sensitive_column:s=>s.results[0].evidence.observed.columns.orders.push('email'),
  scope:s=>s.results[0].evidence.mandatory_scope.kind='explicit',
  wrong_period:s=>s.results[0].evidence.applied_period.upper='2026-01-20',
  wrong_revision:s=>s.plan_revision++,
  extra_filter:s=>s.plans[0].constraints.filters=['private segment'],
  unknown_semantics:s=>s.results[0].evidence.unverified.push('currency'),
  status:s=>s.plans[0].constraints.requested_statuses=['cancelled'],
  extra_result:s=>s.results.push(s.results[0]),
})) test(`deny ${name} before any cloud call`,async()=>{
  const x=setup({mutate}),r=await designDashboard(x);assert.equal(r.state,'design_unavailable');assert.equal(x.cloud.calls.length,0);
});
test('source verification and audit failure stop sends',async()=>{
  for(const options of [{source:false},{auditFailure:true}]) {
    const x=setup(options);assert.equal((await designDashboard(x)).state,'design_unavailable');assert.equal(x.cloud.calls.length,0);
  }
});
test('revocation before send or while cloud runs prevents disclosure/use',async()=>{
  const x=setup();x.broker.revoke();assert.equal((await designDashboard(x)).state,'design_unavailable');assert.equal(x.cloud.calls.length,0);
  const y=setup();y.cloud.design=async b=>{y.broker.revoke();return {spec:design(b)};};
  const r=await designDashboard(y);assert.equal(r.state,'design_unavailable');assert.equal(r.html,undefined);
});
test('forged bundle, recipient and expiration fail closed',async()=>{
  const x=setup(),b=await x.broker.prepare();
  await assert.rejects(x.broker.authorize({...b,recipient:'gpt'},'send'));
  await assert.rejects(x.broker.authorize({...b,expires_at:Date.now()+1e9},'send'));
  x.cloud.recipient='gpt';assert.equal((await designDashboard(x)).state,'design_unavailable');assert.equal(x.cloud.calls.length,0);
  let time=0;const broker=new FixtureBroker({session:{reauthorize:async()=>snapshot()},verifySource:async()=>true,audit:async()=>{},recipient:'x',now:()=>time});
  const old=await broker.prepare();time=120001;await assert.rejects(broker.authorize(old,'send'));
});
test('changed result or revision after send cannot be rendered',async()=>{
  for(const mutate of [s=>s.plan_revision++,s=>s.results[0].result.rows[0].c0=999]) {
    const x=setup();x.cloud.design=async b=>{mutate(x.s);return {spec:design(b)};};
    assert.equal((await designDashboard(x)).state,'design_unavailable');
  }
});
for(const [name,mutate] of Object.entries({
  code:s=>s.script='fetch("private")',unknown_ref:s=>s.cards[0].dataset_id='private',wrong_version:s=>s.data_version='f'.repeat(64),
  wrong_export:s=>s.export_id='00000000-0000-0000-0000-000000000001',duplicate:s=>s.cards[1]=s.cards[0],
  numeric_claim:s=>s.cards[0].title='Revenue grew 99%',bad_chart:s=>s.cards[0].kind='line',url:s=>s.accent='https://bad.invalid',
})) test(`invalid design ${name} never renders or retries`,async()=>{
  const x=setup();let calls=0;x.cloud.design=async b=>{calls++;const spec=design(b);mutate(spec);return {spec};};
  const r=await designDashboard(x);assert.equal(r.state,'design_unavailable');assert.equal(r.html,undefined);assert.equal(calls,1);
});
test('cancel/deadline ignores late cloud response and bounds a never-resolving broker',async()=>{
  const x=setup(),control=new AbortController();
  x.cloud.design=async b=>{control.abort();return {spec:design(b)};};
  assert.equal((await designDashboard({...x,signal:control.signal})).state,'design_unavailable');
  const y=setup();y.broker.prepare=()=>new Promise(()=>{});
  const start=Date.now();assert.equal((await designDashboard({...y,deadline:Date.now()+20})).state,'design_unavailable');assert.ok(Date.now()-start<1000);
});
test('dashboard planner contract reaches native Nemotron transport; P1 stays opt-in',async()=>{
  const s=snapshot(),args={objective:'Revenue dashboard',constraints:s.plans[0].constraints,groups:s.results.map(r=>r.group),presentation:'dashboard_design'};
  let payload;const model=new NemotronPlanner({id:'nvidia/nemotron-test',baseUrl:'https://test.invalid'},{apiKey:'secret',decisionContract:plannerContract,fetchImpl:async(_,o)=>{
    payload=JSON.parse(o.body);return Response.json({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{type:'function',function:{name:'plan_queries',arguments:JSON.stringify(args)}}]}}]});
  }});
  const decision=await model.decide({capabilities:[{id:'analytics'}],metadata:{},conversation:[],timeoutMs:1000});
  assert.equal(decision.args.presentation,'dashboard_design');assert.match(payload.messages[0].content,/specialist is available/);
  assert.ok(payload.tools[0].function.parameters.required.includes('presentation'));
  assert.throws(()=>parse('plan_queries',{...args,presentation:'gpt'},[{id:'analytics'}]));
  assert.throws(()=>parse('plan_queries',{...args,endpoint:'https://evil'},[{id:'analytics'}]));
});
test('real PrivateSession reauthorizes actual refs and rejects changed evidence and closed sessions',async()=>{
  const s=snapshot();let index=0,changed=false;const seen=[];
  const port={async call(name,args){seen.push({name,args});
    if(name==='capabilities')return{capabilities:[{id:'analytics'}]};
    if(name==='open_session')return{session_id:'session',revision:0};
    if(name==='close_session')return{status:'closed'};
    if(name==='ask_data'){const i=index++;return{status:'completed',revision:index,result_ref:`r${i}`,evidence_ref:`e${i}`,result:s.results[i].result};}
    if(name==='get_evidence'){const i=Number(args.request.evidence_ref.slice(1));return{result:s.results[i].result,evidence:changed?{}:s.results[i].evidence};}
  }};
  const session=new PrivateSession({port,parseDecision:parse,model:{decide:async()=>({name:'plan_queries',args:{...s.plans[0],objective:'Revenue'}})}});
  assert.equal((await session.start('Dashboard')).state,'completed');
  await session.reauthorize();assert.deepEqual(seen.slice(-2).map(c=>c.args.request.evidence_ref),['e0','e1']);
  changed=true;await assert.rejects(session.reauthorize());await session.close();await assert.rejects(session.reauthorize());
});
test('every allowed visual variant renders accessible data without active code',async()=>{
  const x=setup(),b=await x.broker.prepare();
  for(const theme of ['midnight','ivory'])for(const accent of ['teal','violet','amber'])for(const kind of ['line','bar'])for(const layout of ['hero','balanced']){
    const s=design(b);Object.assign(s,{theme,accent,layout});s.cards[1].kind=kind;
    assert.equal(validateDesign(s,b).theme,theme);const html=renderDashboard(s,b);assert.match(html,/role="img"/);assert.match(html,/View source values/);
  }
});
// A real subprocess fixture checks launcher behavior without using a model or CLI install.
async function withCLI(body,fn) {
  const dir=await mkdtemp(join(tmpdir(),'cloud-test-'));const command=join(dir,'cli');
  const script=`#!${process.execPath}\nif(process.argv.includes('--version')){console.log('2.1.309 (Claude Code)');process.exit(0);}\n${body}`;
  await writeFile(command,script,{mode:0o700});
  const cloud=new ClaudeCode({command,model:'fixed-test',baseUrl:'http://127.0.0.1:1'},{apiKey:'cloud-only-key'});
  try{await fn(cloud,dir);}finally{await rm(dir,{recursive:true,force:true});}
}
test('Claude launcher gives child only bundle + schema; disables tools, settings, persistence, other keys',async()=>{
  await withCLI(`let input='';for await(const c of process.stdin)input+=c;const b=JSON.parse(input);
    const flags=process.argv.slice(2);const ok=flags.includes('--bare')&&flags.includes('--safe-mode')&&flags[flags.indexOf('--tools')+1]===''&&flags.includes('--strict-mcp-config')&&flags.includes('--no-session-persistence')&&!process.env.NVIDIA_INFERENCE_API_KEY&&!process.env.PRIVATE_CANARY;
    console.log(JSON.stringify({type:'result',subtype:'success',is_error:!ok,structured_output:{version:1,export_id:b.export_id,data_version:b.data_version,theme:'midnight',accent:'teal',layout:'hero',cards:[{dataset_id:'revenue_total',kind:'kpi',title:'Total revenue'},{dataset_id:'revenue_weekly',kind:'bar',title:'Weekly revenue'}]}}));`,async cloud=>{
    process.env.PRIVATE_CANARY='never-forward';try {
      const b={export_id:'00000000-0000-0000-0000-000000000001',data_version:digest(fixturePayload),payload:fixturePayload,recipient:cloud.recipient};
      assert.equal((await cloud.design(b)).spec.theme,'midnight');
    }finally{delete process.env.PRIVATE_CANARY;}
  });
});
test('Claude subprocess timeout kills child, cancellation rejects, output bounded and errors sanitized',async()=>{
  for(const [body,expected,options] of [
    ['setInterval(()=>{},1000);','cloud_timeout',{timeoutMs:30}],
    ['process.stdout.write("x".repeat(140000));','cloud_output_limit',{}],
    ['console.error("PRIVATE_SECRET");process.exit(1);','cloud_unavailable',{}],
    ['console.log("not json");','cloud_invalid_output',{}],
  ]) await withCLI(body,async cloud=>{
    await assert.rejects(cloud.design({recipient:cloud.recipient,payload:fixturePayload},options),new RegExp(expected));
  });
  await withCLI('setInterval(()=>{},1000);',async cloud=>{
    const ac=new AbortController();setTimeout(()=>ac.abort(),60);
    await assert.rejects(cloud.design({recipient:cloud.recipient,payload:fixturePayload},{signal:ac.signal}));
  });
});

test('HTTP gateway reauthorizes every attempt, rejects extra tools/context, and caps CLI retries',async()=>{
  const {createServer}=await import('node:http');let forwarded=0;
  const server=createServer(async(req,res)=>{for await(const _ of req){}forwarded++;res.writeHead(200,{'content-type':'application/json'});res.end('{}');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const {designPrompt}=await import('../claude.mjs');
  const cases=[{mode:'valid',expected:1},{mode:'retry',expected:1},{mode:'extra_tool',expected:0},{mode:'extra_system',expected:0},{mode:'wrong_model',expected:0},{mode:'repeat',expected:3}];
  try {for(const item of cases){
    const dir=await mkdtemp(join(tmpdir(),'gateway-test-')),command=join(dir,'cli');
    const code=`#!${process.execPath}
if(process.argv.includes('--version')){console.log('2.1.309 (Claude Code)');process.exit(0);}
let prompt='';for await(const c of process.stdin)prompt+=c;
const schema=JSON.parse(process.argv[process.argv.indexOf('--json-schema')+1]);
const body={model:${JSON.stringify(item.mode==='wrong_model'?'other':'fixed-test')},messages:[{role:'user',content:[{type:'text',text:prompt}]}],tools:[{name:'StructuredOutput',input_schema:schema}],system:[{text:'x-anthropic-billing-header: cc_version=2.1.309.abc; cc_entrypoint=sdk-cli;'}, {text:"You are a Claude agent, built on Anthropic's Claude Agent SDK."},{text:${JSON.stringify(designPrompt)}}]};
if(${JSON.stringify(item.mode)}==='extra_tool')body.tools.push({name:'Read'});
if(${JSON.stringify(item.mode)}==='extra_system')body.system.push({text:'PRIVATE_CANARY'});
for(let i=0;i<${item.mode==='repeat'?4:item.mode==='retry'?2:1};i++)await fetch(process.env.ANTHROPIC_BASE_URL+'/v1/messages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
console.log(JSON.stringify({type:'result',subtype:'success',structured_output:{}}));`;
    await writeFile(command,code,{mode:0o700});let auth=0;const start=forwarded;
    const cloud=new ClaudeCode({command,model:'fixed-test',baseUrl:`http://127.0.0.1:${server.address().port}`},{apiKey:'test'});
    try{await cloud.design({recipient:cloud.recipient,payload:fixturePayload},{beforeSend:async()=>{auth++;if(item.mode==='retry'&&auth>1)throw Error('revoked');}});
      assert.equal(forwarded-start,item.expected,item.mode);
      if(item.mode==='retry')assert.equal(auth,2);
    }finally{await rm(dir,{recursive:true,force:true});}
  }}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
