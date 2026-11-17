import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCode} from '../contracts.mjs';
import {generateCode} from '../design.mjs';
import {FixtureBroker} from '../../host/fixture.mjs';
import {bundle,code,snapshot} from './fixtures.mjs';

test('free frontend retains binding and rejects executable document escapes',()=>{
  assert.deepEqual(validateCode(code(),bundle),code());
  for(const bad of [{...code(),export_id:'other'},{...code(),data_version:'bad'},{...code(),extra:'x'},
    {...code(),html:'<script>alert(1)</script>'},{...code(),html:'<img onerror="x">'},
    {...code(),html:'<base href="https://evil.invalid">'},{...code(),css:'</style><script>x</script>'},
    {...code(),javascript:'</script><iframe>'},{...code(),javascript:'x'.repeat(20001)}])assert.throws(()=>validateCode(bad,bundle));
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
