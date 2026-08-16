/**
 * The models a Claude per-step tier may be bound to.
 *
 * The Agent SDK's top-level driver takes concrete model ids, but its
 * `agents[].model` surface is a closed alias union — so the account model
 * catalog, which is the right source for the driver field, is the wrong one for
 * a tier. Feeding the catalog to a tier field made Setup recommend `default`,
 * which the runtime then refused to save.
 *
 * Mirrors `CLAUDE_AGENT_SDK_PER_STEP_MODELS` in `server/runtime-binding.ts`,
 * which is what actually rejects a bad value. `test/tier-model-union.test.ts`
 * fails if the two drift apart.
 *
 * This module deliberately imports nothing: the drift guard runs in the server
 * test project, whose tsconfig has no `@/` alias, so anything reachable from
 * here must stay alias-free.
 */
export const CLAUDE_TIER_MODELS = ['inherit', 'opus', 'sonnet', 'haiku'] as const;
