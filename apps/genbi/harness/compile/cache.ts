import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { cp, mkdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CompileCache, CompileCacheEntry, CompileCacheKey } from "./types.js";

/**
 * Deterministic on-disk slot name for a cache key — order-independent, one directory per (profile,
 * context, mode, provider-fragment-hash, warble-identity, context-loader-identity, hub-dir). An
 * absent `hubDir` (no `--hub-dir` passed, so warble's compiled-in default applied) hashes as the
 * empty string, which is a distinct value from any real root rather than an alias for one.
 */
function keyDigest(key: CompileCacheKey): string {
  return createHash("sha256")
    .update(
      `${key.profileHash}:${key.contextFingerprint}:${key.mode}:${key.providerFragmentHash}:${key.warbleIdentity}:${key.contextLoaderIdentity}:${key.hubDir ?? ""}`,
    )
    .digest("hex");
}

/**
 * The default cache root, rooted under the *current user's* home rather than a world-shared
 * fixed path like `os.tmpdir()` — on a multi-user host, a predictable shared tmpdir path lets
 * another local account pre-create the dir and plant a slot for a computable cache key.
 * Respects `XDG_CACHE_HOME` when set, matching the XDG base-dir convention.
 */
export function resolveDefaultCacheDir(): string {
  const xdgCacheHome = process.env.XDG_CACHE_HOME;
  const base = xdgCacheHome !== undefined && xdgCacheHome.trim().length > 0 ? xdgCacheHome : path.join(os.homedir(), ".cache");
  return path.join(base, "wren-harness", "compile");
}

/**
 * Creates the default cache dir (if missing) restricted to the owner (`0700`) so another local
 * account can't read or even traverse into it. `mkdirSync`'s `mode` is subject to the process
 * umask, so `chmodSync` afterwards guarantees `0700` regardless of umask or a looser pre-existing
 * mode. Only applied to the *default* dir — an explicit `cacheDir` override is left exactly as
 * the caller passed it (see `createFileSystemCompileCache`).
 */
function createSecureDefaultCacheDir(): string {
  const dir = resolveDefaultCacheDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    chmodSync(dir, 0o700);
  }
  return dir;
}

/**
 * Defense in depth against a planted slot (see `resolveDefaultCacheDir`'s doc comment above): if a slot directory exists but isn't
 * owned by the current process's uid, treat it as untrustworthy and miss rather than trusting its
 * contents. A slot that doesn't exist at all (the common miss case) is NOT a security decision —
 * `stat` failing for any reason falls through to `true` so the normal `existsSync(irPath)` miss
 * path below still runs. Windows has no POSIX uid model, so this is skipped there.
 */
async function isOwnedByCurrentUser(slot: string): Promise<boolean> {
  if (process.platform === "win32") return true;
  const uid = process.getuid?.();
  if (uid === undefined) return true;
  try {
    const stats = await stat(slot);
    return stats.uid === uid;
  } catch {
    return true;
  }
}

/**
 * The v1 {@link CompileCache} backend: one subdirectory per cache key under `cacheDir`, each
 * holding a copy of `ir.json` and (in-process only) `bundle/bundle.json`. `get` treats a slot whose
 * `ir.json` has since been deleted as a miss rather than throwing, so an external cleanup of
 * `cacheDir` degrades to "just recompile" instead of a hard failure.
 *
 * No TTL/eviction and no crash-consistency guarantee on `set` (a process killed mid-copy can leave
 * a partial slot that a later `get` may treat as a hit) — both are deferred; simple/documented per
 * the task's scope guidance rather than a production-grade cache.
 */
export function createFileSystemCompileCache(options?: { readonly cacheDir?: string }): CompileCache {
  const cacheDir = options?.cacheDir ?? createSecureDefaultCacheDir();

  return {
    async get(key) {
      const slot = path.join(cacheDir, keyDigest(key));
      if (!(await isOwnedByCurrentUser(slot))) return undefined;

      const irPath = path.join(slot, "ir.json");
      if (!existsSync(irPath)) return undefined;

      const bundlePath = path.join(slot, "bundle", "bundle.json");
      return { irPath, ...(existsSync(bundlePath) ? { bundlePath } : {}) };
    },

    async set(key, entry) {
      const slot = path.join(cacheDir, keyDigest(key));
      await mkdir(slot, { recursive: true });
      await cp(entry.irPath, path.join(slot, "ir.json"));
      if (entry.bundlePath !== undefined) {
        await mkdir(path.join(slot, "bundle"), { recursive: true });
        await cp(entry.bundlePath, path.join(slot, "bundle", "bundle.json"));
      }
    },
  };
}

/** A non-persistent {@link CompileCache} for tests/short-lived processes — no filesystem I/O. */
export function createInMemoryCompileCache(): CompileCache {
  const store = new Map<string, CompileCacheEntry>();
  return {
    async get(key) {
      return store.get(keyDigest(key));
    },
    async set(key, entry) {
      store.set(keyDigest(key), entry);
    },
  };
}
