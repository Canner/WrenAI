import { afterEach, describe, expect, it } from "vitest";
import { WrenBinaryNotFoundError } from "../harness/tools/errors.js";
import { resolveWrenBinary } from "../harness/tools/resolve-wren-binary.js";

describe("resolveWrenBinary (preflight)", () => {
  const originalPath = process.env["PATH"];

  afterEach(() => {
    if (originalPath === undefined) {
      delete process.env["PATH"];
    } else {
      process.env["PATH"] = originalPath;
    }
  });

  it("resolves without throwing when wren is on PATH (environment sanity check)", async () => {
    await expect(resolveWrenBinary()).resolves.toBeUndefined();
  });

  it("loud-fails with a clear WrenBinaryNotFoundError when wren is not on PATH", async () => {
    process.env["PATH"] = "";

    await expect(resolveWrenBinary()).rejects.toThrow(WrenBinaryNotFoundError);
    await expect(resolveWrenBinary()).rejects.toThrow(/could not find the "wren" binary/);
  });
});
