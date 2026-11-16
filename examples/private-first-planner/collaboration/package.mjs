import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, lstat, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const [destination] = process.argv.slice(2);
if (!destination || process.argv.length !== 3) throw Error('usage: package.mjs NEW_OUTPUT_DIRECTORY');
const out = resolve(destination), prefix = 'examples/private-first-planner/';
if (out === repo || out.startsWith(repo + '/')) throw Error('package_output_must_be_outside_checkout');
const paths = [prefix, 'examples/serve-agent/setup.py', 'examples/serve-agent/policy.cedar',
  'examples/serve-agent/adhoc-policy.cedar', 'LICENSE', '.github/workflows/private-first-planner-ci.yml'];
const git = args => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
// Archive only reviewed, tracked files. Untracked artifacts, credentials and dependencies are excluded.
if (git(['status', '--porcelain', '--untracked-files=all', '--', ...paths]).trim()) throw Error('commit_package_sources_before_export');
const files = git(['ls-files', '-z', '--', ...paths]).split('\0').filter(Boolean).sort();
if (!files.includes(prefix + 'collaboration/DATA-WORKER.md') || !files.includes('examples/serve-agent/setup.py')) throw Error('incomplete_package_sources');
await mkdir(out, { mode: 0o700 });
const folder = join(out, 'private-first-reference'); await mkdir(folder);
const manifest = { version: 'collaboration-package/1', revision: git(['rev-parse', 'HEAD']).trim(), files: {} };
for (const file of files) {
  const source = join(repo, file), target = join(folder, file);
  if (!(await lstat(source)).isFile()) throw Error('package_requires_regular_files');
  await mkdir(dirname(target), { recursive: true }); await copyFile(source, target);
  manifest.files[file] = createHash('sha256').update(await readFile(target)).digest('hex');
}
await writeFile(join(folder, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(join(folder, 'README.md'), '# Private-first collaboration package\n\nStart with [the collaboration guide](examples/private-first-planner/collaboration/README.md) or [data worker handoff](examples/private-first-planner/collaboration/DATA-WORKER.md).\n\nMANIFEST.json records the source revision and every packaged source digest. No dependencies, model credentials, generated dashboards or historical run artifacts are bundled. The loader is an explicit external prerequisite; build it from the documented Wren revision.\n');
const name = 'private-first-reference.tar.gz';
// BSD tar otherwise materializes macOS extended attributes as ._* source files.
// Such files alter behavior hashes and may be executed by test-file discovery.
execFileSync('tar', ['-czf', join(out, name), '-C', out, 'private-first-reference'],
  { env: { ...process.env, COPYFILE_DISABLE: '1' } });
const entries = execFileSync('tar', ['-tf', join(out, name)], { encoding: 'utf8' }).trim().split('\n').filter(p => !p.endsWith('/'));
const expected = [...files, 'MANIFEST.json', 'README.md'].map(p => `private-first-reference/${p}`).sort();
if (JSON.stringify(entries.sort()) !== JSON.stringify(expected)) throw Error('archive_contains_unexpected_files');
const sha = createHash('sha256').update(await readFile(join(out, name))).digest('hex');
await writeFile(join(out, 'SHA256SUMS'), `${sha}  ${name}\n`);
console.log(JSON.stringify({ revision: manifest.revision, files: files.length, sha256: sha, archive: name }));
