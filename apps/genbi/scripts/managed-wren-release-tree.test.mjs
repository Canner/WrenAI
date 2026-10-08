import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runtimeTreeDigest, relocateEntryPoints } from '../managed-wren/runtime-tree.cjs';
const digest = (bytes) => createHash('sha256').update(bytes).digest('base64url');
function fixture(t, name = 'runtime') {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'managed-tree-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const venv = path.join(root, name, 'venv'); const site = path.join(venv, 'lib/python3.11/site-packages');
  mkdirSync(path.join(site, 'example.dist-info'), { recursive: true }); mkdirSync(path.join(venv, 'bin'));
  const launcher = path.join(venv, 'bin/wren'); const record = path.join(site, 'example.dist-info/RECORD');
  const script = `#!${venv}/bin/python\nfrom wren.cli import app\napp()\n`;
  writeFileSync(launcher, script, { mode: 0o755 });
  const refresh = () => { const bytes = readFileSync(launcher); writeFileSync(record, `../../../bin/wren,sha256=${digest(bytes)},${bytes.length}\r\nexample.dist-info/RECORD,,\r\n`); };
  refresh(); return { root, venv, site, launcher, record, refresh };
}
test('identical installed scripts attest equally across roots and after relocation into spaces', (t) => {
  const a = fixture(t); const b = fixture(t, 'a'.repeat(100));
  const expected = runtimeTreeDigest(a.site); assert.equal(runtimeTreeDigest(b.site), expected);
  const destination = path.join(b.root, 'Application Support'); renameSync(path.dirname(b.venv), destination);
  const site = path.join(destination, 'venv/lib/python3.11/site-packages');
  assert.throws(() => runtimeTreeDigest(site), /selected venv/);
  relocateEntryPoints(site, b.venv, 'wren');
  assert.equal(runtimeTreeDigest(site), expected);
  assert.ok(readFileSync(path.join(destination, 'venv/bin/wren'), 'utf8').startsWith('#!/bin/sh\n'));
});
test('normalization preserves script contents and modes and verifies original RECORD', (t) => {
  const f = fixture(t); const original = runtimeTreeDigest(f.site);
  writeFileSync(f.launcher, readFileSync(f.launcher, 'utf8') + 'print("changed")\n');
  assert.throws(() => runtimeTreeDigest(f.site), /RECORD mismatch/);
  f.refresh(); assert.notEqual(runtimeTreeDigest(f.site), original);
  const changed = runtimeTreeDigest(f.site); chmodSync(f.launcher, 0o700);
  assert.notEqual(runtimeTreeDigest(f.site), changed);
  chmodSync(f.launcher, 0o600); assert.throws(() => runtimeTreeDigest(f.site), /invalid console/);
});
test('foreign interpreters, links, external rows and duplicate owners cannot attest or relocate', (t) => {
  const f = fixture(t); const original = readFileSync(f.launcher);
  writeFileSync(f.launcher, '#!/outside/python\nfrom wren.cli import app\n'); f.refresh();
  assert.throws(() => runtimeTreeDigest(f.site), /selected venv/);
  writeFileSync(f.launcher, original); f.refresh();
  const outside = path.join(f.root, 'outside'); writeFileSync(outside, original, { mode: 0o755 });
  unlinkSync(f.launcher); symlinkSync(outside, f.launcher);
  assert.throws(() => runtimeTreeDigest(f.site), /invalid console/);
  unlinkSync(f.launcher); writeFileSync(f.launcher, original, { mode: 0o755 }); f.refresh();
  const record = readFileSync(f.record, 'utf8'); writeFileSync(f.record, record + '../../../../outside,sha256=bad,1\n');
  assert.throws(() => runtimeTreeDigest(f.site), /invalid external/);
  writeFileSync(f.record, record + record.split('\r\n')[0] + '\r\n');
  assert.throws(() => runtimeTreeDigest(f.site), /invalid external/);
  writeFileSync(f.record, record);
  mkdirSync(path.join(f.site, 'second.dist-info')); writeFileSync(path.join(f.site, 'second.dist-info/RECORD'), record);
  assert.throws(() => relocateEntryPoints(f.site, f.venv, 'wren'), /duplicate console owner/);
  assert.deepEqual(readFileSync(f.launcher), original);
});
