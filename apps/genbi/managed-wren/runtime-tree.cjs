// Shared release/provision attestation. Only verified venv prefixes are canonicalized.
const { createHash } = require('node:crypto');
const { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const hash = (bytes, encoding = 'hex') => createHash('sha256').update(bytes).digest(encoding);
const inside = (root, file) => { const relative = path.relative(root, file); return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)); };
const quote = (text) => "'" + text.replaceAll("'", "'\\''") + "'";
function entryPoint(file, venv) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(file) !== file || !(stat.mode & 0o111)) throw new Error('invalid console entrypoint');
  const bytes = readFileSync(file); const text = bytes.toString('utf8');
  if (!Buffer.from(text).equals(bytes)) throw new Error('invalid console encoding');
  for (const name of ['python', 'python3', 'python3.11']) {
    const interpreter = path.join(venv, 'bin', name);
    for (const prefix of [`#!${interpreter}\n`, ...[interpreter, `"${interpreter}"`, quote(interpreter)].map((executable) => `#!/bin/sh\n'''exec' ${executable} "$0" "$@"\n' '''\n`)]) {
      if (!text.startsWith(prefix)) continue;
      const body = text.slice(prefix.length);
      const canonical = Buffer.from(`#!<venv>/bin/${name}\n${body}`);
      return { bytes, body, name, canonical, mode: stat.mode & 0o777 };
    }
  }
  throw new Error('console interpreter is not the selected venv');
}
function recordRows(file, sitePackages, interpreterVenv) {
  const venv = path.resolve(sitePackages, '../../..');
  if (realpathSync(venv) !== venv || realpathSync(path.join(venv, 'bin')) !== path.join(venv, 'bin')) throw new Error('console directory link');
  const text = readFileSync(file, 'utf8');
  const seen = new Set();
  return text.split(/\r?\n/).map((line) => {
    if (!line.startsWith('../') || /^\.\.\/\.\.\/\.\.\/bin\/__pycache__\/[A-Za-z0-9._-]+\.pyc,,$/.test(line)) return { line };
    const match = /^(\.\.\/\.\.\/\.\.\/bin\/[A-Za-z0-9._-]+),sha256=([A-Za-z0-9_-]+),(\d+)$/.exec(line);
    if (!match || seen.has(match[1])) throw new Error('invalid external RECORD entry');
    seen.add(match[1]);
    const target = path.resolve(sitePackages, match[1]);
    const script = entryPoint(target, interpreterVenv ?? venv);
    if (hash(script.bytes, 'base64url') !== match[2] || String(script.bytes.length) !== match[3]) throw new Error('console RECORD mismatch');
    return { line, relative: match[1], target, script };
  });
}
function records(sitePackages) {
  return readdirSync(sitePackages).filter((name) => name.endsWith('.dist-info')).sort().map((name) => path.join(sitePackages, name, 'RECORD'));
}
function runtimeTreeDigest(root) {
  const entries = [];
  function visit(directory) {
    for (const name of readdirSync(directory).sort()) {
      if (name === '__pycache__') continue;
      const file = path.join(directory, name); const stat = lstatSync(file);
      const relative = path.relative(root, file); const mode = (stat.mode & 0o777).toString(8);
      if (stat.isSymbolicLink()) {
        if (!inside(root, realpathSync(file))) throw new Error('runtime link escapes tree');
        entries.push(`${relative}\0${mode}\0link\0${readlinkSync(file)}`);
      } else if (stat.isDirectory()) visit(file);
      else if (stat.isFile()) {
        let bytes = readFileSync(file);
        if (path.basename(root) === 'site-packages' && /^[^/]+\.dist-info\/RECORD$/.test(relative)) {
          bytes = Buffer.from(recordRows(file, root).map((row) => row.script
            ? `${row.relative},sha256=${hash(Buffer.concat([Buffer.from(`${row.script.mode}\0`), row.script.canonical]), 'base64url')},${row.script.canonical.length}`
            : row.line).join('\n'));
        }
        entries.push(`${relative}\0${mode}\0file\0${hash(bytes)}`);
      } else throw new Error('unsupported runtime entry');
    }
  }
  visit(root); return hash(entries.join('\n'));
}
function relocateEntryPoints(sitePackages, previousVenv, ownedLauncher) {
  const venv = path.resolve(sitePackages, '../../..');
  // Validate all records before changing any file.
  const plans = records(sitePackages).map((file) => ({ file, rows: recordRows(file, sitePackages, previousVenv) }));
  const claimed = new Set();
  for (const plan of plans) for (const row of plan.rows) if (row.script) {
    if (claimed.has(row.target)) throw new Error('duplicate console owner');
    claimed.add(row.target);
  }
  if (ownedLauncher) {
    if (!/^[A-Za-z0-9._-]+$/.test(ownedLauncher)) throw new Error('invalid owned launcher');
    const target = path.join(venv, 'bin', ownedLauncher);
    if (!claimed.has(target)) plans.push({ file: null, rows: [{ target, script: entryPoint(target, previousVenv) }] });
  }
  for (const plan of plans) {
    const lines = plan.rows.map((row) => {
      if (!row.script) return row.line;
      const interpreter = path.join(venv, 'bin', row.script.name);
      const prefix = /[\s]/.test(interpreter) || Buffer.byteLength(interpreter) > 500
        ? `#!/bin/sh\n'''exec' ${quote(interpreter)} "$0" "$@"\n' '''\n`
        : `#!${interpreter}\n`;
      const bytes = Buffer.from(prefix + row.script.body);
      writeFileSync(row.target, bytes);
      return `${row.relative},sha256=${hash(bytes, 'base64url')},${bytes.length}`;
    });
    if (plan.file) writeFileSync(plan.file, lines.join('\n'));
  }
}
module.exports = { runtimeTreeDigest, relocateEntryPoints, entryPoint };
