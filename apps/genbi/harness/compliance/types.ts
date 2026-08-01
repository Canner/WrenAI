import type { AuthChoice } from "../auth/index.js";

/**
 * The deployment context a compliance decision turns on. The harness has no
 * way to self-detect multi-tenancy — whether it's serving one person on
 * their own machine or sitting behind a shared, always-on endpoint is a
 * fact only the operator knows — so it's taken as an explicit input rather
 * than inferred. `"hosted"` means multi-tenant, shared, or always-on-server
 * use; `"personal"` (the default) means a single operator on their own
 * machine.
 */
export type Deployment = "personal" | "hosted";

/** The gate's non-throwing outcome: the `AuthChoice` passed through, plus any warnings the caller must surface before a back-end runs. */
export interface ComplianceResult {
  readonly authChoice: AuthChoice;
  readonly warnings: readonly string[];
}
