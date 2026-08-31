import { describe, expect, it } from "vitest";
import { isWarbleSiblingCheckoutDevModeEnabled, resolveInstalledPackageBin } from "../harness/npm-package-resolve.js";

describe("resolveInstalledPackageBin", () => {
  it("resolves the pinned @warble/cli package's warble bin to a real file", () => {
    const resolved = resolveInstalledPackageBin("@warble/cli", "warble");
    expect(resolved).toEqual(expect.any(String));
  });

  it("resolves the pinned @warble/claude-agent-sdk package's warble-agent-sdk bin to a real file", () => {
    const resolved = resolveInstalledPackageBin("@warble/claude-agent-sdk", "warble-agent-sdk");
    expect(resolved).toEqual(expect.any(String));
  });

  it("resolves the pinned @warble/codex-local package's warble-codex-local bin to a real file", () => {
    const resolved = resolveInstalledPackageBin("@warble/codex-local", "warble-codex-local");
    expect(resolved).toEqual(expect.any(String));
  });

  it("returns undefined for a package that isn't installed at all", () => {
    expect(resolveInstalledPackageBin("@warble/definitely-not-a-real-package", "warble")).toBeUndefined();
  });

  it("returns undefined for a bin name the package doesn't declare", () => {
    expect(resolveInstalledPackageBin("@warble/cli", "not-a-real-bin-name")).toBeUndefined();
  });

  it("returns undefined rather than throwing for a package with no package.json bin field", () => {
    // "typescript" is a real, always-installed devDependency whose bin map doesn't include this name.
    expect(resolveInstalledPackageBin("typescript", "not-a-real-bin-name")).toBeUndefined();
  });
});

describe("isWarbleSiblingCheckoutDevModeEnabled", () => {
  const ENV_VAR = "WREN_HARNESS_ALLOW_WARBLE_SIBLING_CHECKOUT";

  it("is off by default (unset)", () => {
    const prior = process.env[ENV_VAR];
    delete process.env[ENV_VAR];
    try {
      expect(isWarbleSiblingCheckoutDevModeEnabled()).toBe(false);
    } finally {
      if (prior !== undefined) process.env[ENV_VAR] = prior;
    }
  });

  it("is off for any value other than the exact string \"1\"", () => {
    const prior = process.env[ENV_VAR];
    try {
      for (const value of ["true", "yes", "0", ""]) {
        process.env[ENV_VAR] = value;
        expect(isWarbleSiblingCheckoutDevModeEnabled()).toBe(false);
      }
    } finally {
      if (prior === undefined) delete process.env[ENV_VAR];
      else process.env[ENV_VAR] = prior;
    }
  });

  it("is on when set to exactly \"1\"", () => {
    const prior = process.env[ENV_VAR];
    process.env[ENV_VAR] = "1";
    try {
      expect(isWarbleSiblingCheckoutDevModeEnabled()).toBe(true);
    } finally {
      if (prior === undefined) delete process.env[ENV_VAR];
      else process.env[ENV_VAR] = prior;
    }
  });
});
