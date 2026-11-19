import { spawn } from 'node:child_process';
import { mkdir, readdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const gates = ['offline', 'worker-contracts', 'worker-service', 'host-service', 'browser', 'behaviors', 'python', 'interactive'];

// Test setup may download dependencies, but these gates never select a live model.
// Do not pass provider credentials, NODE_OPTIONS or proxy settings to test children.
export function testEnvironment(env = process.env) {
  return Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SYSTEMROOT', 'LANG',
    'PLAYWRIGHT_BROWSERS_PATH', 'WARBLE_BIN'].filter(k => env[k]).map(k => [k, env[k]]));
}
async function testFiles(directory) {
  return (await readdir(join(root, directory))).filter(f => f.endsWith('.test.mjs')).sort().map(f => `${directory}/${f}`);
}
export async function stepsFor(gate, out, configPath) {
  const node = (...args) => [process.execPath, args];
  if (!gates.includes(gate)) throw Error('unknown_gate');
  if (['worker-service', 'host-service', 'python'].includes(gate) && !configPath) throw Error('worker_config_required');
  if (!['worker-service', 'host-service', 'python'].includes(gate) && configPath) throw Error('unexpected_config');
  const workerContracts = async () => [node('--test', ...await testFiles('collaboration/test'), ...await testFiles('worker/test')),
    node('eval/data-validation.mjs', join(out, 'data-verification'))];
  if (gate === 'worker-contracts') return workerContracts();
  if (gate === 'offline') return [
    node('--test', ...(await Promise.all(['planner/test', 'worker/test', 'behaviors/test', 'host/test', 'host/adapters/test', 'eval/test', 'collaboration/test'].map(testFiles))).flat(), 'design/test/contracts.test.mjs', 'design/test/claude.test.mjs', 'design/test/stream.test.mjs', 'interactive/test/contracts.test.mjs', 'revenue/test/contracts.test.mjs', 'revenue/report/contract.test.mjs'),
    node('eval/data-validation.mjs', join(out, 'data-verification')),
    node('eval/run.mjs', 'private-planner', join(out, 'planner')),
    node('eval/run.mjs', 'cloud-planner', join(out, 'cloud')),
  ];
  if (gate === 'worker-service') return [node('eval/run.mjs', 'data-worker', join(out, 'worker'), resolve(configPath))];
  if (gate === 'host-service') return [node('host/verify.mjs', join(out, 'host'), resolve(configPath))];
  if (gate === 'interactive') return [node('--test', 'interactive/test/browser.test.mjs'), node('interactive/run.mjs', join(out, 'suite'))];
  if (gate === 'browser') return [node('--test', 'design/test/browser.test.mjs', 'host/browser.test.mjs', 'revenue/test/browser.test.mjs', 'revenue/report/browser.test.mjs'),
    node('eval/run.mjs', 'cloud-planner', join(out, 'cloud-browser'), '--browser')];
  if (gate === 'behaviors') return [node('behaviors/compile.mjs', '--check'),node('interactive/behaviors/compile.mjs', '--check'),node('revenue/behaviors/compile.mjs', '--check')];
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (typeof config.python !== 'string' || !config.python.startsWith('/')) throw Error('absolute_python_required');
  return [[config.python, ['worker/test/release_compat.py']], [config.python, ['-c',
    "from pathlib import Path; [compile(Path(p).read_text(), p, 'exec') for p in ['worker/prepare.py','eval/prepare-worker.py']]" ]]];
}

export async function main(argv = process.argv.slice(2)) {
  const [gate, directory, configPath] = argv;
  if (argv.length < 2 || argv.length > 3) throw Error('usage: check.mjs GATE NEW_OUTPUT [WORKER_CONFIG]');
  const out = resolve(directory), steps = await stepsFor(gate, out, configPath);
  await mkdir(out, { mode: 0o700 }); // Deliberately refuses an existing result directory.
  const summary = { version: 'collaboration-check/1', gate, mode: 'scripted', node: process.version, steps: [], passed: false };
  for (const [index, [command, args]] of steps.entries()) {
    const start = performance.now(); let stdout = '', stderr = '';
    const status = await new Promise(resolveStatus => {
      const child = spawn(command, args, { cwd: root, env: testEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
      child.on('error', error => { stderr += error.message; });
      child.on('close', (code, signal) => resolveStatus({ code, signal }));
    });
    const log = `step-${index + 1}.log`;
    await writeFile(join(out, log), stdout + stderr, { flag: 'wx', mode: 0o600 });
    summary.steps.push({ command, args, ...status, elapsed_ms: Math.round(performance.now() - start), log });
    await writeFile(join(out, 'summary.json'), JSON.stringify(summary, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ gate, step: index + 1, code: status.code, log }));
    if (status.code !== 0) { process.exitCode = 1; return summary; }
  }
  summary.passed = true;
  await writeFile(join(out, 'summary.json'), JSON.stringify(summary, null, 2), { mode: 0o600 });
  return summary;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  console.error(error.message); process.exitCode = 1;
});
