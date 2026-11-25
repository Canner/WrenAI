import { requireThat } from '../contracts.mjs';
import { validateCode } from './contracts.mjs';

export async function generateCode({broker,designer,deadline=Date.now()+100_000,signal}) {
  let output;
  const control=new AbortController(),abort=()=>control.abort();
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const timer=setTimeout(abort,Math.max(1,deadline-Date.now()));
  const bounded=async promise=>{
    let listener;
    try { return await Promise.race([promise,new Promise((_,reject)=>{
      listener=()=>reject(Error('deadline'));control.signal.addEventListener('abort',listener,{once:true});
      if(control.signal.aborted)listener();
    })]); } finally {control.signal.removeEventListener('abort',listener);}
  };
  try {
    control.signal.throwIfAborted();const bundle=await bounded(broker.prepare());
    requireThat(bundle.recipient===designer.recipient);
    await bounded(broker.authorize(bundle,'send'));control.signal.throwIfAborted();
    output=await bounded(designer.design(bundle,{signal:control.signal,timeoutMs:Math.min(designer.timeoutMs??90_000,deadline-Date.now()),beforeSend:()=>broker.authorize(bundle,'send')}));
    control.signal.throwIfAborted();const spec=validateCode(output.spec,bundle);
    await bounded(broker.authorize(bundle,'use'));control.signal.throwIfAborted();
    return {state:'generated',bundle,spec,usage:output.usage,model_usage:output.model_usage,cost_usd:output.cost_usd,duration_ms:output.duration_ms};
  } catch(error) {return {state:'generation_failed',reason:control.signal.aborted?'cancelled_or_deadline':
    ['cloud_output_limit','cloud_cancelled','cloud_budget_exceeded','cloud_token_limit','cloud_stream_limit','cloud_timeout','cloud_unavailable','cloud_invalid_output','disclosure_denied','planner_failed'].includes(error.message)?error.message:'code_rejected',
    diagnostic:error.diagnostic??null,usage:output?.usage??error.diagnostic?.usage,model_usage:output?.model_usage,cost_usd:output?.cost_usd??error.diagnostic?.cost_usd};}
  finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
