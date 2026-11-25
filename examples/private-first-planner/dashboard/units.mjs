import { performance } from 'node:perf_hooks';
import { digest, requireThat } from '../contracts.mjs';
import { generateCode } from '../design/design.mjs';
import { designWithRepair } from '../host/cloud.mjs';
import { validatePlan, scorePlan } from './contracts.mjs';

export async function planDashboard({broker,planner,report,scope,signal,timeoutMs=240_000}){
  const start=performance.now();let output;
  const bounded=AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]);
  const wait=async promise=>{let listener;try{return await Promise.race([promise,new Promise((_,reject)=>{listener=()=>reject(Error('deadline'));bounded.addEventListener('abort',listener,{once:true});if(bounded.aborted)listener();})]);}finally{bounded.removeEventListener('abort',listener);}};
  try{
    bounded.throwIfAborted();const bundle=await wait(broker.prepare());await wait(broker.authorize(bundle,'send'));
    output=await wait(planner.design(bundle,{signal:bounded,timeoutMs,beforeSend:()=>broker.authorize(bundle,'send')}));
    bounded.throwIfAborted();const plan=validatePlan(output.spec,bundle,report,scope);await wait(broker.authorize(bundle,'use'));bounded.throwIfAborted();
    return {state:'planned',plan,plan_digest:digest(plan),score:scorePlan(plan),usage:output.usage,cost_usd:output.cost_usd,diagnostic:output.diagnostic,elapsed_ms:Math.round(performance.now()-start)};
  }catch(error){return {state:'planning_failed',reason:bounded.aborted?'cancelled_or_deadline':error.code??'plan_rejected',
    diagnostic:error.diagnostic??null,usage:output?.usage??error.diagnostic?.usage??null,cost_usd:output?.cost_usd??error.diagnostic?.cost_usd??null,elapsed_ms:Math.round(performance.now()-start)};}
}

// Independent frontend evaluation: the caller supplies a frozen validated plan.
export async function frontendUnit({broker,designer,plan,report,scope,signal,timeoutMs=240_000,inspect}){
  const bundle=await broker.prepare();validatePlan(plan,bundle,report,scope);
  const result=await generateCode({broker,designer,signal,deadline:Date.now()+timeoutMs});
  const qa=result.state==='generated'&&inspect?await inspect({...result,plan,report}):null;
  return {...result,plan_digest:digest(plan),qa};
}

// Host orchestration is explicit. Planning failure cannot silently bypass the plan.
export async function dashboardPipeline({broker,planner,makeDesigner,report,scope,signal,savePlan,inspect,save,planTimeoutMs=240_000,frontendTimeoutMs=600_000}){
  const planned=await planDashboard({broker,planner,report,scope,signal,timeoutMs:planTimeoutMs});await savePlan(planned);
  if(planned.state!=='planned')return {state:'planning_failed',planned,attempts:[]};
  const plan=planned.plan,bundle=await broker.prepare();requireThat(bundle.data_version===plan.data_version);
  const result=await designWithRepair({broker,signal,timeoutMs:frontendTimeoutMs,
    makeDesigner:args=>makeDesigner({...args,plan}),inspect:(generated,control)=>inspect({...generated,plan,report},control),
    save:record=>save({...record,plan_digest:digest(plan)})});
  return {...result,planned};
}
