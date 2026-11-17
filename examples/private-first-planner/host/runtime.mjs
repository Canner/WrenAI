import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import { connectWren } from '../worker/mcp.mjs';
import { WorkerSession } from '../harnesses/worker.mjs';
import { ClaudeCode } from '../design/claude.mjs';
import { codeSchema } from '../design/contracts.mjs';
import { behaviors } from '../behaviors/index.mjs';
import { digest, requireThat } from '../contracts.mjs';
import { Store } from './store.mjs';
import { Host } from './controller.mjs';
import { PiPlanner, privateModel } from './pi.mjs';
import { fixturePolicy } from './policy.mjs';
import { artifactPorts } from './artifacts.mjs';

export function wrenWorker(config, credential) {
  let connection;
  const factory = async () => {
    const port = await (connection ??= connectWren(config, { credential }));
    const worker = new WorkerSession(port); let closing;
    return { context: () => worker.context(), execute: (...args) => worker.execute(...args),
      reauthorize: results => worker.reauthorize(results),
      close: () => closing ??= worker.close() };
  };
  factory.close = async () => { if (connection) await (await connection).close(); };
  return factory;
}
export function cloudFactory(config, apiKey, observers = {}) {
  const make = ({ bundle, attempt = 0, diagnostics = [] } = {}) => new ClaudeCode(config, { apiKey,
    observeRequest: body => observers.cloudRequest?.({ attempt, body }),
    observeResult: body => observers.cloudResult?.({ attempt, body }),
    contract: { systemPrompt: behaviors[attempt ? 'repair_dashboard' : 'design_free_dashboard'].prompt,
      schema: codeSchema, maxOutputTokens: 4096,
      brief: (bundle?.design_brief ?? '') + (attempt ? `\nRepair checks: ${diagnostics.join(', ')}` : '') } });
  return { recipient: make().recipient, makeDesigner: make };
}
export async function prepareServiceConfig(directory, wren) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const args = [...wren.args], index = args.indexOf('--service-config');
  requireThat(index >= 0 && index + 1 < args.length);
  const source = resolve(args[index + 1]), root = await realpath(dirname(source));
  const serviceConfig = parseYaml(await readFile(source, 'utf8'));
  const run = randomUUID(), copies = new Map();
  const contained = path => { const rel = relative(root, path); return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel); };
  async function copyPolicy(value) {
    requireThat(typeof value === 'string' && !isAbsolute(value));
    const path = resolve(root, value);
    requireThat(contained(path));
    const target = await realpath(path); requireThat(contained(target));
    if (!copies.has(target)) {
      const name = `policy-${run}-${copies.size}.cedar`;
      await writeFile(join(directory, name), await readFile(target), { flag: 'wx', mode: 0o600 });
      copies.set(target, name);
    }
    return copies.get(target);
  }
  serviceConfig.policy = await copyPolicy(serviceConfig.policy);
  if (serviceConfig.preset_policy) serviceConfig.preset_policy = await copyPolicy(serviceConfig.preset_policy);
  for (const preset of Object.values(serviceConfig.policy_presets ?? {})) {
    if (preset.policy) preset.policy = await copyPolicy(preset.policy);
  }
  const servicePath = join(resolve(directory), `service-${run}.json`);
  serviceConfig.audit_path = join(resolve(directory), `audit-${run}.jsonl`);
  await writeFile(servicePath, JSON.stringify(serviceConfig), { flag: 'wx', mode: 0o600 });
  args[index + 1] = servicePath;
  return { args, serviceConfig, servicePath };
}
export async function liveHost(directory, config, { policy, observers = {} } = {}) {
  // No auto-discovered credentials and no permissive default real-data policy.
  const plannerKey = process.env[config.planner.credentialEnv];
  const workerKey = process.env[config.wren.credentialEnv];
  const cloudKey = config.claude ? process.env[config.claude.credentialEnv] : null;
  requireThat([plannerKey, workerKey].every(x => typeof x === 'string' && x.length));
  if (config.claude) requireThat(typeof cloudKey === 'string' && cloudKey.length);
  if (!policy) {
    requireThat(config.synthetic_files && Object.keys(config.synthetic_files).length > 0);
    policy = fixturePolicy(async () => {
      for (const [path, expected] of Object.entries(config.synthetic_files)) {
        if (digest((await readFile(path)).toString('base64')) !== expected) return false;
      }
      return true;
    });
  }
  const { args, serviceConfig } = await prepareServiceConfig(directory, config.wren);
  const worker = wrenWorker({ ...config.wren, args }, workerKey);
  return new Host(new Store(join(directory, 'state')), { policy,
    bindings: { planner: { id: config.planner.id, endpoint_digest: digest(config.planner.baseUrl), runtime: 'pi-agent-core/1.0.4' },
      worker: { service_config_digest: digest(serviceConfig) }, cloud: config.claude ? { model: config.claude.model, endpoint_digest: digest(config.claude.baseUrl) } : null },
    planner: new PiPlanner({ model: privateModel(config.planner), apiKey: plannerKey,
      maxTokens: config.planner.maxTokens ?? 1536, timeoutMs: config.planner.timeoutMs ?? 45_000,
      observeRequest: observers.plannerRequest, observeResult: observers.plannerResult }),
    worker, closeResources: () => worker.close(), ...(config.claude ? cloudFactory(config.claude, cloudKey, observers) : {}),
    ...artifactPorts(join(directory, 'artifacts')) });
}
