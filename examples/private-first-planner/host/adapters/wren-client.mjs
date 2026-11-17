// Host-owned stdio client for wren serve agent; this does not implement an MCP server.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { requireThat } from '../../contracts.mjs';

const required = ['capabilities', 'open_session', 'close_session', 'read_metadata', 'ask_data', 'continue_task', 'get_evidence'];
export async function connectWren(config, { credential = process.env[config.credentialEnv] } = {}) {
  requireThat(typeof config.command === 'string' && Array.isArray(config.args)
    && typeof config.credentialEnv === 'string' && typeof credential === 'string' && credential.length > 0);
  const client = new Client({ name: 'private-first-nemotron-eval', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: config.command, args: config.args,
    env: { PATH: process.env.PATH, ...config.env, [config.credentialEnv]: credential }, stderr: 'pipe' });
  // Drain diagnostics, but never put raw service stderr into the model context or console.
  let stderrBytes = 0;
  try {
    await client.connect(transport);
    transport.stderr?.on('data', chunk => { stderrBytes += chunk.length; });
    const names = (await client.listTools()).tools.map(t => t.name);
    requireThat(required.every(name => names.includes(name)) && !names.includes('run_sql'));
    return {
      tools: names,
      async call(name, args, { timeoutMs }) {
        requireThat(required.includes(name));
        const reply = await client.callTool({ name, arguments: args }, undefined,
          { timeout: Math.min(config.timeoutMs ?? 180_000, timeoutMs) });
        if (reply.isError) throw Error('mcp_tool_error');
        const text = reply.content.filter(x => x.type === 'text');
        requireThat(text.length === 1 && Buffer.byteLength(text[0].text) <= 256 * 1024);
        return JSON.parse(text[0].text);
      },
      async close() { await client.close(); },
      diagnostics() { return { stderr_bytes: stderrBytes }; },
    };
  } catch { await client.close(); throw Error('mcp_startup_failed'); }
}
