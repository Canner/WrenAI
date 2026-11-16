import { NemotronPlanner } from '../p1/model.mjs';
import { ClaudeCode } from '../p2/claude.mjs';
import { behaviors } from '../behaviors/index.mjs';
import { codeSchema } from './contracts.mjs';
import { requireThat } from '../contracts.mjs';

export const codePrompt = behaviors.design_free_dashboard.prompt;
export class NemotronCodeDesigner {
  recipient; #model; #brief;
  constructor(config, { apiKey, brief, fetchImpl = fetch, observeRequest = async()=>{}, observeResult = async()=>{} }) {
    this.recipient = `private-designer:${config.id}`; this.#brief = brief;
    this.#model = new NemotronPlanner({...config,maxTokens:4096,timeoutMs:90_000}, { apiKey,
      fetchImpl: async(url,options) => {
        await observeRequest(JSON.parse(options.body));
        const response = await fetchImpl(url,options);
        const chunks=[];let size=0;
        for await(const chunk of response.body){size+=chunk.length;requireThat(size<=128*1024);chunks.push(Buffer.from(chunk));}
        const bytes=Buffer.concat(chunks),text=bytes.toString('utf8');
        let observed;try{observed=JSON.parse(text);}catch{observed={unparseable:true,raw:text};}
        await observeResult(observed);
        return new Response(bytes,{status:response.status,headers:response.headers});
      },
      decisionContract: { tools:[{type:'function',function:{name:'design_dashboard',description:'Return the complete dashboard frontend.',parameters:codeSchema}}],
        systemPrompt:codePrompt, parse:(name,args)=>{requireThat(name==='design_dashboard');return {name,args};} },
    });
  }
  get calls(){return this.#model.calls;}
  async design(bundle,{signal,timeoutMs,beforeSend}) {
    signal?.throwIfAborted();await beforeSend();signal?.throwIfAborted();
    const d=await this.#model.decide({capabilities:[],metadata:null,timeoutMs,
      conversation:[{role:'user',content:JSON.stringify({export_id:bundle.export_id,data_version:bundle.data_version,payload:bundle.payload,design_brief:this.#brief})}]});
    signal?.throwIfAborted();return {spec:d.args,usage:this.calls.at(-1).usage,cost_usd:null};
  }
}
export function claudeCodeDesigner(config,{apiKey,brief,observeRequest,observeResult}) {
  return new ClaudeCode(config,{apiKey,observeRequest,observeResult,
    contract:{systemPrompt:codePrompt,schema:codeSchema,brief,maxOutputTokens:4096}});
}
