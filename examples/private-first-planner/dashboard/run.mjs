import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';import {pathToFileURL} from 'node:url';
import {ClaudeCode} from '../design/claude.mjs';import {codeSchema} from '../design/contracts.mjs';
import {ExportBroker} from '../host/export.mjs';import {digest,requireThat} from '../contracts.mjs';
import {validateReport} from '../analysis/browser/contract.mjs';import {aggregateReportDocument} from '../analysis/browser/export.mjs';
import {runQA} from '../design/qa-process.mjs';
import {planSchema,validatePlan} from './contracts.mjs';import {planDashboard,frontendUnit,dashboardPipeline} from './units.mjs';
import {behaviors} from './behaviors/index.mjs';import {releaseFor} from './eval.mjs';

export async function runLive(unit,input,config,out){
  requireThat(['dashboard-plan','dashboard-frontend','pipeline'].includes(unit));
  requireThat(config.model==='claude-opus-5-5'&&config.effort==='low'&&config.timeout_ms===240000&&config.frontend_output_tokens===24576&&config.plan_output_tokens===4096);
  const report=validateReport(input.report),scope=input.scope;requireThat(typeof input.question==='string'&&typeof input.definitions==='string');
  requireThat(scope&&/^\d{4}-\d{2}-01$/.test(scope.lower)&&/^\d{4}-\d{2}-01$/.test(scope.upper)&&scope.lower>=report.capabilities.period.lower&&scope.upper<=report.capabilities.period.upper&&scope.lower<scope.upper);
  await mkdir(out,{mode:0o700});const write=(n,v)=>writeFile(join(out,n),JSON.stringify(v,null,2),{flag:'wx',mode:0o600});
  const brief=JSON.stringify({request:input.question,definitions:input.definitions,default_period:scope,capabilities:report.capabilities});
  const binding={command:config.command,model:config.model,baseUrl:config.base_url,timeoutMs:config.timeout_ms};
  const recipient=new ClaudeCode(binding,{apiKey:config.api_key}).recipient;
  const broker=new ExportBroker({ttlMs:900000,policy:{id:'explicit-approved-aggregate-replay',version:'1',briefs:{default:brief},project:async()=>report.payload},current:async()=>null,epoch:'dashboard-split/1',audit:async event=>audit.push(event)});
  const audit=[],calls=[],attempts=[],responses=[],diagnostics=[];let req=0,res=0,diag=0,attempt=0;
  const bundle=await broker.propose({recipient,brief_id:'default'});broker.approve(bundle.export_id,digest(bundle));await write('approved-export.json',bundle);
  await write('manifest.json',{version:'dashboard-live/1',unit,started_at:new Date().toISOString(),data_version:bundle.data_version,input_digest:digest(input),binding:{...binding,effort:config.effort,plan_output_tokens:4096,frontend_output_tokens:24576,cli_budget_usd:.50,grant_ttl_ms:900000},releases:await Promise.all(['dashboard-plan','dashboard-frontend'].map(releaseFor))});
  const adapter=(stage,contract)=>new ClaudeCode(binding,{apiKey:config.api_key,contract:{...contract,brief,effort:'low'},
    observeRequest:async value=>{const n=req++;await write(`request-${n}.json`,value);calls.push({index:n,stage,model:value.model,at:new Date().toISOString()});console.log(JSON.stringify({event:'request',stage,index:n}));},
    observeResult:async value=>{const n=res++;await write(`response-${n}.json`,value);responses.push({index:n,stage,subtype:value.subtype,usage:value.usage??null,cost_usd:value.total_cost_usd??null});},
    observeDiagnostic:async value=>{const n=diag++;await write(`diagnostic-${n}.json`,value);diagnostics.push({index:n,stage,...value});}});
  const planner=adapter('plan',{systemPrompt:behaviors.plan_dashboard.prompt,schema:planSchema,maxOutputTokens:4096});
  const makeDesigner=({plan,attempt=0,diagnostics=[]})=>adapter('frontend',{schema:codeSchema,maxOutputTokens:24576,systemPrompt:behaviors.generate_dashboard_frontend.prompt+
    '\nVALIDATED_PLAN_JSON='+JSON.stringify(plan)+'\nPLAN_DIGEST='+digest(plan)+(attempt?'\nSingle repair: preserve the plan and regenerate the whole frontend. Host categories: '+diagnostics.join(','):'')});
  const inspect=async(generated,control={timeoutMs:60000})=>{const file=join(out,`candidate-${attempt}.json`);await writeFile(file,JSON.stringify(generated,null,2),{flag:'wx',mode:0o600});const qa=await runQA(file,join(out,`qa-${attempt}`),{entrypoint:new URL('browser-qa.mjs',import.meta.url),timeoutMs:Math.min(60000,control.timeoutMs),signal:control.signal});return qa.process_exit===0&&qa.version==='aggregate-design-browser/1'?qa:{pass:false,repair_codes:[],reason:'qa_unavailable',detail:qa};};
  const save=async record=>{const n=attempt++;await write(`attempt-${n}.json`,record);attempts.push(record);if(record.qa?.pass)await writeFile(join(out,'dashboard.html'),aggregateReportDocument(record.result.spec,record.result.bundle,report),{flag:'wx',mode:0o600});return `attempt-${n}.json`;};
  const signal=new AbortController().signal,start=Date.now();let result;
  try{
    if(unit==='dashboard-plan'){result=await planDashboard({broker,planner,report,scope,signal});await write('plan-result.json',result);}
    else if(unit==='dashboard-frontend'){
      requireThat(input.plan);validatePlan(input.plan,{...bundle,export_id:input.plan.export_id},report,scope);
      const plan={...input.plan,export_id:bundle.export_id};await write('rebound-plan.json',{original_digest:digest(input.plan),plan});
      result=await frontendUnit({broker,designer:makeDesigner({plan}),plan,report,scope,signal,inspect});
      await save({result,qa:result.qa,plan_digest:digest(plan)});
    }else result=await dashboardPipeline({broker,planner,makeDesigner,report,scope,signal,savePlan:r=>write('plan-result.json',r),inspect,save});
  }catch(error){result={state:'failed',reason:error.code??error.message};}
  finally{broker.revoke();}
  const record={unit,state:result.state,result,elapsed_ms:Date.now()-start,calls,responses,diagnostics,audit,attempt_count:attempts.length};await write('result.json',record);
  console.log(JSON.stringify({event:'complete',state:record.state,elapsed_ms:record.elapsed_ms,attempts:record.attempt_count}));return record;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [unit,inputPath,configPath,out,allow]=process.argv.slice(2);requireThat(allow==='--allow-cloud'&&out);
 runLive(unit,JSON.parse(await readFile(inputPath,'utf8')),JSON.parse(await readFile(configPath,'utf8')),resolve(out)).catch(e=>{console.error(e.message);process.exitCode=1});
}
