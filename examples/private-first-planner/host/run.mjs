import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Store } from './store.mjs';
import { Host } from './controller.mjs';
import { artifactPorts } from './artifacts.mjs';
import { liveHost } from './runtime.mjs';
import { scriptedPorts } from './scripted.mjs';
import { scriptedWren } from './scripted-wren.mjs';
import { serveHost } from './http.mjs';

const [mode, out, configPath] = process.argv.slice(2);
if (!['scripted', 'scripted-wren', 'live'].includes(mode) || !out || (mode !== 'scripted' && !configPath)) {
  throw Error('usage: node host/run.mjs scripted|scripted-wren|live OUTPUT_DIRECTORY [CONFIG_JSON]');
}
const directory = resolve(out); await mkdir(directory, { recursive: true, mode: 0o700 });
let service, host, api;
try {
  if (mode === 'live') host = await liveHost(directory, JSON.parse(await readFile(configPath, 'utf8')));
  else {
    if (mode === 'scripted-wren') service = await scriptedWren(JSON.parse(await readFile(configPath, 'utf8')), join(directory, `service-${Date.now()}`));
    host = new Host(new Store(join(directory, 'state')), { ...scriptedPorts(),
      ...(service ? { worker: service.worker, policy: service.policy } : {}), ...artifactPorts(join(directory, 'artifacts')) });
  }
  const token = randomBytes(32).toString('hex'); api = await serveHost(host, { token });
  const connection = join(directory, 'connection.json');
  await writeFile(connection, JSON.stringify({ url: api.url, token }), { mode: 0o600 });
  console.log(JSON.stringify({ mode, connection, model_quality_measured: false }));
  let closing = false;
  const close = async () => {
    if (closing) return; closing = true;
    try { await api.close(); await host.close(); } finally { await service?.close(); }
  };
  process.once('SIGINT', close); process.once('SIGTERM', close);
} catch (error) { await api?.close(); await host?.close(); await service?.close(); throw error; }
