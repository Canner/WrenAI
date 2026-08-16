/**
 * The profile source behind each read-only Harness purpose is BFF-owned boot
 * configuration. Callers can choose a closed purpose, never a filesystem path
 * or another profile source.
 */
import path from "node:path";
import { assertHarnessPurposeProfile, NATIVE_DISPATCH_REGISTRY } from "./native-dispatch-registry.js";
import type { NativePurpose } from "./native-dispatch-registry.js";

export type HarnessProfileSources = Readonly<Record<NativePurpose, string>>;

export function createHarnessProfileSources(analysisProfileSource: string): HarnessProfileSources {
  const analysis = path.resolve(analysisProfileSource);
  // `WREN_HARNESS_PROFILE` may configure only the canonical analysis source.
  // This is an early boot guard; the compiled bundle is checked again before
  // it can become a read-only Harness response.
  assertHarnessPurposeProfile("analysis", path.basename(analysis));
  const profileRoot = path.dirname(analysis);
  const sources = {
    analysis,
    setup: path.join(profileRoot, NATIVE_DISPATCH_REGISTRY.setup.profile),
    context_enrichment: path.join(profileRoot, NATIVE_DISPATCH_REGISTRY.context_enrichment.profile),
  };
  for (const purpose of Object.keys(sources) as NativePurpose[]) {
    assertHarnessPurposeProfile(purpose, path.basename(sources[purpose]));
  }
  return sources;
}
