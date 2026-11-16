import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCode} from '../contracts.mjs';
import {generateCode} from '../design.mjs';
import {NemotronCodeDesigner,codePrompt} from '../adapters.mjs';
import {FixtureBroker} from '../../p2/broker.mjs';
import {schedule,briefs,protocol} from '../protocol.mjs';
import {bundle,code,snapshot} from './fixtures.mjs';

test('free frontend retains binding and rejects executable document escapes',()=>{
  assert.deepEqual(validateCode(code(),bundle),code());
  for(const bad of [{...code(),export_id:'other'},{...code(),data_version:'bad'},{...code(),extra:'x'},
    {...code(),html:'<script>alert(1)</script>'},{...code(),html:'<img onerror="x">'},
    {...code(),html:'<base href="https://evil.invalid">'},{...code(),css:'</style><script>x</script>'},
    {...code(),javascript:'</script><iframe>'},{...code(),javascript:'x'.repeat(20001)}])assert.throws(()=>validateCode(bad,bundle));
});
test('fixed paired schedule gives each provider eight identical design briefs',()=>{
  const rows=schedule();assert.equal(rows.length,8);assert.equal(protocol.output_tokens,4096);
  for(const r of rows){assert.deepEqual([...r.order].sort(),['claude','nemotron']);assert.ok(briefs[r.case.id]);}
  assert.equal(rows.filter(x=>x.order[0]==='claude').length,4);
});
test('native Nemotron code request uses the compiled free behavior, grant-only data and bounded settings',async()=>{
  let sent,authorized=0;
  const d=new NemotronCodeDesigner({id:'nvidia/nemotron-test',baseUrl:'https://test.invalid'}, {apiKey:'secret',brief:briefs.executive_dashboard,
    fetchImpl:async(_,options)=>{sent=JSON.parse(options.body);assert.equal(authorized,1);return Response.json({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{type:'function',function:{name:'design_dashboard',arguments:JSON.stringify(code())}}]}}]});}});
  const out=await d.design(bundle,{timeoutMs:1000,beforeSend:async()=>authorized++});assert.deepEqual(out.spec,code());
  assert.equal(sent.messages[0].content,codePrompt);assert.equal(sent.max_tokens,4096);assert.equal(sent.chat_template_kwargs.enable_thinking,false);
  assert.deepEqual(JSON.parse(sent.messages.at(-1).content),{export_id:bundle.export_id,data_version:bundle.data_version,payload:bundle.payload,design_brief:briefs.executive_dashboard});
});
test('code generation uses unchanged broker send/use and per-transport authorization',async()=>{
  const s=snapshot(),events=[];let calls=0;
  const broker=new FixtureBroker({session:{reauthorize:async()=>s},verifySource:async()=>true,audit:async e=>events.push(e),recipient:'test'});
  const designer={recipient:'test',async design(b,{beforeSend}){calls++;await beforeSend();return {spec:code(b)};}};
  const result=await generateCode({broker,designer});assert.equal(result.state,'generated');assert.equal(calls,1);
  assert.deepEqual(events.map(e=>e.event),['send','send','use']);assert.equal(JSON.stringify(result.bundle).includes('PRIVATE_LABEL'),false);
  broker.revoke();assert.equal((await generateCode({broker,designer})).state,'generation_failed');assert.equal(calls,1);
});
test('late revocation, wrong recipient, invalid code and cancellation never produce a usable artifact',async()=>{
  for(const mode of ['revoke','recipient','invalid','cancel']){
    const control=new AbortController(),broker=new FixtureBroker({session:{reauthorize:async()=>snapshot()},verifySource:async()=>true,audit:async()=>{},recipient:'test'});
    const designer={recipient:mode==='recipient'?'other':'test',async design(b,{beforeSend}){
      await beforeSend();if(mode==='revoke')broker.revoke();if(mode==='cancel')control.abort();return {spec:mode==='invalid'?{...code(b),data_version:'bad'}:code(b)};
    }};
    const result=await generateCode({broker,designer,signal:control.signal});assert.equal(result.state,'generation_failed');assert.equal(result.spec,undefined);
  }
});
