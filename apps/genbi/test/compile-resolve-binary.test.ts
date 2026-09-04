import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WarbleBinaryNotFoundError } from "../harness/compile/errors.js";
import { resolveHubDir, resolveWarbleBinary } from "../harness/compile/resolve-binary.js";

describe("resolveWarbleBinary", () => {
  it("returns an explicit path as-is when it exists", async () => {
    // Any existing file stands in here — resolveWarbleBinary only checks existence for the
    // explicit tier, it doesn't try to execute it.
    const existing = process.execPath;
    await expect(resolveWarbleBinary(existing)).resolves.toBe(existing);
  });

  it("loud-fails with a clear WarbleBinaryNotFoundError when the explicit path doesn't exist", async () => {
    const scratch = await mkdtemp(path.join(os.tmpdir(), "wren-harness-no-warble-"));
    const missing = path.join(scratch, "definitely-not-a-warble-binary");

    await expect(resolveWarbleBinary(missing)).rejects.toThrow(WarbleBinaryNotFoundError);
    await expect(resolveWarbleBinary(missing)).rejects.toThrow(/does not exist/);
  });

  it("resolves a binary with no explicit arg in this workspace (PATH or the sibling warble release build)", async () => {
    // This is an environment sanity check, not a hermetic unit test: it documents that at least
    // one of the PATH / sibling-repo tiers succeeds in this dev workspace (see the module doc
    // comment on resolveWarbleBinary for the resolution order).
    await expect(resolveWarbleBinary()).resolves.toEqual(expect.any(String));
  });

  it("resolves via the pinned @warble/cli package, not PATH, when no explicit arg is given", async () => {
    // This workspace has @warble/cli installed (a pinned dependency of apps/genbi), so tier 2
    // must win: the resolved path must point into this package's own node_modules, never a bare
    // "warble" name (which would mean a PATH probe or an unqualified sibling checkout answered
    // instead).
    const resolved = await resolveWarbleBinary();
    expect(resolved).not.toBe("warble");
    expect(resolved).toContain("@warble+cli");
  });

  it("does not fall through to the sibling checkout tier when WREN_HARNESS_ALLOW_WARBLE_SIBLING_CHECKOUT is unset", async () => {
    const prior = process.env.WREN_HARNESS_ALLOW_WARBLE_SIBLING_CHECKOUT;
    delete process.env.WREN_HARNESS_ALLOW_WARBLE_SIBLING_CHECKOUT;
    try {
      const resolved = await resolveWarbleBinary();
      // Regardless of whether a sibling `warble` checkout happens to exist next to this repo on
      // this machine, the installed package must answer first — a sibling checkout's
      // target/release/warble path must never appear here by default.
      expect(resolved).not.toMatch(/\/warble\/target\/release\/warble$/);
    } finally {
      if (prior !== undefined) process.env.WREN_HARNESS_ALLOW_WARBLE_SIBLING_CHECKOUT = prior;
    }
  });
});

describe("resolveHubDir", () => {
  it("derives the Hub root from the resolved binary's own checkout", async () => {
    const scratch = await mkdtemp(path.join(os.tmpdir(), "wren-harness-hub-dir-"));
    const checkout = path.join(scratch, "warble");
    const hubDir = path.join(checkout, "hub", "components");
    await mkdir(hubDir, { recursive: true });
    await mkdir(path.join(checkout, "target", "release"), { recursive: true });

    // The file need not exist: what is derived is a location, not the binary's contents.
    expect(resolveHubDir(path.join(checkout, "target", "release", "warble"))).toBe(hubDir);
  });

  it("falls through to the sibling-checkout walk when the binary's own checkout has no hub/components", async () => {
    const scratch = await mkdtemp(path.join(os.tmpdir(), "wren-harness-hub-dir-none-"));
    await mkdir(path.join(scratch, "target", "release"), { recursive: true });

    const resolved = resolveHubDir(path.join(scratch, "target", "release", "warble"));
    // Whether the fallback finds anything depends on the checkout layout this runs in, so the
    // assertion is the part that must hold either way: nothing under the binary's own (Hub-less)
    // tree may be reported as a Hub root.
    if (resolved !== undefined) expect(resolved.startsWith(scratch)).toBe(false);
  });

  it("does not derive a Hub root from the process cwd for a bare PATH binary", () => {
    // `path.dirname("warble") === "."`, so a naive `../../..` would name an ancestor of wherever
    // the process happens to be running. Only the sibling walk (anchored to this package, not the
    // cwd) may answer for a bare name.
    const fromCwd = path.resolve("warble", "..", "..", "..", "hub", "components");
    const resolved = resolveHubDir("warble");
    if (resolved !== undefined) expect(resolved).not.toBe(fromCwd);
  });
});

/**
 * `"warble"` names a command, not a file. Treating it as a path made it an
 * explicit value that could never resolve, while the native-session preflight
 * — which resolves a bare name through PATH — reported the same string healthy.
 * One string, two answers, and every compile failed on an installed package
 * while the producer preflight said it was compatible.
 */
describe("resolveWarbleBinary with a bare command name", () => {
  it("resolves it on PATH rather than requiring a file of that name in the cwd", async () => {
    const scratch = await mkdtemp(path.join(os.tmpdir(), "wren-harness-bare-name-"));
    const binDir = path.join(scratch, "bin");
    await mkdir(binDir);
    const command = "genbi-test-warble-shim";
    await writeFile(path.join(binDir, command), "#!/bin/sh\nexit 0\n", { mode: 0o700 });

    const originalPath = process.env["PATH"];
    // Proves the resolution is PATH-driven and not cwd-relative: nothing named
    // `command` exists anywhere below the working directory.
    expect(existsSync(path.resolve(command))).toBe(false);
    process.env["PATH"] = `${binDir}${path.delimiter}${originalPath ?? ""}`;
    try {
      await expect(resolveWarbleBinary(command)).resolves.toBe(command);
    } finally {
      if (originalPath === undefined) delete process.env["PATH"]; else process.env["PATH"] = originalPath;
    }
  });

  it("still loud-fails when the bare name is on no PATH entry", async () => {
    const originalPath = process.env["PATH"];
    process.env["PATH"] = await mkdtemp(path.join(os.tmpdir(), "wren-harness-empty-path-"));
    try {
      await expect(resolveWarbleBinary("genbi-test-absent-command")).rejects.toThrow(/is not on PATH/);
    } finally {
      if (originalPath === undefined) delete process.env["PATH"]; else process.env["PATH"] = originalPath;
    }
  });
});
