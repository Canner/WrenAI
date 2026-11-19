import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ClaudeCode, designPrompt, maxSseBytes } from '../claude.mjs';
import { codeSchema } from '../contracts.mjs';

test('wire budget admits a valid SSE stream above 256 KiB, caps larger streams and preserves send authorization', async () => {
  for (const bytes of [334000, maxSseBytes + 10000]) {
    let sent = 0, auth = 0;
    const server = createServer(async (req, res) => { let body = ''; for await (const b of req) body += b;
      const value = JSON.parse(body); assert.equal(value.max_tokens, 12288); sent++;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end('event: ping\ndata: {"type":"ping"}' + ' '.repeat(bytes) + '\n\ndata: [DONE]\n\n');
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const dir = await mkdtemp(join(tmpdir(), 'sse-budget-')), command = join(dir, 'cli');
    try {
      await writeFile(command, `#!${process.execPath}
if(process.argv.includes('--version')){console.log('2.1.309 (Claude Code)');process.exit(0);}
let prompt='';for await(const c of process.stdin)prompt+=c;
const body={model:'offline',max_tokens:Number(process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS),thinking:{type:'adaptive'},output_config:{effort:'medium'},
messages:[{role:'user',content:[{type:'text',text:prompt}]}],tools:[{name:'StructuredOutput',input_schema:JSON.parse(process.argv[process.argv.indexOf('--json-schema')+1])}],
system:[{text:'x-anthropic-billing-header: cc_version=2.1.309.abc; cc_entrypoint=sdk-cli;'},{text:"You are a Claude agent, built on Anthropic's Claude Agent SDK."},{text:${JSON.stringify(designPrompt)}}]};
const response=await fetch(process.env.ANTHROPIC_BASE_URL+'/v1/messages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const stream=await response.text();if(!stream.endsWith('data: [DONE]\\n\\n'))process.exit(1);
console.log(JSON.stringify({type:'result',subtype:'success',structured_output:{html:'complete'},usage:{output_tokens:1}}));
`, { mode: 0o700 });
      const model = new ClaudeCode({ command, model: 'offline', baseUrl: `http://127.0.0.1:${server.address().port}` }, {
        apiKey: 'offline', contract: { systemPrompt: designPrompt, schema: codeSchema, maxOutputTokens: 12288 } });
      const run = () => model.design({ recipient: model.recipient, payload: { synthetic: true } }, { beforeSend: async () => { auth++; } });
      if (bytes < maxSseBytes) assert.equal((await run()).spec.html, 'complete'); else await assert.rejects(run(), /cloud_unavailable/);
      assert.equal(sent, 1); assert.equal(auth, 1);
    } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); await rm(dir, { recursive: true, force: true }); }
  }
});
