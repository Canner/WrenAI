import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const pagesRoot = path.join(repoRoot, 'src', 'pages');
const allowlistPath = path.join(repoRoot, 'scripts', 'pages-route-allowlist.json');
const VALID_EXTENSIONS = new Set(['.ts', '.tsx']);

const shouldIgnore = (relativePath) =>
  relativePath.includes('/tests/') ||
  relativePath.endsWith('.test.ts') ||
  relativePath.endsWith('.test.tsx') ||
  relativePath.endsWith('.spec.ts') ||
  relativePath.endsWith('.spec.tsx');

const walk = async (dir, baseDir = dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(absolutePath, baseDir)));
      continue;
    }
    if (!VALID_EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }
    const relativePath = path.relative(baseDir, absolutePath).split(path.sep).join('/');
    if (shouldIgnore(relativePath)) {
      continue;
    }
    files.push(relativePath);
  }
  return files.sort();
};

const formatList = (items) => items.map((item) => `  - ${item}`).join('\n');

const main = async () => {
  const allowed = JSON.parse(await readFile(allowlistPath, 'utf8'));
  const actual = await walk(pagesRoot);
  const allowedSet = new Set(allowed);
  const actualSet = new Set(actual);
  const unexpected = actual.filter((item) => !allowedSet.has(item));
  const missing = allowed.filter((item) => !actualSet.has(item));

  if (unexpected.length === 0 && missing.length === 0) {
    console.log(`pages route inventory OK (${actual.length} entries)`);
    return;
  }

  console.error('pages route inventory drift detected.');
  if (unexpected.length) {
    console.error(`\nUnexpected pages files:\n${formatList(unexpected)}`);
  }
  if (missing.length) {
    console.error(`\nMissing allowlisted pages files:\n${formatList(missing)}`);
  }
  console.error('\nUpdate scripts/pages-route-allowlist.json intentionally after confirming route changes.');
  process.exitCode = 1;
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
