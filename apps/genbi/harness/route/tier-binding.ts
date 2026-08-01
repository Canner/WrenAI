import type { Agent } from "../bundle/schema.js";
import type { AdapterSpec, TierBinding } from "../providers/index.js";

/**
 * Builds a `TierBinding` mapping every distinct `tier` name used by `agent`'s
 * steps to the same `adapterSpec` — one model realizing every tier. Tier
 * names are open strings owned by individual steps, not
 * declared centrally on the agent, so a single-adapter run must enumerate
 * them from the bundle itself rather than assuming fixed names like
 * `cheap`/`strong`. This also covers the render envelope stage automatically:
 * `renderEnvelope`'s default tier is always the tier of the agent's last
 * `independent` step, which is necessarily one of the tiers already
 * collected here.
 */
export function buildUniformTierBinding(agent: Agent, adapterSpec: AdapterSpec): TierBinding {
  const tiers: Record<string, AdapterSpec> = {};
  for (const step of agent.steps) {
    tiers[step.tier] = adapterSpec;
  }
  return { tiers };
}

/** The distinct `tier` names `agent`'s steps use, in first-seen order. */
function agentTierNames(agent: Agent): string[] {
  const seen = new Set<string>();
  for (const step of agent.steps) {
    seen.add(step.tier);
  }
  return [...seen];
}

/**
 * Builds a "hybrid" `TierBinding` — a NON-uniform map from `agent`'s
 * tiers to independently-chosen `AdapterSpec`s (e.g. `cheap` on a free local
 * model, `strong` on a paid cloud one). Unlike `buildUniformTierBinding`
 * (which derives its single map from one `AdapterSpec`, so it can never be
 * short a tier), this takes a caller-supplied per-tier map and must validate
 * it against the agent's actual tiers before trusting it:
 *
 * - every tier `agent`'s steps use must have an entry in `tiers` — a step
 *   whose tier resolves to nothing would otherwise surface late, deep inside
 *   `resolveTierModel`, as a bare `UnknownTierError` with no hint that the
 *   hybrid map (not the agent) is what's incomplete.
 * - every entry in `tiers` must name a tier `agent` actually uses — an entry
 *   for a typo'd or stale tier name would otherwise silently do nothing
 *   (the intended tier stays unbound) rather than fail at the point the typo
 *   was made.
 *
 * Both failure modes loud-fail here, before `runAgent` starts, naming the
 * agent and every offending tier — mirroring this module's/`adapter-spec.ts`'s
 * existing loud-fail style (e.g. `gateway` mode's missing `baseURL`/`model`).
 */
export function buildHybridTierBinding(agent: Agent, tiers: Readonly<Record<string, AdapterSpec>>): TierBinding {
  const agentTiers = agentTierNames(agent);
  const agentTierSet = new Set(agentTiers);
  const boundTierSet = new Set(Object.keys(tiers));

  const missing = agentTiers.filter((tier) => !boundTierSet.has(tier));
  if (missing.length > 0) {
    throw new Error(
      `hybrid tier binding is missing an adapter for tier(s): ${missing.join(", ")} — ` +
        `agent "${agent.id}" uses tier(s): ${agentTiers.join(", ")}`,
    );
  }

  const unknown = [...boundTierSet].filter((tier) => !agentTierSet.has(tier));
  if (unknown.length > 0) {
    throw new Error(
      `hybrid tier binding names unknown tier(s) not used by agent "${agent.id}": ${unknown.join(", ")} — ` +
        `known tier(s): ${agentTiers.join(", ")}`,
    );
  }

  return { tiers };
}
