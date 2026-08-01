import { bundleSchema, type Bundle } from "./schema.js";
import { assertCompat, type HarnessSupport } from "./version.js";

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
