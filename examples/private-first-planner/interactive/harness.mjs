import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, requireThat } from '../contracts.mjs';
import { ExportBroker } from '../host/export.mjs';
import { designWithRepair } from '../host/cloud.mjs';
import { codeSchema } from '../design/contracts.mjs';
import { runQA } from '../design/qa-process.mjs';
import { artifact } from './behaviors/index.mjs';
import { syntheticPayload, deliveryContract } from './data.mjs';
import { sourceHashes, sha256 } from '../behaviors/artifact.mjs';

export function designContract({attempt=0,diagnostics=[]}={}) {
  requireThat(attempt===0||attempt===1);
  const codes=diagnostics.filter(x=>['data_binding','interaction','chart_rendering'].includes(x));
  return {systemPrompt:artifact.components[attempt?'repair_interactive_dashboard':'design_interactive_dashboard'].prompt
    +(attempt?`\nDiagnostics: ${codes.join(', ')}`:''),schema:codeSchema,maxOutputTokens:4096};
}
export async function release() {
  const files=sourceHashes(fileURLToPath(new URL('.',import.meta.url)));
  for(const name of Object.keys(files))if(name.startsWith('test/'))delete files[name];
  for(const name of ['contracts.mjs','host/export.mjs','host/cloud.mjs','design/design.mjs','design/contracts.mjs',
    'design/browser.mjs','design/chart.mjs','design/qa-process.mjs','behaviors/artifact.mjs'])
    files['../'+name]=sha256(await readFile(new URL('../'+name,import.meta.url)));
  const value={version:'interactive-harness-release/1',input:'interactive-aggregates/1',output:deliveryContract,files};
  return {...value,release_id:digest(value)};
}

// Opt-in synthetic laboratory. Does not replace the pi/Wren application route.
// The ONLY data source is this repository's fixture factory, never a worker result.
export async function runInteractive({variant='base',recipient,makeDesigner,out,signal=new AbortController().signal,timeoutMs=180_000,qaTimeoutMs=60_000}) {
  const payload=syntheticPayload(variant),audit=[];
  await mkdir(out,{mode:0o700}); // immutable per-run evidence: refuse existing output
  const provenance=await release();
  const policy={id:'interactive-synthetic-only',version:'1',briefs:{default:'Create a clear, interactive BI dashboard. Preserve free layout and frontend generation.'},
    project:async()=>payload};
  const broker=new ExportBroker({policy,current:async()=>null,audit:async e=>audit.push(e),epoch:'synthetic-local-v1'});
  const bundle=await broker.propose({recipient,brief_id:'default'});
  // The offline fixture has explicit synthetic-only authorization. This is not
  // permission to classify arbitrary private data as safe or to use a live model.
  broker.approve(bundle.export_id,digest(bundle));
  let index=0;
  const result=await designWithRepair({broker,signal,timeoutMs,
    makeDesigner:options=>makeDesigner({...options,contract:{...designContract(options),brief:bundle.design_brief}}),
    inspect:async (generated,control)=>{
      const dir=join(out,`attempt-${index}`);await mkdir(dir);
      const input=join(dir,'candidate.json');await writeFile(input,JSON.stringify(generated,null,2),{mode:0o600});
      const qa=await runQA(input,dir,{entrypoint:new URL('./qa.mjs',import.meta.url),signal:control.signal,timeoutMs:Math.min(qaTimeoutMs,control.timeoutMs)});
      // A leftover/partial evidence file or abnormal exit can never be admitted.
      if(qa.process_exit!==0||qa.version!==deliveryContract||!Array.isArray(qa.records)||!qa.records.length)
        return {pass:false,repair_codes:[],reason:qa.error||'invalid_browser_evidence'};
      return qa;
    },save:async record=>{
      const path=join(out,`attempt-${index++}.json`);await writeFile(path,JSON.stringify(record,null,2),{mode:0o600});return path;
    }});
  const summary={version:'interactive-run/1',variant,release:provenance,state:result.state,
    attempts:result.attempts.map(a=>({attempt:a.attempt,state:a.result.state,pass:a.qa?.pass??false,
      warnings:a.qa?.warnings??[],design_ms:a.design_ms,qa_ms:a.qa_ms,cost_usd:a.result.cost_usd??null,artifact:a.artifact})),audit};
  await writeFile(join(out,'summary.json'),JSON.stringify(summary,null,2),{mode:0o600});
  return summary;
}
