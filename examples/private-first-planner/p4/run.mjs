import { readFile,mkdir,writeFile,open,readdir,rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join,dirname } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { immutable,requireThat,digest } from '../contracts.mjs';
import { NemotronPlanner } from '../p1/model.mjs';
import { PrivateSession } from '../p1/session.mjs';
import { connectWren } from '../p1/mcp.mjs';
import { scoreData } from '../p1/scoring.mjs';
import { parse } from '../p2/planning.mjs';
import { FixtureBroker,projectFixture } from '../p2/broker.mjs';
import { ClaudeCode } from '../p2/claude.mjs';
import { designDashboard } from '../p2/design.mjs';
import { verifyFiles } from '../p2/run.mjs';
import { protocol,cases,plannerContract,schedule,route,aggregate } from './protocol.mjs';
import { NemotronDesigner } from './private-design.mjs';
import { EvidenceLease } from './evidence.mjs';
import { behaviorProvenance } from '../behaviors/index.mjs';
const write=(path,value)=>writeFile(path,JSON.stringify(value,null,2),{flag:'wx',mode:0o600});
export async function sourceHashes(root) {
  const result={};
  async function visit(dir){for(const entry of await readdir(dir,{withFileTypes:true})){
    if(['node_modules','__pycache__'].includes(entry.name))continue;
    const path=join(dir,entry.name);if(entry.isDirectory())await visit(path);
    else if(entry.isFile())result[path.slice(root.length+1)]=createHash('sha256').update(await readFile(path)).digest('hex');
  }}
  await visit(root);return result;
}
async function main(){
  const [configPath,out]=process.argv.slice(2);requireThat(configPath&&out);
  const config=JSON.parse(await readFile(configPath,'utf8'));requireThat(await verifyFiles(config.fixtureGrant));
  await mkdir(out,{mode:0o700});
  const root=dirname(dirname(fileURLToPath(import.meta.url)));
  const report={protocol,cases,behaviors:behaviorProvenance,started_at:new Date().toISOString(),source_before:await sourceHashes(root),blocks:[],counters:{claude:0,nemotron:0},error:null};
  await write(join(out,'preregistered.json'),{protocol,cases,schedule:schedule(),config,source:report.source_before});
  const save=async()=>{report.summary=aggregate(report.blocks);await writeFile(join(out,'report.tmp'),JSON.stringify(report,null,2),{mode:0o600});await rename(join(out,'report.tmp'),join(out,'report.json'));};
  const deadline=Date.now()+protocol.max_wall_ms;let port;
  try{
    port=await connectWren(config.service);
    for(const [index,entry] of schedule().entries()){
      if(Date.now()>=deadline){report.error='run_deadline';break;}
      const dir=join(out,`block-${String(index+1).padStart(2,'0')}`);await mkdir(dir,{mode:0o700});
      const b={index:index+1,case_id:entry.case.id,repeat:entry.repeat,expected_route:entry.case.expected_route,expected_clarification:entry.case.clarify,arms:[],state:'started',started_at:new Date().toISOString()};report.blocks.push(b);
      console.log(JSON.stringify({event:'block_start',block:b.index,case:b.case_id,repeat:b.repeat}));await save();
      const model=new NemotronPlanner(config.model,{apiKey:process.env[config.model.credentialEnv],decisionContract:plannerContract});
      const session=new PrivateSession({port,model,parseDecision:parse});
      const auditBefore=(await readFile(config.auditPath,'utf8').catch(()=>'' )).split('\n').filter(Boolean).length;
      const started=performance.now();
      try{
        let s=await session.start(entry.case.question);
        for(const answer of entry.case.human_answers){if(s.state!=='waiting_for_user')break;s=await session.answer({question_id:s.pending.id,plan_revision:s.pending.plan_revision,answer});}
        b.private_ms=Math.round(performance.now()-started);b.private=s;b.planner_calls=model.calls;
        b.proposal=s.plans.at(-1)?.presentation??null;b.route_correct=b.proposal===entry.case.expected_route;
        b.clarification_correct=s.questions.some(q=>q.source==='planner')===entry.case.clarify;
        b.data_score=scoreData(s,{groups:2,scalar:770,weekly:[['2025-12-29',50],['2026-01-05',220],['2026-01-12',500]]});
        requireThat(s.state==='completed'&&b.data_score.passed);
        // Only routing is overridden by benchmark mode, never data authorization.
        projectFixture(s,{requireDesignProposal:false});
        const lease=new EvidenceLease(port,s,Math.min(deadline,Date.now()+290_000));
        for(const mode of entry.order){
          const provider=route(mode,b.proposal);requireThat(Date.now()<deadline);
          requireThat(++report.counters[provider] <= (provider==='claude'?protocol.max_claude_invocations:protocol.max_nemotron_designs));
          const armDir=join(dir,mode);await mkdir(armDir,{mode:0o700});
          const audit=await open(join(armDir,'authorization.jsonl'),'wx',0o600);
          let networkRequests=0;
          const designer=provider==='claude'?new ClaudeCode(config.cloud,{apiKey:process.env[config.cloud.credentialEnv],observeRequest:async body=>{
            const f=await open(join(armDir,'cloud-requests.jsonl'),'a',0o600);try{await f.writeFile(JSON.stringify(body)+'\n');await f.sync();networkRequests++;}finally{await f.close();}
          }}):new NemotronDesigner(config.model,{apiKey:process.env[config.model.credentialEnv]});
          const broker=new FixtureBroker({session:lease,verifySource:()=>verifyFiles(config.fixtureGrant),recipient:designer.recipient,requireDesignProposal:false,
            audit:async x=>{await audit.writeFile(JSON.stringify(x)+'\n');await audit.sync();}});
          const armStart=performance.now();let result;
          try{result=await designDashboard({broker,cloud:designer,deadline:Math.min(deadline,Date.now()+100_000)});}
          finally{await audit.close();}
          const arm={mode,provider,position:b.arms.length+1,...result,html:undefined,elapsed_ms:Math.round(performance.now()-armStart),network_requests:networkRequests,
            private_model_calls:provider==='nemotron'?designer.calls:[],artifact:result.html?`${mode}/dashboard.html`:null};
          b.arms.push(arm);
          if(result.html)await writeFile(join(armDir,'dashboard.html'),result.html,{flag:'wx',mode:0o600});
          await write(join(armDir,'result.json'),arm);await save();
          console.log(JSON.stringify({event:'arm_done',block:b.index,mode,provider,state:arm.state,ms:arm.elapsed_ms}));
        }
        b.evidence_calls=lease.calls;b.state=b.arms.every(a=>a.state==='completed')?'completed':'arm_failed';
      }catch{b.state='failed';b.private_ms??=Math.round(performance.now()-started);b.private??=session.snapshot();b.planner_calls??=model.calls;}
      finally{
        try{await session.close();}catch{b.close_error=true;}
        const auditText=await readFile(config.auditPath,'utf8').catch(()=>'' );
        b.worker_calls=auditText.split('\n').filter(Boolean).slice(auditBefore).map(x=>JSON.parse(x)).filter(x=>x.event==='model_call');
        b.finished_at=new Date().toISOString();await write(join(dir,'private-block.json'),b);await save();
        console.log(JSON.stringify({event:'block_done',block:b.index,state:b.state}));
      }
    }
  }catch{report.error='benchmark_failed';}
  finally{
    try{if(port)await port.close();}catch{report.cleanup_error=true;}
    report.finished_at=new Date().toISOString();report.source_after=await sourceHashes(root);
    report.source_unchanged=digest(report.source_before)===digest(report.source_after);await save();
  }
  if(report.error||report.cleanup_error||!report.source_unchanged||report.blocks.length!==8||report.blocks.some(b=>b.state!=='completed'||b.close_error))process.exitCode=1;
  console.log(JSON.stringify({event:'benchmark_done',blocks:report.blocks.length,summary:report.summary,error:report.error}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('benchmark_configuration_failed');process.exitCode=1;});
