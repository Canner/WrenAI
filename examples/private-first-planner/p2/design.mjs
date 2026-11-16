import { validateDesign } from './contracts.mjs';
import { renderDashboard } from './render.mjs';
import { requireThat } from '../contracts.mjs';
// One cloud draft, no automatic repair or fallback. All waits share this deadline.
export async function designDashboard({broker,cloud,signal,deadline=Date.now()+100_000}) {
  let timer;
  const controller=new AbortController();
  const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted) abort();
  timer=setTimeout(abort,Math.max(1,deadline-Date.now()));
  const bounded=async operation=>{
    controller.signal.throwIfAborted();
    let onAbort;
    try {return await Promise.race([operation, new Promise((_,reject)=>{
      onAbort=()=>reject(Error('deadline'));controller.signal.addEventListener('abort',onAbort,{once:true});
      if(controller.signal.aborted) onAbort();
    })]);} finally {controller.signal.removeEventListener('abort',onAbort);}
  };
  try {
    controller.signal.throwIfAborted();
    const bundle=await bounded(broker.prepare());
    requireThat(bundle.recipient===cloud.recipient);
    await bounded(broker.authorize(bundle,'send'));controller.signal.throwIfAborted();
    const output=await bounded(cloud.design(bundle,{signal:controller.signal,timeoutMs:Math.min(90_000,deadline-Date.now()),
      beforeSend:()=>broker.authorize(bundle,'send')}));
    controller.signal.throwIfAborted();
    const spec=validateDesign(output.spec,bundle);
    await bounded(broker.authorize(bundle,'use'));controller.signal.throwIfAborted();
    return {state:'completed',bundle,spec,html:renderDashboard(spec,bundle),usage:output.usage,
      model_usage:output.model_usage,cost_usd:output.cost_usd,duration_ms:output.duration_ms};
  } catch(error) {
    return {state:'design_unavailable',reason:controller.signal.aborted?'cancelled_or_deadline':
      ['cloud_timeout','cloud_unavailable','cloud_invalid_output','disclosure_denied'].includes(error.message)?error.message:'design_rejected'};
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
