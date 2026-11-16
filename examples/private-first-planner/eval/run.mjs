import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runSuite } from './runner.mjs';
import { suites } from './cases.mjs';
import { scorers, scorerVersion } from './scorers.mjs';
import { scriptedBinding, scriptedPlanner, scriptedCloud } from './scripted.mjs';
import { workerServiceFactory, checkWorkerEnvironment } from './worker-service.mjs';
import { requireThat } from '../contracts.mjs';
import { browserInspector } from './browser.mjs';

export async function main(argv = process.argv.slice(2)) {
  const [harnessId, directory, configPath] = argv;
  requireThat(argv.length >= 2 && argv.length <= 3 && Object.hasOwn(suites, harnessId));
  const out = resolve(directory), binding = structuredClone(scriptedBinding); let createUnit;
  if (harnessId === 'data-worker') {
    requireThat(configPath);
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    const environment = await checkWorkerEnvironment(config);
    binding.runtime = `wren-${environment.wren}+pi-${environment.runtime}+node-${environment.node}`;
    binding.limits.timeout_ms = 180_000;
    binding.limits.max_turns = 12;
    const workRoot = `${out}-services`; await mkdir(workRoot, { mode: 0o700 });
    await writeFile(join(workRoot, 'environment.json'), JSON.stringify(environment, null, 2), { flag: 'wx', mode: 0o600 });
    createUnit = workerServiceFactory(config, workRoot);
  } else {
    requireThat(configPath === undefined || (harnessId === 'cloud-planner' && configPath === '--browser'));
    createUnit = harnessId === 'private-planner' ? scriptedPlanner
      : options => scriptedCloud(options, { inspect: configPath === '--browser' ? browserInspector(out) : undefined });
    if (harnessId === 'cloud-planner') binding.model = 'scripted-cloud-designer';
  }
  const result = await runSuite({ harnessId, out, binding, cases: suites[harnessId],
    createUnit, score: scorers[harnessId], scorerVersion });
  console.log(JSON.stringify(result.summary, null, 2));
  if (result.summary.passed !== result.summary.scheduled) process.exitCode = 1;
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('eval_configuration_or_execution_failed'); process.exitCode = 1; });
}
