import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { checkWorkerEnvironment } from '../eval/worker-service.mjs';

const [output, ...paths] = process.argv.slice(2);
if (!output || paths.length !== 5) throw Error('usage: configure-worker.mjs NEW_CONFIG PYTHON WREN WARBLE RUNTIME_JS CONTEXT_LOADER');
const config = Object.fromEntries(['python', 'wren', 'warble', 'runtime', 'context_loader'].map((key, i) => [key, resolve(paths[i])]));
await checkWorkerEnvironment(config);
await writeFile(resolve(output), JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log('Pinned worker tools verified; configuration created without credentials.');
