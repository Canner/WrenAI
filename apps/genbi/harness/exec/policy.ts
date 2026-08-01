import type { EnforcementPolicy } from "../guardrails/index.js";

/**
 * The policy every `ExecutionEnv` method receives: the guardrail-derived
 * `EnforcementPolicy` (`harness/guardrails/`) plus an egress allowlist. The
 * allowlist has no bundle representation in v1 — the golden bundle never
 * declares a host/dataset egress guardrail — so callers supply it directly
 * (see `RunAgentContext.allowedHosts` in `harness/session/run.ts`). Omitting it
 * means "no hosts allowed", the safe default.
 */
export interface ExecutionPolicy extends EnforcementPolicy {
  readonly allowedHosts?: readonly string[];
}
