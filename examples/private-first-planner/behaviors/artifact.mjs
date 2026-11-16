import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { immutable } from '../contracts.mjs';

export const compilerVersion = 'warble 0.21.1';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const check = condition => { if (!condition) throw Error('unsupported_behavior_contract'); };

export function sourceHashes(root) {
  const hashes = {};
  function visit(relative) {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(path);
      else { check(entry.isFile()); hashes[path] = sha256(readFileSync(join(root, path))); }
    }
  }
  visit('');
  return hashes;
}

// A deliberately narrow consumer of the public IR contract, not a general Warble dispatcher.
// New instructions are allowed; unsupported execution semantics must fail, not disappear.
export function admitBehaviors(ir) {
  const bindings = [['resolve_intent', 'cheap'], ['design_dashboard', 'strong'], ['design_free_dashboard', 'strong'], ['repair_dashboard', 'strong']];
  const expected = {
    components: bindings.map(([id, tier]) => {
      const prompt = ir?.components?.find(c => c.id === id)?.llm_calls?.[0]?.prompt;
      check(typeof prompt === 'string' && prompt.trim().length > 0);
      return {
        borrowed_actions: [], context_binding: null, context_precondition: [], context_requirements: [],
        effect: { outcome: { kind: 'none' }, render_blocks: [] }, entrypoint: true, eval_ref: `${id}.eval`,
        guardrails: [{ locked: true, name: 'read_only_execution' }], id,
        llm_calls: [{ conditional: false, consumes: [], name: 'respond', produces: null, prompt, tier, when: null }],
        params: [], precondition_result: { checks: [], status: 'pass' }, prompt_fragment: `## respond\n\n${prompt}`,
        realization_kind: 'skill', required_capabilities: [`llm:${tier}`], trigger: { kind: 'one_shot' }, type: 'analytical', verb: id,
      };
    }),
    config: {}, context_binding: null, profile: 'private-first-behaviors', warble_ir_version: '0.9',
  };
  check(isDeepStrictEqual(ir, expected));
  return immutable(Object.fromEntries(ir.components.map(c => [c.id, { tier: c.llm_calls[0].tier, prompt: c.llm_calls[0].prompt }])));
}

export function loadBehaviors(root) {
  const bytes = readFileSync(join(root, 'compiled/ir.json'));
  const manifest = JSON.parse(readFileSync(join(root, 'compiled/manifest.json'), 'utf8'));
  if (manifest.compiler !== compilerVersion || manifest.ir_sha256 !== sha256(bytes)
      || !isDeepStrictEqual(manifest.sources, sourceHashes(join(root, 'profile')))) {
    throw Error('stale_behavior_artifact: regenerate with behaviors/compile.mjs');
  }
  return immutable({ components: admitBehaviors(JSON.parse(bytes)), provenance: manifest });
}
