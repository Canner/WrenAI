import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { admitBehaviors, compilerVersion, sha256, sourceHashes } from '../../behaviors/artifact.mjs';

import { behaviorContract } from './contract.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--check') || args.length > 1) throw Error('usage: node dashboard/behaviors/compile.mjs [--check]');
const command = process.env.WARBLE_BIN || 'warble';
const run = argv => execFileSync(command, argv, { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 });
if (run(['--version']).trim() !== compilerVersion) throw Error(`requires ${compilerVersion}`);
const source = join(root, 'profile'), before = sourceHashes(source);
const temp = mkdtempSync(join(tmpdir(), 'private-first-behaviors-'));
try {
  run(['compile', source, '--out', join(temp, 'ir.json')]);
  const ir = JSON.parse(readFileSync(join(temp, 'ir.json'), 'utf8'));
  admitBehaviors(ir, behaviorContract);
  if (!isDeepStrictEqual(before, sourceHashes(source))) throw Error('behavior_sources_changed_during_compile');
  const bytes = JSON.stringify(ir, null, 2) + '\n';
  const manifest = JSON.stringify({ compiler: compilerVersion, ir_sha256: sha256(bytes), sources: before }, null, 2) + '\n';
  if (args.includes('--check')) {
    if (bytes !== readFileSync(join(root, 'compiled/ir.json'), 'utf8')
        || manifest !== readFileSync(join(root, 'compiled/manifest.json'), 'utf8')) throw Error('behavior_compile_drift');
  } else {
    mkdirSync(join(root, 'compiled'), { recursive: true });
    writeFileSync(join(root, 'compiled/ir.json'), bytes);
    writeFileSync(join(root, 'compiled/manifest.json'), manifest);
  }
  console.log(JSON.stringify({ compiler: compilerVersion, components: ir.components.map(c => c.id), check: args.includes('--check') }));
} finally { rmSync(temp, { recursive: true, force: true }); }
