import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const srcDir = path.join(repoRoot, 'src');
const stylesDir = path.join(srcDir, 'styles');
const packageJsonPath = path.join(repoRoot, 'package.json');

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const dependencies = packageJson.dependencies ?? {};
const devDependencies = packageJson.devDependencies ?? {};

const nextVersion = dependencies.next;
const eslintConfigNextVersion = devDependencies['eslint-config-next'];
const bundleAnalyzerVersion = devDependencies['@next/bundle-analyzer'];
const cronParserDependencyVersion = dependencies['cron-parser'];
const cronParserDevDependencyVersion = devDependencies['cron-parser'];
const styledComponentsVersion =
  devDependencies['styled-components'] ?? dependencies['styled-components'];
const reactIsVersion = devDependencies['react-is'] ?? dependencies['react-is'];
const vegaVersion = devDependencies['vega'] ?? dependencies['vega'];
const vegaLiteVersion =
  devDependencies['vega-lite'] ?? dependencies['vega-lite'];
const vegaEmbedVersion =
  devDependencies['vega-embed'] ?? dependencies['vega-embed'];

const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx']);

function walkFiles(directory, collected = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      walkFiles(fullPath, collected);
      continue;
    }

    collected.push(fullPath);
  }

  return collected;
}

function countMatchingFiles(directory, matcher) {
  return walkFiles(directory)
    .filter((filePath) => sourceExtensions.has(path.extname(filePath)))
    .filter((filePath) => matcher(fs.readFileSync(filePath, 'utf8'))).length;
}

function findCronUsageFiles(directory) {
  return walkFiles(directory)
    .filter((filePath) => sourceExtensions.has(path.extname(filePath)))
    .filter((filePath) => /cron-parser|CronExpressionParser/.test(fs.readFileSync(filePath, 'utf8')))
    .map((filePath) => path.relative(repoRoot, filePath))
    .sort();
}

function countLessFiles(directory) {
  if (!fs.existsSync(directory)) return 0;
  return walkFiles(directory).filter((filePath) => path.extname(filePath) === '.less').length;
}

const antdImportCount = countMatchingFiles(
  srcDir,
  (content) => /from ['"]antd['"]/.test(content),
);
const styledComponentsCount = countMatchingFiles(
  srcDir,
  (content) => /styled-components/.test(content),
);
const lessFileCount = countLessFiles(stylesDir);
const cronUsageFiles = findCronUsageFiles(srcDir);

const failures = [];

if (!nextVersion || !eslintConfigNextVersion || !bundleAnalyzerVersion) {
  failures.push('Next 生态关键版本缺失：需要 next / eslint-config-next / @next/bundle-analyzer 同时存在。');
}

if (
  nextVersion &&
  eslintConfigNextVersion &&
  bundleAnalyzerVersion &&
  !(
    nextVersion === eslintConfigNextVersion &&
    nextVersion === bundleAnalyzerVersion
  )
) {
  failures.push(
    `Next 生态版本未锁步：next=${nextVersion}, eslint-config-next=${eslintConfigNextVersion}, @next/bundle-analyzer=${bundleAnalyzerVersion}`,
  );
}

if (!cronParserDependencyVersion) {
  failures.push('缺少 dependencies.cron-parser。');
}

if (cronParserDevDependencyVersion) {
  failures.push(
    `检测到重复声明：devDependencies.cron-parser=${cronParserDevDependencyVersion}`,
  );
}

if (styledComponentsVersion && !reactIsVersion) {
  failures.push(
    'styled-components 已声明，但 workspace 未显式提供 react-is。',
  );
}

console.log('Frontend dependency audit snapshot (Wave 7)');
console.log('');
console.log('Next ecosystem');
console.log(
  `- next = ${nextVersion ?? 'missing'}`
);
console.log(
  `- eslint-config-next = ${eslintConfigNextVersion ?? 'missing'}`
);
console.log(
  `- @next/bundle-analyzer = ${bundleAnalyzerVersion ?? 'missing'}`
);
console.log('');
console.log('Direct dependency checks');
console.log(`- dependencies.cron-parser = ${cronParserDependencyVersion ?? 'missing'}`);
console.log(
  `- devDependencies.cron-parser = ${cronParserDevDependencyVersion ?? 'null'}`
);
console.log(`- react-is = ${reactIsVersion ?? 'missing'}`);
console.log(`- styled-components = ${styledComponentsVersion ?? 'missing'}`);
console.log(`- vega = ${vegaVersion ?? 'missing'}`);
console.log(`- vega-lite = ${vegaLiteVersion ?? 'missing'}`);
console.log(`- vega-embed = ${vegaEmbedVersion ?? 'missing'}`);
console.log('');
console.log('Migration blast radius snapshot');
console.log(`- antd direct import files: ${antdImportCount}`);
console.log(`- styled-components usage files: ${styledComponentsCount}`);
console.log(`- src/styles/**/*.less files: ${lessFileCount}`);
console.log('');
console.log('cron-parser usage files');
for (const filePath of cronUsageFiles) {
  console.log(`- ${filePath}`);
}

if (failures.length > 0) {
  console.log('');
  console.log('Blocking mismatches');
  for (const failure of failures) {
    console.log(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log('');
  console.log('Status');
  console.log('- PASS: Next ecosystem versions are aligned.');
  console.log('- PASS: cron-parser is only declared in dependencies.');
  console.log('- PASS: styled-components peer is backed by a direct react-is dependency.');
}
