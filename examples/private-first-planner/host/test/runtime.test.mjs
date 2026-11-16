import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { prepareServiceConfig } from '../runtime.mjs';

test('relocated service preserves policy bytes, presets and project-relative database while isolating audit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'host-service-'));
  try {
    const source = join(root, 'project'), out = join(root, 'run'); await mkdir(source);
    const config = { policy: 'base.cedar', policy_presets: { full: { policy: 'full.cedar', metadata_selection: ['rules'] } },
      connection: { url: '../data' }, audit_path: '/old/audit.jsonl' };
    const bytes = JSON.stringify(config); await writeFile(join(source, 'service.json'), bytes);
    await writeFile(join(source, 'base.cedar'), 'base policy\n'); await writeFile(join(source, 'full.cedar'), 'preset policy\n');
    const input = { args: ['serve', 'agent', '--project', source, '--service-config', join(source, 'service.json')] };
    const prepared = await prepareServiceConfig(out, input);
    assert.equal(await readFile(join(source, 'service.json'), 'utf8'), bytes);
    assert.equal(await readFile(join(out, prepared.serviceConfig.policy), 'utf8'), 'base policy\n');
    assert.equal(await readFile(join(out, prepared.serviceConfig.policy_presets.full.policy), 'utf8'), 'preset policy\n');
    assert.deepEqual(prepared.serviceConfig.connection, config.connection);
    assert.deepEqual(prepared.serviceConfig.policy_presets.full.metadata_selection, ['rules']);
    assert.equal(dirname(prepared.serviceConfig.audit_path), out);
    assert.equal(prepared.args.at(-1), prepared.servicePath);
    assert.equal(input.args.at(-1), join(source, 'service.json'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('policy relocation rejects traversal, absolute references and symlink escapes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'host-service-'));
  try {
    const source = join(root, 'project'); await mkdir(source);
    await writeFile(join(root, 'outside.cedar'), 'outside');
    await symlink(join(root, 'outside.cedar'), join(source, 'escape.cedar'));
    for (const [index, policy] of ['../outside.cedar', join(root, 'outside.cedar'), 'escape.cedar'].entries()) {
      await writeFile(join(source, 'service.json'), JSON.stringify({ policy }));
      await assert.rejects(prepareServiceConfig(join(root, `out-${index}`), { args: ['--service-config', join(source, 'service.json')] }));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
