import fs from 'fs';
import path from 'path';
import ts from 'typescript';

type Entry = {
  key: string;
  value: string;
  file: string;
  line: number;
};

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const MESSAGES_PATH = path.join(ROOT, 'messages', 'en.json');
const REPORT_PATH = path.join(ROOT, 'i18n-extract-report.md');

const shouldSkipText = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/^https?:\/\//.test(trimmed)) return true;
  if (/^[A-Za-z0-9_\-/.]+$/.test(trimmed) && trimmed.includes('/')) return true;
  return false;
};

const normalizeKeyPart = (value: string) => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 40);
};

const walk = (dir: string): string[] => {
  const out: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      out.push(...walk(fullPath));
      continue;
    }

    if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(fullPath);
    }
  }

  return out;
};

const findEntries = (filePath: string): Entry[] => {
  const source = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const entries: Entry[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      const value = node.getText(sourceFile).trim();
      if (!shouldSkipText(value)) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        entries.push({
          key: `auto.${normalizeKeyPart(path.basename(filePath))}.${normalizeKeyPart(value)}`,
          value,
          file: path.relative(ROOT, filePath),
          line,
        });
      }
    }

    if (
      ts.isStringLiteral(node) &&
      ts.isCallExpression(node.parent) &&
      ts.isPropertyAccessExpression(node.parent.expression)
    ) {
      const expr = node.parent.expression;
      const fnName = `${expr.expression.getText(sourceFile)}.${expr.name.getText(sourceFile)}`;
      if (fnName.startsWith('message.') && !shouldSkipText(node.text)) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        entries.push({
          key: `toast.${normalizeKeyPart(path.basename(filePath))}.${normalizeKeyPart(node.text)}`,
          value: node.text,
          file: path.relative(ROOT, filePath),
          line,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return entries;
};

const setByPath = (obj: Record<string, any>, dottedPath: string, value: string) => {
  const keys = dottedPath.split('.');
  let current = obj;

  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      if (!current[key]) {
        current[key] = value;
      }
      return;
    }

    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  });
};

const main = () => {
  const files = walk(SRC_DIR);
  const extracted = files.flatMap(findEntries);

  const unique = new Map<string, Entry>();
  extracted.forEach((entry) => {
    if (!unique.has(entry.key)) {
      unique.set(entry.key, entry);
    }
  });

  const nextEntries = [...unique.values()];
  const messages = JSON.parse(fs.readFileSync(MESSAGES_PATH, 'utf8')) as Record<string, any>;

  nextEntries.forEach((entry) => {
    setByPath(messages, entry.key, entry.value);
  });

  fs.writeFileSync(MESSAGES_PATH, `${JSON.stringify(messages, null, 2)}\n`, 'utf8');

  const reportLines = [
    '# i18n extraction report',
    '',
    `Found ${nextEntries.length} entries`,
    '',
    '| key | value | location |',
    '| --- | --- | --- |',
    ...nextEntries.map(
      (entry) =>
        `| \`${entry.key}\` | ${entry.value.replace(/\|/g, '\\|')} | \`${entry.file}:${entry.line}\` |`,
    ),
    '',
  ];

  fs.writeFileSync(REPORT_PATH, reportLines.join('\n'), 'utf8');
  console.log(`Extracted ${nextEntries.length} strings.`);
  console.log(`Updated: ${path.relative(ROOT, MESSAGES_PATH)}`);
  console.log(`Report: ${path.relative(ROOT, REPORT_PATH)}`);
};

main();
