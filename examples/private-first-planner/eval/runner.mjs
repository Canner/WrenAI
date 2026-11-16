import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sourceHashes } from '../behaviors/artifact.mjs';
import { digest, immutable, requireThat } from '../contracts.mjs';
import { releaseFor, admitBinding } from '../harnesses/releases.mjs';

const write = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const safeError = error => ['invalid_contract', 'planner_failed', 'disclosure_denied', 'eval_deadline'].includes(error?.message)
  ? error.message : 'unit_failed';
function metrics(attempts) {
  const sum = key => attempts.every(a => Number.isFinite(a[key])) ? attempts.reduce((n, a) => n + a[key], 0) : null;
  return { attempts: attempts.length, input_tokens: attempts.length ? sum('input_tokens') : null,
    output_tokens: attempts.length ? sum('output_tokens') : null, cost_usd: attempts.length ? sum('cost_usd') : null };
}

// Factories get model-facing input only. Hidden expectations are retained by the
// evaluator and never passed to the harness, its context builder or its ports.
export async function runSuite({ harnessId, cases, binding, createUnit, score, scorerVersion,
  out, repeat = 1, expectedRelease }) {
  const release = releaseFor(harnessId), bound = admitBinding(binding);
  const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
  const outputRelative = relative(sourceRoot, resolve(out));
  requireThat(outputRelative.startsWith('..' + '/') || outputRelative === '..');
  requireThat(!expectedRelease || release.release_id === expectedRelease);
  requireThat(typeof scorerVersion === 'string' && scorerVersion.length > 0 && scorerVersion.length < 128
    && Number.isSafeInteger(repeat) && repeat > 0 && repeat <= 20 && Array.isArray(cases) && cases.length > 0
    && new Set(cases.map(c => c.id)).size === cases.length);
  for (const c of cases) requireThat(/^[a-z0-9_-]{1,80}$/.test(c.id) && c.input && c.expected);
  cases = immutable(cases);
  await mkdir(out, { mode: 0o700 }); // Existing runs are immutable, including failed runs.
  const schedule = cases.flatMap(c => Array.from({ length: repeat }, (_, i) => ({ case_id: c.id, repeat: i + 1 })));
  const evalSources = Object.fromEntries(Object.entries(sourceHashes(fileURLToPath(new URL('.', import.meta.url))))
    .filter(([p]) => !p.includes('__pycache__') && /\.(mjs|py|json)$/.test(p)));
  await write(join(out, 'manifest.json'), { version: 'harness-eval/1', release, binding: bound, evaluation_sources: evalSources,
    scorer: scorerVersion, schedule, cases_digest: digest(cases),
    cases: cases.map(c => ({ id: c.id, input_digest: digest(c.input), oracle_digest: digest(c.expected) })) });
  const records = [];
  for (const item of schedule) {
    const c = cases.find(x => x.id === item.case_id), start = performance.now();
    const record = { version: 'harness-run/1', run_id: randomUUID(), harness_id: harnessId,
      ...item, release_id: release.release_id, binding_id: bound.binding_id, scorer: scorerVersion,
      input_digest: digest(c.input), oracle_digest: digest(c.expected), attempts: [], state: 'running', output: null };
    const controller = new AbortController(); let unit, listener, timer, sealed = false;
    const observeAttempt = attempt => {
      if (sealed) return; // A late adapter completion cannot rewrite a saved record.
      // The adapter must report every transport attempt, including failed calls.
      requireThat(attempt && ['completed', 'failed'].includes(attempt.status));
      const value = { status: attempt.status, elapsed_ms: attempt.elapsed_ms ?? null,
        input_tokens: attempt.input_tokens ?? null, output_tokens: attempt.output_tokens ?? null,
        cost_usd: attempt.cost_usd ?? null };
      for (const x of Object.values(value).slice(1)) requireThat(x === null || (Number.isFinite(x) && x >= 0));
      record.attempts.push(value);
    };
    try {
      const timeout = new Promise((_, reject) => {
        listener = () => reject(Error('eval_deadline'));
        controller.signal.addEventListener('abort', listener, { once: true });
        timer = setTimeout(() => controller.abort(), bound.limits.timeout_ms);
      });
      const operation = (async () => {
        unit = await createUnit({ input: immutable(c.input), binding: bound, signal: controller.signal, observeAttempt });
        if (controller.signal.aborted) { await unit.close?.(); throw Error('eval_deadline'); }
        controller.signal.throwIfAborted();
        return unit.run();
      })();
      record.output = await Promise.race([operation, timeout]);
      record.state = 'completed';
    } catch (error) { record.state = 'failed'; record.error = safeError(error);
      if (controller.signal.aborted) record.attempts_complete = false;
    }
    finally {
      clearTimeout(timer); controller.signal.removeEventListener('abort', listener); controller.abort();
      try { await unit?.close?.(); } catch { record.cleanup_error = true; record.state = 'failed'; }
      sealed = true;
      record.attempts_complete ??= true;
      record.trace_refs = unit?.traceRefs ?? [];
      record.elapsed_ms = Math.round(performance.now() - start);
    }
    record.resources = metrics(record.attempts);
    try { record.score = await score(immutable(record), immutable(c.expected)); }
    catch { record.score = { passed: false, scorer_error: true }; }
    requireThat(record.score && typeof record.score.passed === 'boolean');
    records.push(record);
    await write(join(out, `${item.case_id}-${item.repeat}.json`), record);
  }
  const sourceUnchanged = releaseFor(harnessId).release_id === release.release_id;
  const summary = { version: 'harness-eval-summary/1', harness_id: harnessId, mode: bound.mode, source_unchanged: sourceUnchanged,
    model_quality_measured: bound.mode === 'live', scheduled: schedule.length, recorded: records.length,
    passed: sourceUnchanged ? records.filter(r => !r.cleanup_error && r.score.passed).length : 0,
    records: records.map(r => ({ case_id: r.case_id, repeat: r.repeat, state: r.state, passed: r.score.passed,
      elapsed_ms: r.elapsed_ms, resources: r.resources })) };
  await write(join(out, 'summary.json'), summary);
  return { summary, records };
}
