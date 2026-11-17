import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { admitBehaviors, loadBehaviors } from '../artifact.mjs';
import { behaviors } from '../index.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const clone = structuredClone;
test('unsupported IR behavior cannot silently fall back to prompt-only execution', () => {
  const original = JSON.parse(readFileSync(join(root, 'compiled/ir.json')));
  assert.equal(admitBehaviors(original).resolve_intent.tier, 'cheap');
  for (const mutate of [
    x => x.warble_ir_version = '1.0',
    x => x.components.pop(),
    x => x.components.push(clone(x.components[0])),
    x => x.config.model = 'other',
    x => x.components[0].borrowed_actions.push('run_sql'),
    x => x.components[0].guardrails = [],
    x => x.components[0].llm_calls.push(clone(x.components[0].llm_calls[0])),
    x => x.components[0].llm_calls[0].when = { kind: 'custom' },
    x => x.components[1].required_capabilities.push('data_write'),
    x => x.components[1].effect.render_blocks.push('chart'),
  ]) { const ir = clone(original); mutate(ir); assert.throws(() => admitBehaviors(ir), /unsupported_behavior_contract/); }
});

test('changed prompts, profile, new files and compiled IR require regeneration', () => {
  for (const [path, text] of [
    ['profile/components/resolve_intent/respond.md', 'different instructions'],
    ['profile/profile.yml', 'profile: different'], ['profile/new.yml', 'unexpected: true'],
    ['compiled/ir.json', '{}'],
  ]) {
    const dir = mkdtempSync(join(tmpdir(), 'behavior-drift-'));
    try {
      cpSync(root, dir, { recursive: true });
      assert.equal(loadBehaviors(dir).components.design_free_dashboard.prompt, behaviors.design_free_dashboard.prompt);
      writeFileSync(join(dir, path), text);
      assert.throws(() => loadBehaviors(dir), /stale_behavior_artifact/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});
