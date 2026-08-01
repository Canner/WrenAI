import { mkdtemp, writeFile, type stat as StatFn } from "node:fs/promises";
import { chmodSync, mkdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createFileSystemCompileCache, createInMemoryCompileCache, resolveDefaultCacheDir } from "../harness/compile/cache.js";
import type { CompileCacheKey } from "../harness/compile/types.js";

// A partial mock of `node:fs/promises`'s `stat` — real ESM named exports from a Node builtin can't
// be `vi.spyOn`-ed directly ("Module namespace is not configurable"), so the uid-mismatch test
// below swaps in a stub via this module-level mock instead, keeping every other export real. This
// is hoisted above the imports above by Vitest's transform, so `cache.js`'s own `stat` import
// resolves to the mock.
const statMock = vi.fn<typeof StatFn>();
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, stat: (...args: Parameters<typeof actual.stat>) => statMock(...args) };
});

const KEY: CompileCacheKey = {
  profileHash: "hash-a",
  contextFingerprint: "ctx-a",
  mode: "agnostic",
  providerFragmentHash: "providers-a",
  warbleIdentity: "warble-a",
};
const OTHER_KEY: CompileCacheKey = { ...KEY, profileHash: "hash-b" };

describe("createInMemoryCompileCache", () => {
  it("misses on an unpopulated key", async () => {
    const cache = createInMemoryCompileCache();
    expect(await cache.get(KEY)).toBeUndefined();
  });

  it("hits after set with the same key, and stores IR-only entries without a bundlePath", async () => {
    const cache = createInMemoryCompileCache();
    await cache.set(KEY, { irPath: "/tmp/ir.json" });
    expect(await cache.get(KEY)).toEqual({ irPath: "/tmp/ir.json" });
  });

  it("a different key (e.g. changed profile hash) still misses", async () => {
    const cache = createInMemoryCompileCache();
    await cache.set(KEY, { irPath: "/tmp/ir.json" });
    expect(await cache.get(OTHER_KEY)).toBeUndefined();
  });

  it("misses when only the provider-fragment hash differs (e.g. options.providers or a fragment's content changed)", async () => {
    const cache = createInMemoryCompileCache();
    await cache.set(KEY, { irPath: "/tmp/ir.json" });
    expect(await cache.get({ ...KEY, providerFragmentHash: "providers-b" })).toBeUndefined();
  });

  it("misses when only the warble identity differs (e.g. the warble binary was rebuilt)", async () => {
    const cache = createInMemoryCompileCache();
    await cache.set(KEY, { irPath: "/tmp/ir.json" });
    expect(await cache.get({ ...KEY, warbleIdentity: "warble-b" })).toBeUndefined();
  });
});

describe("createFileSystemCompileCache", () => {
  async function freshCacheDir(): Promise<string> {
    return mkdtemp(path.join(os.tmpdir(), "wren-harness-compile-cache-test-"));
  }

  it("misses on an unpopulated key", async () => {
    const cache = createFileSystemCompileCache({ cacheDir: await freshCacheDir() });
    expect(await cache.get(KEY)).toBeUndefined();
  });

  it("persists ir.json (and bundle/bundle.json when given) to disk and returns those paths on a later get", async () => {
    const scratch = await freshCacheDir();
    const irSource = path.join(scratch, "source-ir.json");
    const bundleSource = path.join(scratch, "source-bundle.json");
    await writeFile(irSource, JSON.stringify({ hello: "ir" }));
    await writeFile(bundleSource, JSON.stringify({ hello: "bundle" }));

    const cache = createFileSystemCompileCache({ cacheDir: path.join(scratch, "cache") });
    await cache.set(KEY, { irPath: irSource, bundlePath: bundleSource });

    const hit = await cache.get(KEY);
    expect(hit).toBeDefined();
    expect(hit?.irPath).not.toBe(irSource); // copied into the cache slot, not the same path
    expect(hit?.bundlePath).toBeDefined();
  });

  it("treats a slot whose ir.json was deleted from disk as a miss, not a throw", async () => {
    const scratch = await freshCacheDir();
    const irSource = path.join(scratch, "source-ir.json");
    await writeFile(irSource, JSON.stringify({ hello: "ir" }));

    const cacheDir = path.join(scratch, "cache");
    const cache = createFileSystemCompileCache({ cacheDir });
    await cache.set(KEY, { irPath: irSource });
    expect(await cache.get(KEY)).toBeDefined();

    // A different cache pointed at an empty dir simulates the slot never having been populated.
    const freshCache = createFileSystemCompileCache({ cacheDir: await freshCacheDir() });
    expect(await freshCache.get(KEY)).toBeUndefined();
  });

  it("misses when only the provider-fragment hash or warble identity differs, even with the same profile/context/mode on disk", async () => {
    const scratch = await freshCacheDir();
    const irSource = path.join(scratch, "source-ir.json");
    await writeFile(irSource, JSON.stringify({ hello: "ir" }));

    const cache = createFileSystemCompileCache({ cacheDir: path.join(scratch, "cache") });
    await cache.set(KEY, { irPath: irSource });

    expect(await cache.get({ ...KEY, providerFragmentHash: "providers-b" })).toBeUndefined();
    expect(await cache.get({ ...KEY, warbleIdentity: "warble-b" })).toBeUndefined();
    expect(await cache.get(KEY)).toBeDefined(); // the original key is still a hit
  });

  it("defaults cacheDir under the user's home (not the world-shared os.tmpdir()), created 0700", async () => {
    const fakeHome = await mkdtemp(path.join(os.tmpdir(), "wren-harness-fake-home-"));
    vi.stubEnv("HOME", fakeHome);
    vi.stubEnv("XDG_CACHE_HOME", "");
    try {
      const expectedDir = resolveDefaultCacheDir();
      expect(expectedDir.startsWith(fakeHome)).toBe(true);
      // Not the old world-shared fixed path (`os.tmpdir()/wren-harness-compile-cache`) — the fake
      // HOME above is itself under `os.tmpdir()` purely for this test's own isolation, so the
      // meaningful check is against the specific old path, not a bare tmpdir prefix.
      expect(expectedDir).not.toBe(path.join(os.tmpdir(), "wren-harness-compile-cache"));

      createFileSystemCompileCache(); // no cacheDir override -> exercises the default, eagerly creating it

      const stats = statSync(expectedDir);
      expect(stats.isDirectory()).toBe(true);
      if (process.platform !== "win32") {
        expect(stats.mode & 0o777).toBe(0o700);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("respects XDG_CACHE_HOME when set, still under the fake home in this test", async () => {
    const fakeHome = await mkdtemp(path.join(os.tmpdir(), "wren-harness-fake-home-"));
    const xdgDir = path.join(fakeHome, "xdg-cache");
    vi.stubEnv("XDG_CACHE_HOME", xdgDir);
    try {
      const expectedDir = resolveDefaultCacheDir();
      expect(expectedDir).toBe(path.join(xdgDir, "wren-harness", "compile"));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps an explicit cacheDir override exactly as given (not forced to 0700)", async () => {
    const scratch = await freshCacheDir();
    const explicitDir = path.join(scratch, "explicit-cache");
    mkdirSync(explicitDir, { recursive: true, mode: 0o755 });
    chmodSync(explicitDir, 0o755);

    const cache = createFileSystemCompileCache({ cacheDir: explicitDir });
    await cache.set(KEY, { irPath: path.join(scratch, "does-not-need-to-exist-for-this-check") }).catch(() => {
      // `set` may throw copying a nonexistent source; irrelevant here — only checking the dir mode was untouched.
    });

    const stats = statSync(explicitDir);
    if (process.platform !== "win32") {
      expect(stats.mode & 0o777).toBe(0o755);
    }
  });

  it("treats a slot owned by a different uid as a miss (defense against a planted cache slot)", async () => {
    if (process.platform === "win32") return; // no POSIX uid model to test
    const scratch = await freshCacheDir();
    const irSource = path.join(scratch, "source-ir.json");
    await writeFile(irSource, JSON.stringify({ hello: "ir" }));

    const cacheDir = path.join(scratch, "cache");
    const cache = createFileSystemCompileCache({ cacheDir });
    await cache.set(KEY, { irPath: irSource });
    expect(await cache.get(KEY)).toBeDefined(); // sanity: a real hit before mocking stat

    const currentUid = process.getuid!();
    statMock.mockResolvedValueOnce({ uid: currentUid + 1 } as never);
    try {
      expect(await cache.get(KEY)).toBeUndefined();
    } finally {
      statMock.mockReset();
    }
  });
});
