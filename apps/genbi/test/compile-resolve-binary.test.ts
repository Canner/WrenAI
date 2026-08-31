import { mkdir, mkdtemp } from "node:fs/promises";
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
