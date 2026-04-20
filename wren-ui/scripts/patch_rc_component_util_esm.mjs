import fs from 'node:fs';
import path from 'node:path';

const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const packageRoot = path.resolve(scriptDir, '..');
const nodeModulesRoot = path.join(packageRoot, 'node_modules');
const JS_EXTENSION_PATTERN = /\.(?:m?js|cjs|json)$/;
const SPECIFIER_PATTERN = /(from\s+['"])([^'"]+)(['"])/g;
const BARE_SPECIFIER_PREFIXES = [
  '@ant-design/',
  '@rc-component/',
  'antd/',
  'rc-',
];

const TARGET_ROOTS = [
  path.join(nodeModulesRoot, 'antd/es'),
  path.join(nodeModulesRoot, '@ant-design'),
  path.join(nodeModulesRoot, '@rc-component'),
  ...fs
    .readdirSync(nodeModulesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('rc-'))
    .map((entry) => path.join(nodeModulesRoot, entry.name)),
];

const isPatchableBareSpecifier = (specifier) => {
  return (
    BARE_SPECIFIER_PREFIXES.some((prefix) => specifier.startsWith(prefix)) &&
    (specifier.includes('/es/') || specifier.includes('/lib/'))
  );
};

const resolveCandidate = (specifier, importerDir) => {
  if (JS_EXTENSION_PATTERN.test(specifier)) {
    return null;
  }

  if (specifier.startsWith('.')) {
    return path.resolve(importerDir, `${specifier}.js`);
  }

  if (!isPatchableBareSpecifier(specifier)) {
    return null;
  }

  return path.join(nodeModulesRoot, `${specifier}.js`);
};

const patchFile = (filePath) => {
  const source = fs.readFileSync(filePath, 'utf8');
  const importerDir = path.dirname(filePath);
  let patched = source;

  patched = patched.replace(
    SPECIFIER_PATTERN,
    (match, prefix, specifier, suffix) => {
      const candidate = resolveCandidate(specifier, importerDir);
      if (!candidate || !fs.existsSync(candidate)) {
        return match;
      }
      return `${prefix}${specifier}.js${suffix}`;
    },
  );

  if (patched !== source) {
    fs.writeFileSync(filePath, patched);
    return true;
  }

  return false;
};

const walk = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    return 0;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  let patchedCount = 0;

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      patchedCount += walk(entryPath);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.js')) {
      patchedCount += patchFile(entryPath) ? 1 : 0;
    }
  }

  return patchedCount;
};

const patchedCount = TARGET_ROOTS.reduce(
  (count, targetRoot) => count + walk(targetRoot),
  0,
);

console.log(
  `[patch:rc-component-util-esm] ${patchedCount > 0 ? 'patched' : 'verified'} ${patchedCount} file(s)`,
);
