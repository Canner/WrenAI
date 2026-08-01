import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WarbleBinaryNotFoundError } from "../harness/compile/errors.js";
import { resolveWarbleBinary } from "../harness/compile/resolve-binary.js";

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
