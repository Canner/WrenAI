import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixturePayload } from '../../host/fixture.mjs';
import {codeSchema} from '../contracts.mjs';
import {designPrompt} from '../claude.mjs';
import { ClaudeCode } from '../claude.mjs';
import { digest } from '../../contracts.mjs';
async function withCLI(body,fn) {
  const dir=await mkdtemp(join(tmpdir(),'cloud-test-'));const command=join(dir,'cli');
  const script=`#!${process.execPath}\nif(process.argv.includes('--version')){console.log('2.1.309 (Claude Code)');process.exit(0);}\n${body}`;
  await writeFile(command,script,{mode:0o700});
  const cloud=new ClaudeCode({command,model:'fixed-test',baseUrl:'http://127.0.0.1:1'},{apiKey:'cloud-only-key',contract:{systemPrompt:designPrompt,schema:codeSchema,maxOutputTokens:24576,effort:'low'}});
  try{await fn(cloud,dir);}finally{await rm(dir,{recursive:true,force:true});}
}
test('Claude launcher gives child only bundle + schema; disables tools, settings, persistence, other keys',async()=>{
  await withCLI(`let input='';for await(const c of process.stdin)input+=c;const b=JSON.parse(input);
    const flags=process.argv.slice(2);const ok=flags.includes('--bare')&&flags.includes('--safe-mode')&&flags[flags.indexOf('--tools')+1]===''&&flags.includes('--strict-mcp-config')&&flags.includes('--no-session-persistence')&&!process.env.NVIDIA_INFERENCE_API_KEY&&!process.env.PRIVATE_CANARY;
    console.log(JSON.stringify({type:'result',subtype:'success',is_error:!ok,structured_output:{version:1,export_id:b.export_id,data_version:b.data_version,html:'<main></main>',css:'',javascript:''}}));`,async cloud=>{
    process.env.PRIVATE_CANARY='never-forward';try {
      const b={export_id:'00000000-0000-0000-0000-000000000001',data_version:digest(fixturePayload),payload:fixturePayload,recipient:cloud.recipient};
      assert.equal((await cloud.design(b)).spec.html,'<main></main>');
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
const body={max_tokens:24576,thinking:{type:'adaptive'},output_config:{effort:'low'},model:${JSON.stringify(item.mode==='wrong_model'?'other':'fixed-test')},messages:[{role:'user',content:[{type:'text',text:prompt}]}],tools:[{name:'StructuredOutput',input_schema:schema}],system:[{text:'x-anthropic-billing-header: cc_version=2.1.309.abc; cc_entrypoint=sdk-cli;'}, {text:"You are a Claude agent, built on Anthropic's Claude Agent SDK."},{text:${JSON.stringify(designPrompt)}}]};
if(${JSON.stringify(item.mode)}==='extra_tool')body.tools.push({name:'Read'});
if(${JSON.stringify(item.mode)}==='extra_system')body.system.push({text:'PRIVATE_CANARY'});
for(let i=0;i<${item.mode==='repeat'?4:item.mode==='retry'?2:1};i++)await fetch(process.env.ANTHROPIC_BASE_URL+'/v1/messages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
console.log(JSON.stringify({type:'result',subtype:'success',structured_output:{}}));`;
    await writeFile(command,code,{mode:0o700});let auth=0;const start=forwarded;
    const cloud=new ClaudeCode({command,model:'fixed-test',baseUrl:`http://127.0.0.1:${server.address().port}`},{apiKey:'test',contract:{systemPrompt:designPrompt,schema:codeSchema,maxOutputTokens:24576,effort:'low'}});
    try{await cloud.design({recipient:cloud.recipient,payload:fixturePayload},{beforeSend:async()=>{auth++;if(item.mode==='retry'&&auth>1)throw Error('revoked');}});
      assert.equal(forwarded-start,item.expected,item.mode);
      if(item.mode==='retry')assert.equal(auth,2);
    }finally{await rm(dir,{recursive:true,force:true});}
  }}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
