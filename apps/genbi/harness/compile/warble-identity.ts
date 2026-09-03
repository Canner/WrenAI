import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Per-process memoization keyed by resolved absolute binary path: computing the identity means
 * reading the (multi-MB) binary's full contents, so within one process a given resolved path is
 * hashed at most once no matter how many `compileProfile` calls reuse it.
 */
const identityCache = new Map<string, Promise<string>>();

/**
 * A content identity for the resolved `warble` binary at `binPath`, folded into the compile cache
 * key (see `CompileCacheKey.warbleIdentity`) so rebuilding/replacing the binary a cache slot was
 * compiled with invalidates it, instead of silently serving an artifact built by a now-stale
 * `warble`.
 *
 * Hashes the binary's file *content* rather than shelling out to `warble --version`: the real
 * `warble` CLI has no `--version` flag (its `clap`-based parser rejects it, exit code 2), and
 * content hashing needs no subprocess at all — so under the default (no `options.warbleIdentity`
 * override), a cache hit still never *executes* warble, only resolves + reads its file.
 */
export async function getWarbleIdentity(binPath: string): Promise<string> {
  return getBinaryIdentity(binPath);
}

/**
 * The generic form of {@link getWarbleIdentity}: a memoized content hash of any binary whose
 * identity belongs in the compile cache key. Also used for the `wren-context-loader` generator (see
 * `CompileCacheKey.contextLoaderIdentity`), which is a compiler of the same kind one stage earlier
 * — it turns the user's semantic layer into the prepared-context document Warble then compiles.
 *
 * Hashes content rather than shelling out for a version string: it needs no subprocess, so folding
 * a binary's identity into the key never costs an execution, and it catches a rebuild that keeps
 * the same version number.
 */
export async function getBinaryIdentity(binPath: string): Promise<string> {
  const resolved = path.resolve(binPath);
  let cached = identityCache.get(resolved);
  if (cached === undefined) {
    cached = hashFile(resolved);
    identityCache.set(resolved, cached);
  }
  return cached;
}

async function hashFile(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}
