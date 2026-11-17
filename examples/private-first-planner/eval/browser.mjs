import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runQA } from '../design/qa-process.mjs';

export function browserInspector(root) {
  return async ({ spec, bundle }) => {
    const directory = join(root, `qa-${randomUUID()}`); await mkdir(directory, { mode: 0o700 });
    const input = join(directory, 'artifact.json');
    await writeFile(input, JSON.stringify({ spec, bundle }), { flag: 'wx', mode: 0o600 });
    return { ...await runQA(input, directory), artifact_dir: directory };
  };
}
