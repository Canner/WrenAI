export interface CapabilityRegistry {
  provides(capability: string): boolean;
}

export const DEFAULT_CAPABILITIES: readonly string[] = [
  "llm:cheap",
  "llm:strong",
  "llm:per_step_tier",
  "sql_execution:read_only",
  "semantic_introspection",
  "genbi_build",
  "render_contract",
  "artifact_write",
];

export function createRegistry(capabilities: readonly string[]): CapabilityRegistry {
  const set = new Set(capabilities);
  return { provides: (capability) => set.has(capability) };
}

export function createDefaultCapabilityRegistry(): CapabilityRegistry {
  return createRegistry(DEFAULT_CAPABILITIES);
}
