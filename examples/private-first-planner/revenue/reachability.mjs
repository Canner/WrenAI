// Viewport positioning is UI interaction only. Never change model state or data.
export async function resetHorizontalScroll(frame){await frame.evaluate(()=>{for(const e of document.querySelectorAll('*'))if(e.scrollLeft)e.scrollLeft=0;});}
export async function probeDrillReachability(frame,drills,scope=''){const probes=[];
 for(const d of drills){if(d.ok)continue;let reachable=false;
  try{await frame.locator(`${scope}[data-drill=${JSON.stringify(d.key)}]`).click({trial:true,timeout:1000});reachable=true;}catch{}
  probes.push({key:d.key,reachable,initially_visible:false});if(reachable)d.ok=true;
 }
 await resetHorizontalScroll(frame);return probes;
}
