// An independent pi planner with an MCP client. No private profile/context import.
import { readFile, open, lstat, rename, unlink } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Agent } from '@earendil-works/pi-agent-core';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const [configPath, questionsPath, outputPath] = process.argv.slice(2);
if (!configPath || !questionsPath || !outputPath) throw Error('Usage: client.mjs CLIENT_JSON QUESTIONS_JSON OUTPUT_JSON');
const config = JSON.parse(await readFile(configPath));
const questions = JSON.parse(await readFile(questionsPath));
// The operator sets this above the service's effective host IPC wait, including its margin.
const serviceReplyTimeoutMs = config.serviceReplyTimeoutMs;
if (!Number.isInteger(serviceReplyTimeoutMs) || serviceReplyTimeoutMs < 1 || serviceReplyTimeoutMs > 2147483647)
  throw Error('serviceReplyTimeoutMs must be an integer from 1 to 2147483647');
const trace = { turns: [], calls: [], errors: [], completed: false };
async function requireRegularTraceOutput() {
  try {
    if (!(await lstat(outputPath)).isFile()) throw Error('trace_output_not_regular');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
async function writeTrace() {
  if (!Number.isInteger(fsConstants.O_NOFOLLOW)) throw Error('trace_no_follow_unsupported');
  await requireRegularTraceOutput();
  const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
  const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL
    | fsConstants.O_NOFOLLOW | (fsConstants.O_NONBLOCK ?? 0);
  let file, owned = false;
  try {
    file = await open(temporaryPath, flags, 0o600);
    owned = true;
    if (!(await file.stat()).isFile()) throw Error('trace_output_not_regular');
    await file.chmod(0o600);
    await file.writeFile(JSON.stringify(trace, null, 2));
    await file.close();
    file = undefined;
    await requireRegularTraceOutput();
    await rename(temporaryPath, outputPath);
    owned = false;
  } finally {
    try {
      if (file) await file.close();
    } finally {
      if (owned) {
        try { await unlink(temporaryPath); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
  }
}
const client = new Client({ name: 'wren-external-pi-planner', version: '1.0.0' });
// Only the explicitly named private credential reaches the service child.
const env = { PATH: process.env.PATH, ...(config.env ?? {}) };
for (const name of config.serviceCredentialEnv ?? []) if (process.env[name]) env[name] = process.env[name];
const transport = new StdioClientTransport({ command: config.command, args: config.args, env, stderr: 'pipe' });
let totalRequests = 0, turnRequests = 0, toolCalls = 0;
try {
  await client.connect(transport);
  const advertised = (await client.listTools()).tools;
  const tools = advertised.map(t => ({ name: t.name, label: t.name, description: t.description ?? '', parameters: t.inputSchema,
    execute: async (_id, args) => {
      if (++toolCalls > 80) throw Error('tool_budget');
      const result = await client.callTool({ name: t.name, arguments: args }, undefined, { timeout: serviceReplyTimeoutMs });
      const text = result.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
      trace.calls.push({ turn: trace.turns.length, name: t.name, args, result: text });
      return { content: [{ type: 'text', text }], details: {} };
    },
  }));
  const model = { id: config.model ?? 'gpt-6-luna', name: 'external planner', api: 'openai-completions', provider: 'openai',
    baseUrl: config.baseUrl ?? 'https://api.openai.com/v1', reasoning: false, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 65536, maxTokens: 2048 };
  const agent = new Agent({ initialState: { model, tools, systemPrompt: await readFile(config.skill, 'utf8') },
    toolExecution: 'sequential', streamFn: (_m, ctx, opts) => {
      if (++turnRequests > 12 || ++totalRequests > 100) throw Error('model_budget');
      return streamSimple(model, ctx, { ...opts, apiKey: process.env.OPENAI_API_KEY, maxTokens: 2048, onPayload: payload => { if (model.id === 'gpt-6-luna') payload.reasoning_effort = "none"; } });
    },
  });
  for (const question of questions) {
    turnRequests = 0;
    const start = trace.calls.length;
    await agent.prompt(question);
    const last = agent.state.messages.at(-1);
    if (last?.role !== 'assistant' || last.stopReason !== 'stop') { trace.providerError = String(last?.errorMessage ?? last?.stopReason ?? 'missing').replaceAll(process.env.OPENAI_API_KEY ?? 'NO_KEY', '[REDACTED]').slice(0, 500); throw Error('planner_incomplete'); }
    trace.turns.push({ question, answer: last.content.filter(p => p.type === 'text').map(p => p.text).join(''), calls: trace.calls.length - start });
    await writeTrace();
  }
  trace.completed = true;
} catch (error) {
  trace.errors.push(error instanceof Error ? { name: error.name, message: error.message.replaceAll(process.env.OPENAI_API_KEY ?? 'NO_KEY', '[REDACTED]').slice(0, 300) } : 'Error');
  process.exitCode = 1;
} finally {
  trace.requests = totalRequests;
  await client.close();
  await writeTrace();
}
