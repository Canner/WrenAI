#!/usr/bin/env node

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(__filename);
const workspaceRoot = path.resolve(scriptsDir, '..');
const repoRoot = path.resolve(workspaceRoot, '..');

const ESLINT_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
]);

const PRETTIER_EXTENSIONS = new Set([
  ...ESLINT_EXTENSIONS,
  '.json',
  '.md',
  '.mdx',
  '.yml',
  '.yaml',
  '.css',
  '.scss',
  '.less',
  '.html',
]);

const IGNORED_RELATIVE_PATHS = [
  '.next/',
  'node_modules/',
  'tmp/',
  'coverage/',
  'playwright-report/',
  'test-results/',
];

const GENERATED_FILE_PATTERNS = [];

function printHelp() {
  console.log(`Usage: node scripts/lint_changed.mjs [options]

Options:
  --fix               Run eslint --fix and prettier --write
  --staged            Only check staged files
  --since <rev>       Compare against a specific git revision
  --help              Show this help message
`);
}

function parseArgs(argv) {
  const parsed = {
    fix: false,
    staged: false,
    since: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--fix') {
      parsed.fix = true;
      continue;
    }

    if (arg === '--staged') {
      parsed.staged = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }

    if (arg === '--since') {
      parsed.since = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg.startsWith('--since=')) {
      parsed.since = arg.slice('--since='.length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!parsed.help && argv.includes('--since') && !parsed.since) {
    throw new Error('Missing value for --since');
  }

  if (parsed.staged && parsed.since) {
    throw new Error('--staged and --since cannot be used together');
  }

  return parsed;
}

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: options.captureOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  return result;
}

function gitChangedFiles({ staged, since }) {
  const diffArgs = ['diff', '--name-only', '--diff-filter=ACMR'];

  if (staged) {
    diffArgs.push('--cached');
  } else if (since) {
    diffArgs.push(since);
  } else {
    diffArgs.push('HEAD');
  }

  diffArgs.push('--', 'wren-ui');

  const changedResult = run('git', diffArgs, repoRoot, { captureOutput: true });

  if (changedResult.status !== 0) {
    const stderr = changedResult.stderr?.trim();
    throw new Error(stderr || 'Failed to resolve changed files from git diff');
  }

  const changedFiles = changedResult.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (staged || since) {
    return changedFiles;
  }

  const untrackedResult = run(
    'git',
    ['ls-files', '--others', '--exclude-standard', '--', 'wren-ui'],
    repoRoot,
    { captureOutput: true },
  );

  if (untrackedResult.status !== 0) {
    const stderr = untrackedResult.stderr?.trim();
    throw new Error(
      stderr || 'Failed to resolve untracked files from git ls-files',
    );
  }

  const untrackedFiles = untrackedResult.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return [...new Set([...changedFiles, ...untrackedFiles])];
}

function toWorkspaceRelativePath(filePath) {
  return filePath.startsWith('wren-ui/')
    ? filePath.slice('wren-ui/'.length)
    : filePath;
}

function isIgnored(relativePath) {
  if (!relativePath) {
    return true;
  }

  if (
    IGNORED_RELATIVE_PATHS.some(
      (prefix) => relativePath === prefix || relativePath.startsWith(prefix),
    )
  ) {
    return true;
  }

  return GENERATED_FILE_PATTERNS.some((pattern) => pattern.test(relativePath));
}

function fileExistsInWorkspace(relativePath) {
  return existsSync(path.join(workspaceRoot, relativePath));
}

function classifyFiles(relativePaths) {
  const eslintFiles = [];
  const prettierFiles = [];

  for (const relativePath of relativePaths) {
    const extension = path.extname(relativePath);
    const isEslintTarget = ESLINT_EXTENSIONS.has(extension);

    if (isEslintTarget) {
      eslintFiles.push(relativePath);
    }

    if (PRETTIER_EXTENSIONS.has(extension) && !isEslintTarget) {
      prettierFiles.push(relativePath);
    }
  }

  return {
    eslintFiles,
    prettierFiles,
  };
}

function runLintStep({ commandArgs, label }) {
  const result = run('yarn', commandArgs, workspaceRoot);

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  console.log(`✔ ${label}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const changedFiles = gitChangedFiles(args)
    .map(toWorkspaceRelativePath)
    .filter((relativePath) => !isIgnored(relativePath))
    .filter(fileExistsInWorkspace);

  const { eslintFiles, prettierFiles } = classifyFiles(changedFiles);

  if (eslintFiles.length === 0 && prettierFiles.length === 0) {
    console.log('No changed lintable files.');
    return;
  }

  console.log(
    `Detected ${changedFiles.length} changed file(s) in wren-ui (${eslintFiles.length} eslint / ${prettierFiles.length} prettier).`,
  );

  if (eslintFiles.length > 0) {
    runLintStep({
      label: args.fix
        ? 'eslint fixed changed files'
        : 'eslint checked changed files',
      commandArgs: [
        'eslint',
        '--max-warnings=0',
        ...(args.fix ? ['--fix'] : []),
        ...eslintFiles,
      ],
    });
  } else {
    console.log('No changed ESLint targets.');
  }

  if (prettierFiles.length > 0) {
    runLintStep({
      label: args.fix
        ? 'prettier wrote changed files'
        : 'prettier checked changed files',
      commandArgs: [
        'prettier',
        args.fix ? '--write' : '--check',
        ...prettierFiles,
      ],
    });
  } else {
    console.log('No changed Prettier targets.');
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
