import { readFile, mkdir, writeFile, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { requireThat } from '../contracts.mjs';
import { NemotronPlanner } from '../p1/model.mjs';
import { PrivateSession } from '../p1/session.mjs';
import { connectWren } from '../p1/mcp.mjs';
import { plannerContract, parse } from './planning.mjs';
import { FixtureBroker } from './broker.mjs';
import { ClaudeCode } from './claude.mjs';
import { designDashboard } from './design.mjs';
import { renderPrivateResults } from './render.mjs';

// The grant is operator configuration, never supplied by a model or conversation.
export async function verifyFiles(entries) {
  if(!Array.isArray(entries)||!entries.length) return false;
  for(const entry of entries) {
    try { if(createHash('sha256').update(await readFile(entry.path)).digest('hex')!==entry.sha256) return false; }
    catch {return false;}
  }
  return true;
}
async function main() {
  const [configPath,casePath,outDir]=process.argv.slice(2);
  requireThat(configPath && casePath && outDir);
  const config=JSON.parse(await readFile(configPath,'utf8'));
  const item=JSON.parse(await readFile(casePath,'utf8'));
  requireThat(await verifyFiles(config.fixtureGrant));
  await mkdir(outDir,{mode:0o700});
  const auditFile=await open(join(outDir,'export-audit.jsonl'),'wx',0o600);
  const report={started_at:new Date().toISOString(),model:config.model.id,cloud_model:config.cloud.model,cloud_recipient:config.recipient};
  let port,session,model;const control=new AbortController();
  const onInterrupt=()=>control.abort();process.once('SIGINT',onInterrupt);
  const started=Date.now();
  try {
    port=await connectWren(config.service);
    model=new NemotronPlanner(config.model,{apiKey:process.env[config.model.credentialEnv],decisionContract:plannerContract});
    session=new PrivateSession({port,model,parseDecision:parse});
    let snapshot=await session.start(item.question);
    for(const answer of item.human_answers??[]) {
      if(snapshot.state!=='waiting_for_user') break;
      console.log(JSON.stringify({event:'clarification',source:snapshot.pending.source,question:snapshot.pending.question}));
      snapshot=await session.answer({question_id:snapshot.pending.id,plan_revision:snapshot.pending.plan_revision,answer});
    }
    report.private=snapshot;
    requireThat(snapshot.state==='completed');
    console.log(JSON.stringify({event:'private_complete',presentation:snapshot.plans.at(-1).presentation}));
    if(snapshot.plans.at(-1).presentation==='local_answer') {report.state='local_answer';return;}
    const broker=new FixtureBroker({session,verifySource:()=>verifyFiles(config.fixtureGrant),recipient:config.recipient,
      audit:async record=>{await auditFile.writeFile(JSON.stringify(record)+'\n');await auditFile.sync();}});
    const cloud=new ClaudeCode(config.cloud,{apiKey:process.env[config.cloud.credentialEnv],observeRequest:async body=>{
      const f=await open(join(outDir,'cloud-requests.jsonl'),'a',0o600);
      try {await f.writeFile(JSON.stringify(body)+'\n');await f.sync();}finally{await f.close();}
    }});
    requireThat(cloud.recipient===config.recipient);
    const result=await designDashboard({broker,cloud,signal:control.signal,deadline:Math.min(started+400_000,Date.now()+100_000)});
    report.design={...result,html:undefined};report.state=result.state;
    if(result.state==='completed') {
      await writeFile(join(outDir,'dashboard.html'),result.html,{flag:'wx',mode:0o600});
      await writeFile(join(outDir,'bundle.json'),JSON.stringify(result.bundle,null,2),{flag:'wx',mode:0o600});
      await writeFile(join(outDir,'design.json'),JSON.stringify(result.spec,null,2),{flag:'wx',mode:0o600});
    } else {
      await writeFile(join(outDir,'private-results.html'),renderPrivateResults(snapshot),{flag:'wx',mode:0o600});
      process.exitCode=1;
    }
  } catch {report.state='failed';report.error='dashboard_flow_failed';process.exitCode=1;}
  finally {
    try {if(session) {report.private=session.snapshot();await session.close();}}catch{report.close_error=true;process.exitCode=1;}
    try {if(port) await port.close();}catch{report.transport_close_error=true;process.exitCode=1;}
    report.model_calls=model?.calls??[];report.finished_at=new Date().toISOString();
    await writeFile(join(outDir,'private-report.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
    await auditFile.close();process.removeListener('SIGINT',onInterrupt);
    console.log(JSON.stringify({event:'finished',state:report.state,output:outDir}));
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  main().catch(()=>{console.error('configuration_failed');process.exitCode=1;});
