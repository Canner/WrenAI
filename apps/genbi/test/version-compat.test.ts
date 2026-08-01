import { describe, expect, it } from "vitest";
import { loadBundle, BundleValidationError } from "../harness/bundle/loader.js";
import { bundleFormatVersion } from "../harness/bundle/schema.js";
import { BundleCompatError } from "../harness/bundle/version.js";
import { buildSyntheticBundle } from "./synthetic-bundle.js";

describe("loadBundle: version/compat check", () => {
  it("loud-fails when the compat IR window excludes the harness's supported version", () => {
    const bundle = buildSyntheticBundle({ minIrVersion: "0.4", maxIrVersion: "0.4" });
    expect(() => loadBundle(bundle)).toThrow(BundleCompatError);
    expect(() => loadBundle(bundle)).toThrow(/0\.4/);
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
    const bundle = buildSyntheticBundle({ minIrVersion: "0.1", maxIrVersion: "0.5" });
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
