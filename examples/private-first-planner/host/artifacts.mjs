import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { renderPrivateResults } from './private-results.mjs';
import { runQA } from '../design/qa-process.mjs';
import { assessDashboard } from './validation.mjs';

export function artifactPorts(root) {
  const write = async (name, value) => {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const path = join(root, `${randomUUID()}-${name}`);
    await writeFile(path, value, { flag: 'wx', mode: 0o600 }); return path;
  };
  return {
    savePrivate: task => write('private.html', renderPrivateResults(task)),
    saveCandidate: record => write('candidate.json', JSON.stringify(record, null, 2)),
    inspect: async ({ spec, bundle }, { signal, timeoutMs } = {}) => {
      const directory = join(root, `qa-${randomUUID()}`); await mkdir(directory, { recursive: true, mode: 0o700 });
      const path = join(directory, 'input.json');
      await writeFile(path, JSON.stringify({ spec, bundle }), { flag: 'wx', mode: 0o600 });
      const qa = await runQA(path, directory, { signal, timeoutMs: Math.min(30_000, timeoutMs ?? 30_000) });
      // Local warnings are retained, not forwarded to the cloud. Only the
      // bounded functional repair codes may leave through the existing broker.
      const assessment = { ...assessDashboard(qa), artifact_dir: directory, strict_quality_pass: qa.passed === true };
      await writeFile(join(directory, 'assessment.json'), JSON.stringify(assessment, null, 2), { flag: 'wx', mode: 0o600 });
      return assessment;
    },
  };
}
