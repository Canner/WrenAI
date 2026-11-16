import {readFile,mkdir,writeFile,open,rename} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {requireThat,digest} from '../contracts.mjs';
import {NemotronPlanner} from '../p1/model.mjs';
import {PrivateSession} from '../p1/session.mjs';
import {connectWren} from '../p1/mcp.mjs';
import {scoreData} from '../p1/scoring.mjs';
import {parse} from '../p2/planning.mjs';
import {FixtureBroker,projectFixture} from '../p2/broker.mjs';
import {verifyFiles} from '../p2/run.mjs';
import {sourceHashes} from '../p4/run.mjs';
import {plannerContract} from '../p4/intent-planning.mjs';
import {EvidenceLease} from '../p4/evidence.mjs';
import {behaviorProvenance} from '../behaviors/index.mjs';
import {NemotronCodeDesigner,claudeCodeDesigner} from './adapters.mjs';
import {generateCode} from './design.mjs';
import {protocol,cases,briefs,schedule} from './protocol.mjs';
import {runQA} from './qa-process.mjs';
const write=(p,v)=>writeFile(p,JSON.stringify(v,null,2),{flag:'wx',mode:0o600});
export async function main(){
  const [configPath,out]=process.argv.slice(2);requireThat(configPath&&out);
  const config=JSON.parse(await readFile(configPath,'utf8'));requireThat(await verifyFiles(config.fixtureGrant));
  await mkdir(out,{mode:0o700});
  const root=dirname(dirname(fileURLToPath(import.meta.url))),report={protocol,cases,briefs,behaviors:behaviorProvenance,
    started_at:new Date().toISOString(),source_before:await sourceHashes(root),blocks:[],error:null};
  await write(join(out,'preregistered.json'),{protocol,cases,briefs,schedule:schedule(),config,source:report.source_before});
  const save=async()=>{await writeFile(join(out,'report.tmp'),JSON.stringify(report,null,2),{mode:0o600});await rename(join(out,'report.tmp'),join(out,'report.json'));};
  const deadline=Date.now()+protocol.max_wall_ms;let port,invocations=0;
  try {
    port=await connectWren(config.service);
    for(const [i,entry] of schedule().entries()){
      if(Date.now()>=deadline){report.error='run_deadline';break;}
      const dir=join(out,`block-${String(i+1).padStart(2,'0')}`);await mkdir(dir,{mode:0o700});
      const b={index:i+1,case_id:entry.case.id,repeat:entry.repeat,arms:[],state:'started',started_at:new Date().toISOString()};
      report.blocks.push(b);console.log(JSON.stringify({event:'block_start',block:b.index,case:b.case_id}));await save();
      const model=new NemotronPlanner(config.model,{apiKey:process.env[config.model.credentialEnv],decisionContract:plannerContract});
      const session=new PrivateSession({port,model,parseDecision:parse});
      const auditBefore=(await readFile(config.auditPath,'utf8').catch(()=>'' )).split('\n').filter(Boolean).length;
      const start=performance.now();
      try {
        let s=await session.start(entry.case.question);
        for(const answer of entry.case.human_answers){if(s.state!=='waiting_for_user')break;s=await session.answer({question_id:s.pending.id,plan_revision:s.pending.plan_revision,answer});}
        b.private_ms=Math.round(performance.now()-start);b.private=s;b.planner_calls=model.calls;
        b.route_correct=s.plans.at(-1)?.presentation===entry.case.expected_route;
        b.clarification_correct=s.questions.some(q=>q.source==='planner')===entry.case.clarify;
        b.data_score=scoreData(s,{groups:2,scalar:770,weekly:[['2025-12-29',50],['2026-01-05',220],['2026-01-12',500]]});
        requireThat(s.state==='completed'&&b.data_score.passed);projectFixture(s,{requireDesignProposal:false});
        const lease=new EvidenceLease(port,s,Math.min(deadline,Date.now()+290_000));
        for(const provider of entry.order){
          requireThat(Date.now()<deadline&&++invocations<=protocol.max_design_invocations);
          const armDir=join(dir,provider);await mkdir(armDir,{mode:0o700});
          const audit=await open(join(armDir,'authorization.jsonl'),'wx',0o600);let requests=0,envelope;
          const observeRequest=async body=>{const f=await open(join(armDir,'model-requests.jsonl'),'a',0o600);try{await f.writeFile(JSON.stringify(body)+'\n');await f.sync();requests++;}finally{await f.close();}};
          const observeResult=async body=>{envelope=body;await write(join(armDir,'model-output.json'),body);};
          const options={apiKey:process.env[(provider==='claude'?config.cloud:config.model).credentialEnv],brief:briefs[b.case_id],observeRequest,observeResult};
          const designer=provider==='claude'?claudeCodeDesigner(config.cloud,options):new NemotronCodeDesigner(config.model,options);
          const broker=new FixtureBroker({session:lease,verifySource:()=>verifyFiles(config.fixtureGrant),recipient:designer.recipient,requireDesignProposal:false,
            audit:async event=>{await audit.writeFile(JSON.stringify(event)+'\n');await audit.sync();}});
          const armStart=performance.now();let result;
          try{result=await generateCode({broker,designer,deadline:Math.min(deadline,Date.now()+100_000)});}finally{await audit.close();}
          const a={provider,position:b.arms.length+1,...result,generation_ms:Math.round(performance.now()-armStart),network_requests:requests,
            cost_usd:result.cost_usd??envelope?.total_cost_usd??null,usage:result.usage??envelope?.usage??null,
            private_model_calls:provider==='nemotron'?designer.calls:[]};
          b.arms.push(a);
          if(result.state==='generated'){
            const input=join(armDir,'artifact.json');await write(input,{spec:result.spec,bundle:result.bundle});
            a.qa=await runQA(input,armDir);a.state=a.qa.passed?'completed':'quality_failed';
          }
          await write(join(armDir,'result.json'),a);await save();
          console.log(JSON.stringify({event:'arm_done',block:b.index,provider,state:a.state,generation_ms:a.generation_ms}));
        }
        b.evidence_calls=lease.calls;b.state=b.arms.every(a=>a.state==='completed')?'completed':'arm_failed';
      } catch {b.state='data_failed';b.private_ms??=Math.round(performance.now()-start);b.private??=session.snapshot();b.planner_calls??=model.calls;}
      finally {
        try{await session.close();}catch{b.close_error=true;}
        const text=await readFile(config.auditPath,'utf8').catch(()=>'');
        b.worker_calls=text.split('\n').filter(Boolean).slice(auditBefore).map(x=>JSON.parse(x)).filter(x=>x.event==='model_call');
        b.finished_at=new Date().toISOString();await write(join(dir,'private-block.json'),b);await save();
        console.log(JSON.stringify({event:'block_done',block:b.index,state:b.state}));
      }
    }
  } catch {report.error='benchmark_failed';}
  finally {
    try{if(port)await port.close();}catch{report.cleanup_error=true;}
    report.finished_at=new Date().toISOString();report.source_after=await sourceHashes(root);
    report.source_unchanged=digest(report.source_before)===digest(report.source_after);await save();
  }
  if(report.error||report.cleanup_error||!report.source_unchanged||report.blocks.length!==8||report.blocks.some(b=>b.state!=='completed'||b.close_error))process.exitCode=1;
  console.log(JSON.stringify({event:'benchmark_done',blocks:report.blocks.length,error:report.error,states:report.blocks.map(b=>b.state)}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('benchmark_configuration_failed');process.exitCode=1;});
