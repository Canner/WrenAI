import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { digest, immutable, requireThat } from '../contracts.mjs';
import { loadBehaviors, sourceHashes, sha256 } from '../behaviors/artifact.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const definitions = {
  'private-planner': { component: 'resolve_intent', input: 'planner-input/1', output: 'planner-decision/1',
    files: ['host/pi.mjs', 'harnesses/planner.mjs', 'planner/model.mjs', 'planner/plan.mjs', 'planner/decision.mjs', 'planner/intent.mjs'] },
  'data-worker': { component: null, input: 'wren-data-task/2', output: 'wren-data-result/2',
    files: ['harnesses/data-validation.mjs', 'harnesses/worker.mjs', 'worker/mcp.mjs', 'worker/retrieval.mjs'] },
  'cloud-planner': { component: 'design_free_dashboard', input: 'authorized-design/1', output: 'frontend-code/1',
    files: ['host/cloud.mjs', 'host/export.mjs', 'host/policy.mjs', 'host/artifacts.mjs', 'host/validation.mjs', 'design/qa.mjs', 'design/readability.mjs', 'design/chart.mjs', 'design/qa-process.mjs', 'design/browser.mjs', 'design/browser-config.mjs',
      'design/design.mjs', 'design/contracts.mjs', 'design/claude.mjs', 'host/fixture.mjs', 'worker/retrieval.mjs'] },
};
export const harnessIds = Object.freeze(Object.keys(definitions));

export function releaseFor(id, { sourceRoot = root } = {}) {
  const definition = definitions[id]; requireThat(definition);
  // Admit the whole compiled artifact, but hash only this component's behavior.
  // Editing a different component does not silently promote this release.
  const behavior = definition.component
    ? (id === 'cloud-planner' ? Object.fromEntries(['design_free_dashboard', 'repair_dashboard'].map(key => [key, loadBehaviors(resolve(sourceRoot, 'behaviors')).components[key]])) : loadBehaviors(resolve(sourceRoot, 'behaviors')).components[definition.component])
    : sourceHashes(resolve(sourceRoot, 'worker/profile'));
  const files = Object.fromEntries(['contracts.mjs', 'harnesses/releases.mjs', ...definition.files]
    .map(path => [path, sha256(readFileSync(resolve(sourceRoot, path)))]));
  const manifest = { version: 'harness-release/1', harness_id: id,
    input_contract: definition.input, output_contract: definition.output, behavior, files };
  return immutable({ ...manifest, release_id: digest(manifest) });
}

// Pins are identities, not serialized credentials or provider configuration.
export function admitBinding(value) {
  const allowed = ['mode', 'model', 'deployment', 'runtime', 'parameters', 'limits'];
  requireThat(value && Object.keys(value).length === allowed.length && allowed.every(k => Object.hasOwn(value, k))
    && ['scripted', 'live'].includes(value.mode)
    && ['model', 'deployment', 'runtime'].every(k => typeof value[k] === 'string' && /^[\w./:@+-]{1,160}$/.test(value[k])));
  const parameterKeys = ['temperature', 'max_tokens', 'thinking'];
  requireThat(value.parameters && Object.keys(value.parameters).length === parameterKeys.length
    && parameterKeys.every(k => Object.hasOwn(value.parameters, k))
    && (value.parameters.temperature === null || (Number.isFinite(value.parameters.temperature) && value.parameters.temperature >= 0))
    && Number.isSafeInteger(value.parameters.max_tokens) && value.parameters.max_tokens > 0
    && ['off', 'on', 'adaptive'].includes(value.parameters.thinking));
  requireThat(value.limits && Object.keys(value.limits).sort().join(',') === 'max_turns,timeout_ms'
    && Number.isSafeInteger(value.limits.max_turns) && value.limits.max_turns > 0 && value.limits.max_turns <= 12
    && Number.isSafeInteger(value.limits.timeout_ms) && value.limits.timeout_ms > 0 && value.limits.timeout_ms <= 300_000);
  return immutable({ ...value, binding_id: digest(value) });
}
