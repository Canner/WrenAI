import { bundleFormatVersion, type Bundle } from "./schema.js";

export class BundleCompatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleCompatError";
  }
}

export interface HarnessSupport {
  readonly irVersion: string;
  readonly bundleVersions: readonly string[];
}

export const HARNESS_SUPPORT: HarnessSupport = {
  irVersion: "0.6",
  bundleVersions: ["0.1"],
};

function parseVersion(version: string): readonly number[] {
  const parts = version.split(".").map(Number);
  if (parts.some((part) => Number.isNaN(part))) {
    throw new BundleCompatError(`malformed version string: "${version}"`);
  }
  return parts;
}

function compareVersions(a: string, b: string): number {
  const partsA = parseVersion(a);
  const partsB = parseVersion(b);
  const length = Math.max(partsA.length, partsB.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (partsA[index] ?? 0) - (partsB[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function assertCompat(
  bundle: Bundle,
  support: HarnessSupport = HARNESS_SUPPORT,
): void {
  const formatVersion = bundleFormatVersion(bundle);
  if (!support.bundleVersions.includes(formatVersion)) {
    throw new BundleCompatError(
      `unsupported bundle format version "${formatVersion}"; ` +
        `harness supports: ${support.bundleVersions.join(", ")}`,
    );
  }

  const { min_ir_version: min, max_ir_version: max } = bundle.compat;
  const withinMin = compareVersions(support.irVersion, min) >= 0;
  const withinMax = compareVersions(support.irVersion, max) <= 0;
  if (!withinMin || !withinMax) {
    throw new BundleCompatError(
      `bundle compat window [${min}, ${max}] does not include harness IR ` +
        `version "${support.irVersion}"`,
    );
  }
}
