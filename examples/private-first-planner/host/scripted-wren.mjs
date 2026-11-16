import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { scriptedProvider, checkWorkerEnvironment } from '../eval/worker-service.mjs';
import { wrenWorker } from './runtime.mjs';
import { fixturePolicy } from './policy.mjs';
import { digest, requireThat } from '../contracts.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
function taskFrom(body) {
  const user = body.messages.find(m => m.role === 'user');
  const text = typeof user.content === 'string' ? user.content : user.content.map(c => c.text ?? '').join('');
  const envelope = JSON.parse(text);
  // Root and leaf receive different host envelopes. Read only the actual task,
  // never the model's SQL text or a hidden expected test result.
  const question = envelope.question ?? envelope.delegated_request;
  requireThat(typeof question === 'string');
  return { task: { question, grain: /Grain: week/.test(question) ? 'week' : 'scalar' } };
}
export async function scriptedWren(config, directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const environment = await checkWorkerEnvironment(config), attempts = [];
  const backend = await scriptedProvider(taskFrom, attempt => attempts.push(attempt));
  const fixture = join(directory, 'fixture');
  try {
    await promisify(execFile)(config.python, [resolve(root, 'eval/prepare-worker.py'), fixture, backend.endpoint],
      { timeout: 60_000, maxBuffer: 256 * 1024, env: { PATH: process.env.PATH, HOME: directory } });
    const project = join(fixture, 'project');
    const databasePath = join(fixture, 'data/synthetic.duckdb');
    const fingerprint = digest((await readFile(databasePath)).toString('base64'));
    const workers = new Set();
    const factory = wrenWorker({ command: config.wren, args: ['serve', 'agent', '--project', project,
      '--agent-profile', resolve(root, 'p1/profile'), '--service-config', join(project, 'service.yml'),
      '--runtime', config.runtime, '--warble', config.warble, '--policy-preset', 'full'], credentialEnv: 'HARNESS_EVAL_KEY',
      env: { HOME: directory, WREN_HOME: join(directory, 'wren-home'), WREN_CONTEXT_LOADER_BIN: config.context_loader,
        PATH: `${dirname(process.execPath)}:${process.env.PATH}` } }, 'synthetic-loopback-only');
    return { environment, attempts,
      policy: fixturePolicy(async () => digest((await readFile(databasePath)).toString('base64')) === fingerprint),
      worker: async () => {
        const worker = await factory(); workers.add(worker);
        return { ...worker, close: async () => { try { await worker.close(); } finally { workers.delete(worker); } } };
      },
      close: async () => {
        try { for (const worker of workers) await worker.close(); }
        finally { try { await factory.close(); } finally { await backend.close(); } }
        await writeFile(join(directory, `provider-${randomUUID()}.json`), JSON.stringify(backend.bodies), { flag: 'wx', mode: 0o600 });
        requireThat(!backend.errors.length);
      },
    };
  } catch (error) { await backend.close(); throw error; }
}
