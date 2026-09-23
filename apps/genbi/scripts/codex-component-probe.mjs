// Deterministic vendor config/thread contract only. No real login or model request.
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnCodexTransport } from '../dist-server/server/runtime-host/codex-process.js';
import { runCodexComponentStep, codexComponentConfiguration } from '../dist-server/server/runtime-host/codex-component-step.js';
const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'genbi-component-probe-')));
const home = path.join(root,'home'), login = path.join(root,'login'), cwd = path.join(root,'work');
for (const dir of [home,login,cwd]) mkdirSync(dir,{mode:0o700});
const config = codexComponentConfiguration('component');
function toml(v) { if(Array.isArray(v)) return `[${v.map(toml).join(',')}]`; if(v && typeof v ==='object')return `{${Object.entries(v).map(([k,v])=>`${JSON.stringify(k)}=${toml(v)}`).join(',')}}`; return JSON.stringify(v); }
if (!process.env.CODEX_BIN || !path.isAbsolute(process.env.CODEX_BIN)) throw Error('absolute CODEX_BIN required');
const executable = realpathSync(process.env.CODEX_BIN);
const transport = spawnCodexTransport({executable,cwd,env:{HOME:home,CODEX_HOME:login,PATH:'/usr/bin:/bin'},args:[...Object.entries(config).flatMap(([k,v])=>['-c',`${k}=${toml(v)}`]),'app-server','--stdio','--strict-config']});
const methods=[];
let turnIntercepted = false;
try {
 let handlers;
 await assert.rejects(runCodexComponentStep({listen:h=>{handlers=h;transport.listen(h);},close:()=>transport.close(),write:line=>{
   const m=JSON.parse(line); methods.push(m.method);
   if(m.method==='turn/start'){turnIntercepted=true;throw Error('model forbidden');}
   if(m.method==='account/read') {handlers.data(Buffer.from(JSON.stringify({id:m.id,result:{requiresOpenaiAuth:true,account:{type:'chatgpt',email:'nobody@example.test'}}})+'\n'));return;}
   transport.write(line);
 }}, {cwd,codexHome:login,permissionProfile:'component',model:'gpt-5.4',accountEmail:'nobody@example.test',configuration:config,assertCurrent(){}}, {tier:'fast',request:'no model',input:{},prompt:'no model',consumes:{},tools:{},toolSchemas:{},toolDescriptions:{},signal:new AbortController().signal}));
 console.log(JSON.stringify({methods,syntheticAccount:true,threadContractAccepted:turnIntercepted,modelRequestsSent:0}));
 assert.ok(turnIntercepted,'exact vendor thread response must pass; turn/start is intercepted before transport');

}finally {await transport.close();rmSync(root,{recursive:true,force:true});}
