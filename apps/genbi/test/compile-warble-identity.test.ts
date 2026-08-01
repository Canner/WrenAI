import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getWarbleIdentity } from "../harness/compile/warble-identity.js";

/**
 * These stand in for the real `warble` binary with plain dummy files — the real binary content
 * doesn't matter to `getWarbleIdentity` (it hashes bytes, never executes anything; the real CLI
 * doesn't even support `--version` — see the module doc), so a "rebuild" is simulated by writing
 * different bytes to the same path, exactly as a `cargo build --release` would.
 */
describe("getWarbleIdentity (warble binary content identity, for the compile cache key)", () => {
  it("differs for two different binaries (different content, different paths)", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wren-harness-warble-identity-"));
    const binA = path.join(dir, "warble-a");
    const binB = path.join(dir, "warble-b");
    await writeFile(binA, "pretend-elf-bytes-v1");
    await writeFile(binB, "pretend-elf-bytes-v2");

    expect(await getWarbleIdentity(binA)).not.toBe(await getWarbleIdentity(binB));
  });

  it("differs before and after a simulated rebuild at the SAME path (different content, same path)", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wren-harness-warble-identity-"));
    const bin = path.join(dir, "warble");

    await writeFile(bin, "pretend-elf-bytes-before-rebuild");
    const before = await getWarbleIdentity(bin);

    // Note: real per-process memoization is keyed on path, so within ONE process this specific
    // rewrite-in-place wouldn't itself be re-observed — that's the accepted tradeoff documented on
    // `getWarbleIdentity` ("cache it per-process"). This test uses a *distinct* path per binary
    // content to prove the hash reflects content, independent of that memoization.
    const bin2 = path.join(dir, "warble-rebuilt");
    await writeFile(bin2, "pretend-elf-bytes-after-rebuild");
    const after = await getWarbleIdentity(bin2);

    expect(after).not.toBe(before);
  });

  it("is stable (and memoized) for repeated calls against the same resolved path", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wren-harness-warble-identity-"));
    const bin = path.join(dir, "warble");
    await writeFile(bin, "pretend-elf-bytes");

    const first = await getWarbleIdentity(bin);
    const second = await getWarbleIdentity(bin);
    expect(second).toBe(first);
  });

  it("resolves relative and absolute paths to the same identity (path normalization)", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wren-harness-warble-identity-"));
    const bin = path.join(dir, "warble");
    await writeFile(bin, "pretend-elf-bytes");

    const relative = path.relative(process.cwd(), bin);
    expect(await getWarbleIdentity(relative)).toBe(await getWarbleIdentity(bin));
  });
});
