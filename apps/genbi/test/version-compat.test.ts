import { describe, expect, it } from "vitest";
import { loadBundle, loadBundleWithProvenance, BundleValidationError } from "../harness/bundle/loader.js";
import { bundleFormatVersion } from "../harness/bundle/schema.js";
import { BundleCompatError } from "../harness/bundle/version.js";
import { buildSyntheticBundle } from "./synthetic-bundle.js";

describe("loadBundle: version/compat check", () => {
  it("loud-fails when the compat IR window excludes the harness's supported version", () => {
    // 0.5–0.5 is the exact stale-checkout scenario this ticket fixed: a compat window one warble
    // IR bump behind the harness's current "0.6" (harness/bundle/version.ts's HARNESS_SUPPORT).
    const bundle = buildSyntheticBundle({ minIrVersion: "0.5", maxIrVersion: "0.5" });
    expect(() => loadBundle(bundle)).toThrow(BundleCompatError);
    // Names both sides: the bundle's own window and the harness's version.
    expect(() => loadBundle(bundle)).toThrow(/\[0\.5, 0\.5\]/);
    expect(() => loadBundle(bundle)).toThrow(/harness IR version "0\.6"/);
  });

  it("loud-fails on an unknown vercel_bundle_version", () => {
    const bundle = buildSyntheticBundle() as Record<string, unknown>;
    bundle.vercel_bundle_version = "9.9";
    expect(() => loadBundle(bundle)).toThrow(BundleCompatError);
  });

  it("loud-fails with a clear message on malformed bundle structure", () => {
    expect(() => loadBundle({ not: "a bundle" })).toThrow(BundleValidationError);
  });

  it("accepts a bundle whose window includes the harness IR version", () => {
    const bundle = buildSyntheticBundle({ minIrVersion: "0.1", maxIrVersion: "0.6" });
    expect(() => loadBundle(bundle)).not.toThrow();
  });

  it("accepts a manifest_version bundle (claude-agent-sdk target) the same as a vercel_bundle_version one", () => {
    const bundle = buildSyntheticBundle({ target: "claude-agent-sdk:local", versionField: "manifest_version" });
    expect(() => loadBundle(bundle)).not.toThrow();
    expect(loadBundle(bundle).target).toBe("claude-agent-sdk:local");
  });

  it("loud-fails when a bundle has neither vercel_bundle_version nor manifest_version", () => {
    const bundle = buildSyntheticBundle() as Record<string, unknown>;
    delete bundle.vercel_bundle_version;
    expect(() => loadBundle(bundle)).toThrow(BundleValidationError);
  });
});

describe("loadBundleWithProvenance: names the resolved checkout(s) on a compat mismatch", () => {
  // Regression for the "which warble checkout produced this" gap: `resolveWarbleBinary` and
  // `resolveDefaultProfileSource`/`resolveDefaultSetupIrPath` (harness/compile/resolve-binary.ts,
  // harness/route/profile-source.ts) each walk this package's ancestors independently and can
  // resolve to two different sibling `warble` checkouts without either side knowing — a bare
  // BundleCompatError names the version mismatch but not which on-disk checkout(s) produced it,
  // so diagnosing it means reading the resolver source. loadBundleWithProvenance closes that gap.
  const MISMATCHED_BUNDLE = buildSyntheticBundle({ minIrVersion: "0.3", maxIrVersion: "0.3" });

  it("appends both the warble binary and profile/IR source paths to the thrown message", () => {
    expect(() =>
      loadBundleWithProvenance(MISMATCHED_BUNDLE, {
        warbleBin: "/sibling/warble/target/release/warble",
        profileSource: "/sibling/warble/genbi-default",
      }),
    ).toThrow(BundleCompatError);
    expect(() =>
      loadBundleWithProvenance(MISMATCHED_BUNDLE, {
        warbleBin: "/sibling/warble/target/release/warble",
        profileSource: "/sibling/warble/genbi-default",
      }),
    ).toThrow(
      /warble binary resolved from "\/sibling\/warble\/target\/release\/warble".*profile\/IR source resolved from "\/sibling\/warble\/genbi-default"/s,
    );
  });

  it("still throws BundleCompatError with the original message when no provenance is known", () => {
    expect(() => loadBundleWithProvenance(MISMATCHED_BUNDLE, {})).toThrow(BundleCompatError);
    expect(() => loadBundleWithProvenance(MISMATCHED_BUNDLE, {})).toThrow(/does not include harness IR version/);
  });

  it("passes non-compat errors (malformed structure) through unchanged", () => {
    expect(() => loadBundleWithProvenance({ not: "a bundle" }, { warbleBin: "/x" })).toThrow(BundleValidationError);
  });

  it("does not throw, and behaves exactly like loadBundle, on a compatible bundle", () => {
    const bundle = buildSyntheticBundle();
    expect(loadBundleWithProvenance(bundle, { warbleBin: "/x", profileSource: "/y" })).toEqual(loadBundle(bundle));
  });
});

describe("bundleFormatVersion", () => {
  it("reads vercel_bundle_version on a vercel-target bundle", () => {
    const bundle = loadBundle(buildSyntheticBundle());
    expect(bundleFormatVersion(bundle)).toBe("0.1");
  });

  it("reads manifest_version on a claude-agent-sdk-target bundle", () => {
    const bundle = loadBundle(buildSyntheticBundle({ target: "claude-agent-sdk:local", versionField: "manifest_version" }));
    expect(bundleFormatVersion(bundle)).toBe("0.1");
  });
});
