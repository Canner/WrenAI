import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectWren } from '../p1/mcp.mjs';
import { workerUnit } from './units.mjs';
import { requireThat } from '../contracts.mjs';
import { sha256 } from '../behaviors/artifact.mjs';

const exec = promisify(execFile), root = fileURLToPath(new URL('../', import.meta.url));
const period = "order_date >= TIMESTAMP '2026-01-01' AND order_date < TIMESTAMP '2026-01-19'";
const defaults = "is_test = FALSE AND status IN ('paid','shipped')";
const scalar = `SELECT SUM(amount) FROM orders WHERE ${defaults} AND ${period}`;
const weekly = `SELECT DATE_TRUNC('week',order_date) AS week_start, SUM(amount) AS metric_value FROM orders WHERE ${defaults} AND ${period} GROUP BY DATE_TRUNC('week',order_date) ORDER BY week_start`;
const textOf = content => typeof content === 'string' ? content : (content ?? []).map(c => c.text ?? '').join('');

export async function checkWorkerEnvironment(config) {
  for (const key of ['python', 'wren', 'warble', 'runtime', 'context_loader']) requireThat(typeof config[key] === 'string' && config[key].startsWith('/'));
  const { stdout } = await exec(config.python, ['-c', 'import importlib.metadata as m; print(m.version("wrenai")); print(m.version("sqlglot"))'], { timeout: 10_000 });
  requireThat(stdout.trim() === '0.18.0\n29.0.1');
  const compiler = await exec(config.warble, ['--version'], { timeout: 10_000 });
  requireThat(compiler.stdout.trim() === 'warble 0.21.1');
  const pkg = JSON.parse(await readFile(resolve(config.runtime, '../../package.json'), 'utf8'));
  requireThat(pkg.name === '@warble/pi' && pkg.version === '0.21.1');
  const wren = await exec(config.wren, ['--version'], { timeout: 10_000 });
  requireThat(/\b0\.18\.0\b/.test(wren.stdout));
  return { wren: '0.18.0', sqlglot: '29.0.1', warble: '0.21.1', runtime: pkg.version, node: process.versions.node,
    runtime_entry_sha256: sha256(await readFile(config.runtime)), loader_sha256: sha256(await readFile(config.context_loader)) };
}

// Deliberately scripted transport: it exercises the actual pi loop, tools, Wren
// query gate and evidence ledger, but provides no evidence about model quality.
export function scriptedWorkerReply(body, input) {
  const tools = body.tools.map(t => t.function.name);
  const messages = body.messages, lastTool = messages.filter(m => m.role === 'tool').at(-1);
  const call = (name, args) => ({ tool: { name, args } });
  if (tools.includes('ask_data')) {
    if (!lastTool) return call('ask_data', { request: input.task.question });
    const value = JSON.parse(textOf(lastTool.content));
    return { text: JSON.stringify({ evidence: value.evidence }) };
  }
  if (!lastTool) return call('read_context', { ids: ['orders'] });
  const lastCall = messages.filter(m => m.role === 'assistant' && m.tool_calls?.length).at(-1)?.tool_calls.at(-1).function.name;
  if (lastCall === 'read_context') {
    if (input.task.question.includes('denied')) return call('run_sql', { sql: 'SELECT email FROM customers' });
    const userEnvelope = messages.filter(m => m.role === 'user').map(m => textOf(m.content)).join('\n');
    if (input.task.question.includes('undefined') && !userEnvelope.includes('user_answer')) return call('clarify', { missing: 'analysis_definition' });
    const sql = input.task.grain === 'week' || input.task.question.includes('Wrong-grain') ? weekly : scalar;
    return call('run_sql', { sql });
  }
  const value = JSON.parse(textOf(lastTool.content));
  requireThat(typeof value.evidence === 'string');
  return { text: JSON.stringify({ evidence: value.evidence }) };
}

export async function scriptedProvider(input, observeAttempt) {
  const errors = [], bodies = [];
  const server = createServer(async (request, response) => {
    const start = performance.now(); let status = 'failed';
    try {
      requireThat(request.method === 'POST' && request.url === '/v1/chat/completions');
      let bytes = ''; for await (const chunk of request) { bytes += chunk; requireThat(Buffer.byteLength(bytes) <= 512 * 1024); }
      const body = JSON.parse(bytes); bodies.push(body);
      const taskInput = typeof input === 'function' ? input(body) : input;
      if (taskInput.task.question.includes('Provider-error')) { response.writeHead(503); response.end('scripted unavailable'); return; }
      const reply = scriptedWorkerReply(body, taskInput), id = randomUUID();
      const delta = reply.tool ? { role: 'assistant', tool_calls: [{ index: 0, id, type: 'function', function: {
        name: reply.tool.name, arguments: JSON.stringify(reply.tool.args) } }] } : { role: 'assistant', content: reply.text };
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const chunk = (value, finish = null) => ({ id, object: 'chat.completion.chunk', created: 1, model: body.model,
        choices: [{ index: 0, delta: value, finish_reason: finish }] });
      response.write(`data: ${JSON.stringify(chunk(delta))}\n\n`);
      response.write(`data: ${JSON.stringify({ ...chunk({}, reply.tool ? 'tool_calls' : 'stop'), usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } })}\n\n`);
      response.end('data: [DONE]\n\n'); status = 'completed';
    } catch (error) { errors.push(error.message); if (!response.headersSent) response.writeHead(500); response.end(); }
    finally { observeAttempt({ status, elapsed_ms: Math.round(performance.now() - start),
      input_tokens: status === 'completed' ? 20 : null, output_tokens: status === 'completed' ? 10 : null, cost_usd: null }); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { endpoint: `http://127.0.0.1:${server.address().port}/v1`, errors, bodies,
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

export function workerServiceFactory(config, workRoot) {
  for (const key of ['python', 'wren', 'warble', 'runtime', 'context_loader']) requireThat(typeof config[key] === 'string' && config[key].startsWith('/'));
  return async options => {
    const directory = join(workRoot, randomUUID()); await mkdir(directory, { mode: 0o700 });
    const backend = await scriptedProvider(options.input, options.observeAttempt); let port, unit;
    try {
      await exec(config.python, [resolve(root, 'eval/prepare-worker.py'), join(directory, 'fixture'), backend.endpoint],
        { timeout: 60_000, maxBuffer: 256 * 1024, signal: options.signal,
          env: { PATH: process.env.PATH, HOME: directory } });
      const project = join(directory, 'fixture/project');
      port = await connectWren({ command: config.wren, args: ['serve', 'agent', '--project', project,
        '--agent-profile', resolve(root, 'p1/profile'), '--service-config', join(project, 'service.yml'),
        '--runtime', config.runtime, '--warble', config.warble, '--policy-preset', 'full'],
        credentialEnv: 'HARNESS_EVAL_KEY', env: { HOME: directory, WREN_HOME: join(directory, 'wren-home'),
          WREN_CONTEXT_LOADER_BIN: config.context_loader, PATH: `${dirname(process.execPath)}:${process.env.PATH}` } },
      { credential: 'synthetic-loopback-only' });
      unit = workerUnit({ ...options, port });
      let closing;
      const close = async () => {
        try { await unit.close(); } finally { try { await port.close(); } finally { await backend.close(); } }
        await writeFile(join(directory, 'provider-requests.json'), JSON.stringify(backend.bodies), { flag: 'wx', mode: 0o600 });
        if (backend.errors.length) throw Error('scripted_provider_failed');
      };
      return { traceRefs: [join(directory, 'fixture/audit.jsonl'), join(directory, 'provider-requests.json')], run: () => unit.run(),
        close: () => closing ??= close() };
    } catch (error) {
      try { await port?.close(); } finally { await backend.close(); }
      throw error;
    }
  };
}
