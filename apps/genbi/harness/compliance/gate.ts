import type { AuthChoice } from "../auth/index.js";
import type { ComplianceResult, Deployment } from "./types.js";

/** Thrown when `enforceCompliance` rejects an `AuthChoice`/`Deployment` combination. Never thrown silently-downgraded — callers must handle it (route reject -> caller picks a different mode). */
export class ComplianceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComplianceError";
  }
}

/**
 * Warning surfaced whenever `subscription` auth is used for `personal`
 * deployment. Wording aligned with LangChain's own subscription-auth
 * disclaimer: this is your personal subscription, it may violate the
 * provider's Terms of Service (that risk is yours), the consumer backend
 * and its policies are volatile and may change or break without notice,
 * and this is for personal, single-operator use only — never multi-user or
 * hosted. Not legal advice; verify against the provider's current ToS
 * before relying on this.
 */
export const SUBSCRIPTION_TOS_WARNING =
  "using your personal subscription to authenticate may violate the provider's Terms of Service " +
  "(that's your responsibility); the consumer backend and its policies are volatile and may change " +
  "or break at any time; this is for personal, single-operator use only, never multi-user or hosted; " +
  "verify against the provider's current ToS before relying on this — this is not legal advice.";

/**
 * The compliance gate: a pure decision over an already-resolved
 * `AuthChoice` and the operator-declared `deployment` context, meant to be
 * called at the route()/onboarding seam *before* any back-end runs.
 *
 * - `subscription` + `hosted` -> throws {@link ComplianceError}. Personal
 *   subscription auth used behind a shared/multi-tenant/always-on server is
 *   account sharing, which the ToS warning below cannot excuse — there is
 *   no silent downgrade to another mode; the caller must pick `api-key` or
 *   `gateway` explicitly.
 * - `subscription` + `personal` (the default) -> allowed, returning the
 *   ToS warning the caller must surface before running.
 * - `api-key` / `local` / `gateway` -> always allowed, no warning (only
 *   `subscription` auth carries the ToS exposure this gate is about).
 */
export function enforceCompliance(
  authChoice: AuthChoice,
  options: { readonly deployment?: Deployment } = {},
): ComplianceResult {
  const deployment = options.deployment ?? "personal";

  if (authChoice.mode !== "subscription") {
    return { authChoice, warnings: [] };
  }

  if (deployment === "hosted") {
    throw new ComplianceError(
      "compliance: subscription auth is personal-use only and cannot serve a hosted " +
        "(multi-tenant / shared / always-on-server) deployment — this is account sharing, which " +
        "violates the provider's ToS; use --mode api-key or --mode gateway for hosted deployments.",
    );
  }

  return { authChoice, warnings: [SUBSCRIPTION_TOS_WARNING] };
}
