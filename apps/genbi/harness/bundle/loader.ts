import { bundleSchema, type Bundle } from "./schema.js";
import { assertCompat, BundleCompatError, type HarnessSupport } from "./version.js";

export class BundleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleValidationError";
  }
}

export function loadBundle(json: unknown, support?: HarnessSupport): Bundle {
  const result = bundleSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("\n");
    throw new BundleValidationError(`invalid bundle structure:\n${issues}`);
  }

  assertCompat(result.data, support);
  return result.data;
}

/**
 * Which on-disk checkout actually produced (or would consume) a bundle — the piece a bare
 * {@link BundleCompatError} is missing. `resolveWarbleBinary` (`harness/compile/resolve-binary.ts`)
 * and `resolveDefaultProfileSource`/`resolveDefaultSetupIrPath` (`harness/route/profile-source.ts`)
 * each walk this package's ancestor directories independently looking for a sibling `warble`
 * checkout; nothing stops them from picking two DIFFERENT ones (a stale `warble` earlier on `PATH`
 * while the profile/IR sibling-walk still finds a fresh checkout, or vice versa), and when that
 * happens the resulting version mismatch is real IR-version friction, not a bug in the mismatch
 * detection itself — but the bare error names neither side's checkout, so diagnosing it means
 * reading `resolve-binary.ts`/`profile-source.ts` source to even know there's an ancestor walk to
 * suspect. See {@link loadBundleWithProvenance}.
 */
export interface BundleProvenance {
  /** The resolved `warble` binary path that compiled/dispatched this bundle, if known. */
  readonly warbleBin?: string;
  /** The resolved profile directory or pre-committed IR file this bundle was produced from, if known. */
  readonly profileSource?: string;
}

/**
 * {@link loadBundle}, but on a {@link BundleCompatError} names which on-disk checkout(s) produced
 * the bundle before rethrowing — the fix for the "which warble checkout did this even come from"
 * gap described on {@link BundleProvenance}. Every other error (malformed structure, unknown bundle
 * format version) passes through unchanged: provenance only helps once you already know it's a
 * version problem.
 */
export function loadBundleWithProvenance(json: unknown, provenance: BundleProvenance, support?: HarnessSupport): Bundle {
  try {
    return loadBundle(json, support);
  } catch (error) {
    if (error instanceof BundleCompatError) {
      const resolved = [
        provenance.warbleBin !== undefined ? `warble binary resolved from "${provenance.warbleBin}"` : undefined,
        provenance.profileSource !== undefined ? `profile/IR source resolved from "${provenance.profileSource}"` : undefined,
      ].filter((part): part is string => part !== undefined);
      if (resolved.length > 0) {
        throw new BundleCompatError(`${error.message} (${resolved.join("; ")})`);
      }
    }
    throw error;
  }
}
