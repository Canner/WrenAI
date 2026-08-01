import type { LanguageModel } from "ai";
import { UnknownTierError } from "./errors.js";
import type { ProviderRegistry } from "./registry.js";

/** Names an adapter id + the config to realize it with. */
export interface AdapterSpec<Config = unknown> {
  readonly adapter: string;
  readonly config: Config;
}

/**
 * Runtime-injected tier -> adapter binding. This is a plain object supplied
 * by the caller at run time — it is never read from a bundle and must never
 * be committed to a bundle fixture. `tier` names are open strings owned by
 * the bundle's steps; the binding only needs to cover the tiers a given run
 * actually uses.
 */
export interface TierBinding {
  readonly tiers: Readonly<Record<string, AdapterSpec>>;
}

/** Resolve an open-string tier name to a concrete language model instance. */
export function resolveTierModel(
  binding: TierBinding,
  tier: string,
  registry: ProviderRegistry,
): LanguageModel {
  const spec = binding.tiers[tier];
  if (!spec) {
    throw new UnknownTierError(tier);
  }
  return registry.create(spec.adapter, spec.config);
}

/** Convenience: resolve the model for a bundle step via its `tier` field. */
export function resolveStepModel(
  step: { readonly tier: string },
  binding: TierBinding,
  registry: ProviderRegistry,
): LanguageModel {
  return resolveTierModel(binding, step.tier, registry);
}
