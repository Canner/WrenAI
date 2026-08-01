import type { LanguageModel } from "ai";
import { UnknownAdapterError } from "./errors.js";

// An adapter factory turns adapter-specific config into a concrete AI SDK
// language model instance. Config shape is owned by each adapter, not by
// the registry.
export type AdapterFactory<Config = unknown> = (config: Config) => LanguageModel;

export interface ProviderRegistry {
  /** Register (or override) the adapter for an open-string adapter id. */
  register<Config = unknown>(adapterId: string, factory: AdapterFactory<Config>): void;
  /** Whether an adapter is registered for this id. */
  has(adapterId: string): boolean;
  /** Realize a language model instance for the given adapter id + config. */
  create(adapterId: string, config: unknown): LanguageModel;
}

/**
 * Create an empty, injectable provider registry keyed on an open-string
 * adapter id. Callers register built-in and/or custom adapters onto it;
 * the registry itself has no opinion on what ids exist.
 */
export function createProviderRegistry(): ProviderRegistry {
  const adapters = new Map<string, AdapterFactory<unknown>>();

  return {
    register(adapterId, factory) {
      adapters.set(adapterId, factory as AdapterFactory<unknown>);
    },
    has(adapterId) {
      return adapters.has(adapterId);
    },
    create(adapterId, config) {
      const factory = adapters.get(adapterId);
      if (!factory) {
        throw new UnknownAdapterError(adapterId);
      }
      return factory(config);
    },
  };
}
