import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { requireThat, immutable, digest } from '../contracts.mjs';
import { designSchema } from './contracts.mjs';
import { behaviors } from '../behaviors/index.mjs';
export const designPrompt = behaviors.design_dashboard.prompt;
export class CloudFailure extends Error {
  constructor(code) { super(code); this.code=code; }
}
export class ClaudeCode {
  #config; #key; #observe; #contract; #observeResult;
  get recipient() { return `claude-code:${this.#config.model}:${digest(this.#config.baseUrl)}`; }
  constructor(config,{apiKey,observeRequest=async()=>{},observeResult=async()=>{},contract={systemPrompt:designPrompt,schema:designSchema}}={}) {
    const url=new URL(config.baseUrl);
    requireThat(isAbsolute(config.command) && typeof config.model==='string' && config.model.length>0
      && ['https:','http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash
      && (url.protocol==='https:' || ['localhost','127.0.0.1'].includes(url.hostname))
      && typeof apiKey==='string' && apiKey.length>0);
    requireThat(typeof contract.systemPrompt==='string' && contract.systemPrompt.length>0 && contract.schema?.type==='object'
      && (contract.maxOutputTokens===undefined || contract.maxOutputTokens===4096)
      && (contract.brief===undefined || typeof contract.brief==='string'));
    this.#config=immutable(config);this.#key=apiKey;this.#observe=observeRequest;
    this.#contract=immutable(contract);this.#observeResult=observeResult;
  }
  async design(bundle,{signal,timeoutMs=90_000,beforeSend}={}) {
    signal?.throwIfAborted();
    requireThat(bundle.recipient === this.recipient);
    const version = await promisify(execFile)(this.#config.command,['--version'],{timeout:5000,maxBuffer:4096,
      env:{PATH:process.env.PATH,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'}});
    requireThat(version.stdout.trim() === '2.1.309 (Claude Code)');
    signal?.throwIfAborted();
    const dir=await mkdtemp(join(tmpdir(),'dashboard-cloud-'));
    const args=['--print','--bare','--safe-mode','--no-chrome','--disable-slash-commands',
      '--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}',
      '--setting-sources','','--settings','{"disableAllHooks":true}',
      '--no-session-persistence','--permission-mode','dontAsk','--output-format','json',
      '--model',this.#config.model,'--max-budget-usd','0.50',
      ...(this.#contract.maxOutputTokens?['--effort','medium']:[]),
      '--system-prompt',this.#contract.systemPrompt,'--json-schema',JSON.stringify(this.#contract.schema)];
    const prompt=JSON.stringify({export_id:bundle.export_id,data_version:bundle.data_version,payload:bundle.payload,...(this.#contract.brief===undefined?{}:{design_brief:this.#contract.brief})});
    // Reauthorize every HTTP attempt, including retries internal to the CLI.
    // The child sees only this per-invocation gateway and a disposable local key.
    const transportControl=new AbortController();
    const transportSignal=AbortSignal.any([transportControl.signal,...(signal?[signal]:[]),AbortSignal.timeout(Math.max(1,Math.min(timeoutMs,90_000)))]);
    let requests=0;
    const gateway=createServer(async(req,res)=>{
      try {
        requireThat(req.method==='POST' && req.url?.split('?')[0]==='/v1/messages' && ++requests<=3);
        let body='',bytes=0;for await(const chunk of req){bytes+=chunk.length;requireThat(bytes<=128*1024);body+=chunk;}
        const value=JSON.parse(body);
        requireThat(value.model===this.#config.model && Array.isArray(value.tools)
          && value.tools.length===1 && value.tools[0].name==='StructuredOutput'
          && digest(value.tools[0].input_schema)===digest(this.#contract.schema));
        requireThat(value.messages?.[0]?.role==='user' && value.messages[0].content?.length===1
          && value.messages[0].content[0].type==='text' && value.messages[0].content[0].text===prompt);
        requireThat(Array.isArray(value.system) && value.system.length===3
          && /^x-anthropic-billing-header: cc_version=2\.1\.309\.[a-f0-9]+; cc_entrypoint=sdk-cli;$/.test(value.system[0].text)
          && value.system[1].text==='You are a Claude agent, built on Anthropic\'s Claude Agent SDK.'
          && value.system[2].text===this.#contract.systemPrompt);
        requireThat(typeof beforeSend==='function');
        if(this.#contract.maxOutputTokens) requireThat(value.max_tokens===this.#contract.maxOutputTokens
          && value.thinking?.type==='adaptive' && value.output_config?.effort==='medium');
        await this.#observe(immutable(value));transportSignal.throwIfAborted();
        await beforeSend();transportSignal.throwIfAborted();
        const upstream=await fetch(`${this.#config.baseUrl.replace(/\/$/,'')}${req.url}`,{
          method:'POST',redirect:'error',signal:transportSignal,
          headers:{'content-type':'application/json','x-api-key':this.#key,
            'anthropic-version':String(req.headers['anthropic-version']??'2023-06-01'),
            ...(req.headers['anthropic-beta']?{'anthropic-beta':String(req.headers['anthropic-beta'])}:{})},body});
        res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')??'application/json'});
        let received=0;
        for await(const chunk of upstream.body){received+=chunk.length;requireThat(received<=256*1024);res.write(chunk);}
        res.end();
      } catch {
        if(!res.headersSent) res.writeHead(403,{'content-type':'application/json'});
        res.end(JSON.stringify({type:'error',error:{type:'permission_error',message:'Cloud request denied'}}));
      }
    });
    await new Promise((resolve,reject)=>{gateway.once('error',reject);gateway.listen(0,'127.0.0.1',resolve);});
    // Explicit environment: no database/NVIDIA keys, parent settings or hooks.
    const env={PATH:process.env.PATH, TMPDIR:tmpdir(), CLAUDE_CONFIG_DIR:dir,
      ANTHROPIC_BASE_URL:`http://127.0.0.1:${gateway.address().port}`, ANTHROPIC_API_KEY:'isolated-design-worker',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1', DISABLE_AUTOUPDATER:'1',
      ...(this.#contract.maxOutputTokens?{CLAUDE_CODE_MAX_OUTPUT_TOKENS:String(this.#contract.maxOutputTokens)}:{})};
    try {
      const result=await new Promise((resolve,reject)=>{
        const child=spawn(this.#config.command,args,{cwd:dir,env,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32'});
        let output='',bytes=0,stderrBytes=0,failure=null;
        const stop=(code)=>{
          if (failure) return;failure=new CloudFailure(code);
          try { if(process.platform==='win32') child.kill('SIGKILL');else process.kill(-child.pid,'SIGKILL'); } catch {}
        };
        const onAbort=()=>stop('cloud_cancelled');
        const timer=setTimeout(()=>stop('cloud_timeout'),Math.max(1,Math.min(timeoutMs,90_000)));
        signal?.addEventListener('abort',onAbort,{once:true});
        if(signal?.aborted) onAbort();
        child.stdin.on('error',()=>{});
        child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>128*1024) stop('cloud_output_limit');else output+=chunk.toString();});
        child.stderr.on('data',chunk=>{stderrBytes+=chunk.length;if(stderrBytes>128*1024) stop('cloud_output_limit');});
        const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);};
        child.on('error',()=>{cleanup();reject(new CloudFailure('cloud_unavailable'));});
        child.on('close',code=>{cleanup();if(failure) reject(failure);else if(code!==0) reject(new CloudFailure('cloud_unavailable'));else resolve(output);});
        child.stdin.end(prompt);
      });
      let envelope;try {envelope=JSON.parse(result);} catch {throw new CloudFailure('cloud_invalid_output');}
      await this.#observeResult(immutable(envelope));
      if(envelope.type!=='result' || envelope.is_error || envelope.subtype!=='success') throw new CloudFailure('cloud_invalid_output');
      // Structured output is authoritative; never fall back to executing markdown/code.
      requireThat(envelope.structured_output && typeof envelope.structured_output==='object');
      return { spec:envelope.structured_output, usage:envelope.usage ?? null,
        model_usage:envelope.modelUsage ?? null, cost_usd:envelope.total_cost_usd ?? null,
        duration_ms:envelope.duration_ms ?? null };
    } finally {transportControl.abort();gateway.closeAllConnections();await new Promise(resolve=>gateway.close(resolve));await rm(dir,{recursive:true,force:true});}
  }
}
