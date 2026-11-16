import { generateCode } from '../p5/design.mjs';
import { requireThat } from '../contracts.mjs';

// Diagnostics are an enum, never browser text, private evidence or raw errors.
export const repairCodes = Object.freeze(['layout', 'contrast', 'interaction', 'data_binding', 'chart_rendering']);
export async function designWithRepair({ broker, makeDesigner, inspect, save, signal, timeoutMs = 180_000 }) {
  const attempts = [], deadline = Date.now() + timeoutMs;
  let diagnostics = [];
  for (let index = 0; index < 2; index++) {
    signal.throwIfAborted();
    const bundle = await broker.prepare();
    const designer = makeDesigner({ bundle, attempt: index, diagnostics });
    const start = performance.now();
    const result = await generateCode({ broker, designer, signal, deadline });
    const record = { attempt: index, result, design_ms: Math.round(performance.now() - start), qa_ms: null };
    if (result.state === 'generated') {
      const qaStart = performance.now();
      try { record.qa = await inspect(result, { signal, timeoutMs: Math.max(1, deadline - Date.now()) }); }
      catch { record.qa = { pass: false, repair_codes: [], reason: 'qa_unavailable' }; }
      record.qa_ms = Math.round(performance.now() - qaStart);
      signal.throwIfAborted();
      try { await broker.authorize(bundle, 'use'); }
      catch { result.state = 'rejected'; record.qa = { pass: false, repair_codes: [], reason: 'authorization_changed' }; }
    }
    // Save rejected candidates too. Never render or publish arbitrary code here.
    record.artifact = await save(record); attempts.push(record);
    if (record.qa?.pass === true) return { state: 'completed', attempts, artifact: record.artifact };
    if (result.state !== 'generated') break;
    requireThat(Array.isArray(record.qa?.repair_codes));
    diagnostics = record.qa.repair_codes.filter(code => repairCodes.includes(code));
    if (!diagnostics.length || Date.now() >= deadline) break;
  }
  return { state: 'fallback', attempts };
}
