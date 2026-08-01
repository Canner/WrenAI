import type { Bundle } from "../bundle/schema.js";
import type { CapabilityRegistry } from "./registry.js";

const GATED_CRITICALITIES = new Set(["required", "safety-critical"]);

export class CapabilityGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityGateError";
  }
}

interface MissingCapability {
  readonly agentId: string;
  readonly capability: string;
  readonly criticality: string;
}

export function assertCapabilities(bundle: Bundle, registry: CapabilityRegistry): void {
  const missing: MissingCapability[] = [];

  for (const agent of bundle.agents) {
    for (const capability of agent.capabilities) {
      if (!GATED_CRITICALITIES.has(capability.criticality)) continue;
      if (registry.provides(capability.capability)) continue;
      missing.push({
        agentId: agent.id,
        capability: capability.capability,
        criticality: capability.criticality,
      });
    }
  }

  if (missing.length > 0) {
    const detail = missing
      .map((entry) => `  - agent "${entry.agentId}": ${entry.capability} (${entry.criticality})`)
      .join("\n");
    throw new CapabilityGateError(`missing required capabilities:\n${detail}`);
  }
}
