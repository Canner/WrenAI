import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

// Generated code never runs in Node. This child only drives a network-denied
// Chromium; a parent watchdog can kill its entire process group if JS hangs.
export async function runQA(input,out,{timeoutMs=30_000,signal}={}) {
  signal?.throwIfAborted();
  const started=performance.now();let timedOut=false;
  const exit=await new Promise(resolve=>{
    const child=spawn(process.execPath,[fileURLToPath(new URL('./qa.mjs',import.meta.url)),input,out],{
      detached:true,stdio:'ignore',env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:tmpdir()},
    });
    const stop=()=>{timedOut=true;try{process.kill(-child.pid,'SIGKILL');}catch{}};
    const timer=setTimeout(stop,timeoutMs);
    signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);};
    child.on('error',()=>{cleanup();resolve(-1);});child.on('close',code=>{cleanup();resolve(code);});
  });
  let result;try{result=JSON.parse(await readFile(join(out,'qa.json'),'utf8'));}catch{}
  if(timedOut||!result){result={passed:false,error:timedOut?'browser_deadline':'browser_process_failed'};
    await writeFile(join(out,'qa.json'),JSON.stringify(result,null,2),{mode:0o600});}
  return {...result,process_exit:exit,qa_ms:Math.round(performance.now()-started)};
}
