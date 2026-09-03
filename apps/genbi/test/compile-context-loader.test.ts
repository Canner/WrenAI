import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createInMemoryCompileCache } from "../harness/compile/cache.js";
import { resolveContextLoaderBinary } from "../harness/compile/context-loader.js";
import { ContextLoaderNotFoundError } from "../harness/compile/errors.js";
import { compileProfile } from "../harness/compile/pipeline.js";
import type { CompileCache, CompileCacheKey } from "../harness/compile/types.js";
import { getBinaryIdentity } from "../harness/compile/warble-identity.js";

const ENV_VAR = "WREN_HARNESS_CONTEXT_LOADER_BIN";

const originalEnv = process.env[ENV_VAR];
afterEach(() => {
  if (originalEnv === undefined) delete process.env[ENV_VAR];
  else process.env[ENV_VAR] = originalEnv;
});

/** An executable stub whose bytes depend on `marker`, so two markers are two distinct binaries. */
async function makeLoaderStub(marker: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wren-harness-loader-"));
  const bin = path.join(dir, "wren-context-loader");
  await writeFile(
    bin,
    `#!/bin/sh\n# generator build: ${marker}\nprintf '{"context_version":1,"parseable":true}' > "$3"\n`,
    { mode: 0o755 },
  );
  return bin;
}

/** A `warble` stub that writes a trivial IR to whatever path follows `-o`, and ignores the rest. */
async function makeWarbleStub(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wren-harness-warble-"));
  const bin = path.join(dir, "warble");
  await writeFile(
    bin,
    `#!/bin/sh\nwhile [ $# -gt 0 ]; do\n  if [ "$1" = "-o" ]; then shift; printf '{}' > "$1"; fi\n  shift\ndone\n`,
    { mode: 0o755 },
  );
  return bin;
}

describe("resolveContextLoaderBinary", () => {
  it("returns an explicit override that exists, without searching further", async () => {
    const bin = await makeLoaderStub("explicit");
    expect(resolveContextLoaderBinary(bin)).toBe(bin);
  });

  it("reads the WREN_HARNESS_CONTEXT_LOADER_BIN override when no explicit path is given", async () => {
    const bin = await makeLoaderStub("from-env");
    process.env[ENV_VAR] = bin;
    expect(resolveContextLoaderBinary()).toBe(bin);
  });

  it("loud-fails on an explicit override that does not exist — it does NOT fall through to a search", () => {
    // Discriminating: this repo *does* carry an in-repo build (that is how the integration suites
    // run), so a resolver that fell through on a bad override would quietly return that build and
    // this call would not throw at all.
    expect(() => resolveContextLoaderBinary("/definitely/not/a/context/loader")).toThrow(ContextLoaderNotFoundError);
    expect(() => resolveContextLoaderBinary("/definitely/not/a/context/loader")).toThrow(
      /explicit contextLoaderBin .* does not exist/,
    );
  });

  it("loud-fails on a WREN_HARNESS_CONTEXT_LOADER_BIN pointing at nothing, rather than silently searching", () => {
    process.env[ENV_VAR] = "/definitely/not/a/context/loader";
    expect(() => resolveContextLoaderBinary()).toThrow(ContextLoaderNotFoundError);
    expect(() => resolveContextLoaderBinary()).toThrow(new RegExp(`${ENV_VAR} .* does not exist`));
  });

  it("names every attempt it made in the failure, so the fix is readable off the error", () => {
    process.env[ENV_VAR] = "/definitely/not/a/context/loader";
    let message = "";
    try {
      resolveContextLoaderBinary();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("could not resolve");
    expect(message).toContain("cargo build --release --manifest-path core/wren-context-loader/Cargo.toml");
  });
});

describe("getBinaryIdentity over the generator", () => {
  it("gives two byte-different generator builds two different identities", async () => {
    const a = await makeLoaderStub("build-a");
    const b = await makeLoaderStub("build-b");
    expect(await getBinaryIdentity(a)).not.toBe(await getBinaryIdentity(b));
  });
});

/**
 * Criterion: a generator change must invalidate the compile cache **with the user project held
 * constant**. `contextFingerprint` already content-hashes the project, so it cannot carry this —
 * only the generator's own identity can.
 *
 * Built to be able to FAIL rather than merely to execute: `compileProfile` runs twice over the same
 * profile and the same project, changing nothing but which generator binary it resolves, and the
 * assertions are that the second call MISSES and that the two recorded keys differ in
 * `contextLoaderIdentity` alone. Drop `contextLoaderIdentity` from `keyDigest` and the miss becomes
 * a hit; stop threading it from the resolved binary and the recorded values stop differing.
 */
describe("compile cache key vs a generator change (project held constant)", () => {
  /**
   * Wraps a cache so the key it was last consulted with is observable, without changing hit/miss
   * semantics. Deliberately "last seen" rather than an append-only list: a single `compileProfile`
   * miss consults the cache twice (once to look up, once to pick up the cache's persisted paths
   * after `set`), so positional indexing into a growing list does not line up with call boundaries.
   */
  function recordingCache(inner: CompileCache, seen: { last?: CompileCacheKey }): CompileCache {
    return {
      async get(key) {
        seen.last = key;
        return inner.get(key);
      },
      set: (key, entry) => inner.set(key, entry),
    };
  }

  async function makeProfileAndProject(): Promise<{ profileSource: string; userProject: string }> {
    const profileSource = await mkdtemp(path.join(os.tmpdir(), "wren-harness-key-profile-"));
    await writeFile(
      path.join(profileSource, "profile.yml"),
      ["profile: key-fixture", "", "context:", "  project: ./binding.yml", ""].join("\n"),
    );
    await writeFile(
      path.join(profileSource, "binding.yml"),
      ["kind: prepared", "project: ./fixture-project", "document: context.json", ""].join("\n"),
    );
    const userProject = await mkdtemp(path.join(os.tmpdir(), "wren-harness-key-project-"));
    await writeFile(path.join(userProject, "wren_project.yml"), "project: key-fixture\n");
    return { profileSource, userProject };
  }

  it("misses on a different generator build, and hits again on the original one", async () => {
    const { profileSource, userProject } = await makeProfileAndProject();
    const warbleBin = await makeWarbleStub();
    const loaderA = await makeLoaderStub("build-a");
    const loaderB = await makeLoaderStub("build-b");

    const seen: { last?: CompileCacheKey } = {};
    const cache = recordingCache(createInMemoryCompileCache(), seen);
    const base = { profileSource, userProject, mode: "native" as const, cache, warbleBin, hubDir: "/fixture/hub" };

    const first = await compileProfile({ ...base, contextLoaderBin: loaderA });
    expect(first.cacheHit).toBe(false);
    const keyA = seen.last;

    // Same profile, same project, same warble, same Hub — only the generator differs.
    const second = await compileProfile({ ...base, contextLoaderBin: loaderB });
    expect(second.cacheHit).toBe(false);
    const keyB = seen.last;

    // ...and the original generator still finds its own entry, so the miss above was the generator
    // change and not a cache that simply never hits.
    const third = await compileProfile({ ...base, contextLoaderBin: loaderA });
    expect(third.cacheHit).toBe(true);

    expect(keyA?.contextLoaderIdentity).toBeDefined();
    expect(keyA?.contextLoaderIdentity).not.toBe(keyB?.contextLoaderIdentity);
    // Everything else about the key is unchanged — this is the "project held constant" half.
    expect(keyA?.contextFingerprint).toBe(keyB?.contextFingerprint);
    expect(keyA?.profileHash).toBe(keyB?.profileHash);
    expect(keyA?.warbleIdentity).toBe(keyB?.warbleIdentity);
    expect(keyA?.hubDir).toBe(keyB?.hubDir);
  }, 30_000);
});
