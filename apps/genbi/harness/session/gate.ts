import type { Agent, Guardrail } from "../bundle/schema.js";

const GATED_CHECK_ENFORCEMENT = "gated_check";

/**
 * Finds a `locked` guardrail whose `enforcement` is `gated_check`, if the
 * agent declares one. This is what gives `gated_check` real teeth: enforcement lives
 * here as a code-level check on the rendered envelope's `verified` field —
 * not as prose in a prompt the model may or may not follow. The golden
 * `answer_query` agent's `deterministic_gate` guardrail
 * (`{enforcement: "gated_check", locked: true}`) is exactly what this
 * matches on.
 */
export function findLockedGatedCheck(agent: Agent): Guardrail | undefined {
  return Object.values(agent.guardrails).find(
    (guardrail) => guardrail.enforcement === GATED_CHECK_ENFORCEMENT && guardrail.locked === true,
  );
}
