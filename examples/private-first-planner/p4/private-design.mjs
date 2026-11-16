import { NemotronPlanner } from '../p1/model.mjs';
import { designSchema, validateDesign } from '../p2/contracts.mjs';
import { designPrompt } from '../p2/claude.mjs';
import { requireThat } from '../contracts.mjs';
export class NemotronDesigner {
  recipient; #model;
  constructor(config,{apiKey,fetchImpl}={}) {
    this.recipient=`private-designer:${config.id}`;
    this.#model=new NemotronPlanner(config,{apiKey,fetchImpl,decisionContract:{
      tools:[{type:'function',function:{name:'design_dashboard',description:'Return the final dashboard design.',parameters:designSchema}}],
      systemPrompt:designPrompt+' Return through exactly one design_dashboard tool call.',
      parse:(name,args)=>{requireThat(name==='design_dashboard');return {name,args};},
    }});
  }
  get calls(){return this.#model.calls;}
  async design(bundle,{signal,timeoutMs,beforeSend}) {
    signal?.throwIfAborted();await beforeSend();signal?.throwIfAborted();
    const decision=await this.#model.decide({capabilities:[],metadata:null,timeoutMs:Math.min(45_000,timeoutMs),
      conversation:[{role:'user',content:JSON.stringify({export_id:bundle.export_id,data_version:bundle.data_version,payload:bundle.payload})}]});
    signal?.throwIfAborted();
    return {spec:validateDesign(decision.args,bundle),usage:this.calls.at(-1).usage,cost_usd:null};
  }
}
