import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFileSystemCompileCache } from "./cache.js";
import { composeUserProfile } from "./compose-profile.js";
import { WarbleCommandFailedError } from "./errors.js";
import { hashDirectory, hashFiles } from "./fingerprint.js";
import { resolveWarbleBinary } from "./resolve-binary.js";
import type { CompileCacheKey, CompileProfileOptions, CompileProfileResult } from "./types.js";
import { getWarbleIdentity } from "./warble-identity.js";

/** Fixed `providerFragmentHash` for `"native"` mode, which never reads `--provider` fragments at all. */
const NATIVE_MODE_PROVIDER_HASH = "native:no-providers";

/**
 * This package's bundled wren capability-provider fragment (`providers/wren.provider.yaml`) — the
 * default `--provider` for Mode A dispatch, matching how `fixtures/genbi-default.native.bundle.json`
 * was produced (see `test/e2e-wren-native.test.ts`'s comment).
 */
export const DEFAULT_WREN_PROVIDER_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "providers",
  "wren.provider.yaml",
);

// guardrail-enforcement fix: a hung `warble compile`/`dispatch` invocation
// previously blocked forever. 2 minutes is a generous ceiling for a local
// compile/dispatch step that normally finishes in seconds; guards against a
// hang, not meant to ever fire in normal operation.
const WARBLE_COMMAND_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Compiles a Warble profile bound to a specific user's wren project (the per-user compile
 * pipeline): composes a copy of `profileSource` with its context binding rebound to `userProject`
 * (see `composeUserProfile`), shells out to `warble compile` for the IR, and — in `"agnostic"`
 * mode — additionally `warble dispatch --target vercel` for the vercel bundle this package's
 * `runAgent()` consumes.
 *
 * A cache hit (see below) never *executes* `warble`, but by default DOES need to resolve + read
 * the binary — its content hash is one of the cache-key inputs (see `warbleIdentity` below), so a
 * hit can't be trusted without knowing the current binary's identity. Pass `options.warbleIdentity`
 * explicitly to skip touching the binary at all even on a hit.
 *
 * Deliberately shells via plain `node:child_process` (`execFile`, no shell) rather than this
 * package's `ExecutionEnv` seam (`harness/exec/`): `ExecutionEnv` gates *runtime* native-tool side
 * effects against a bundle's guardrail-derived `EnforcementPolicy` (read-only / write-scope /
 * egress) — there is no bundle or agent yet at this point, compiling happens before any of that
 * exists, so synthesizing a policy for it would be a semantic mismatch, not a reuse. This mirrors
 * the same no-shell, structured-result `execFile` convention `harness/exec/local.ts` already uses.
 *
 * Results are cached on (profile content hash x user-context fingerprint x mode x resolved
 * provider-fragment content hash x warble binary identity) — see `./cache.js` — so an unchanged
 * profile/context/providers/compiler quadruple returns the previous artifact instead of
 * recompiling. Folding in the provider-fragment hash and warble identity (rather than just
 * profile+context+mode) matters: otherwise a custom `options.providers` and this package's
 * default fragment collide on the same key, and editing a provider fragment or rebuilding
 * `warble` would keep serving a stale artifact forever, since there's no TTL/eviction.
 *
 * The `warble` invocations run inside a temporary scratch directory (the composed profile + raw
 * compiler output). When the cache relocates the artifacts to a durable home outside that scratch
 * dir — as the default persistent {@link createFileSystemCompileCache} does — the scratch dir is
 * removed and the durable cache paths are returned. When the cache does NOT relocate them (e.g. a
 * non-persistent in-memory cache that just stores the paths), the scratch dir is retained so the
 * returned paths stay valid. Either way the returned `irPath`/`bundlePath` are always readable, and
 * a caller-supplied `workDir` is never deleted.
 */
export async function compileProfile(options: CompileProfileOptions): Promise<CompileProfileResult> {
  const cache = options.cache ?? createFileSystemCompileCache();

  const profileHash = await hashDirectory(path.resolve(options.profileSource));
  const contextFingerprint = await hashDirectory(path.resolve(options.userProject));

  const providerPaths = options.providers ?? [DEFAULT_WREN_PROVIDER_PATH];
  const providerFragmentHash = options.mode === "agnostic" ? await hashFiles(providerPaths) : NATIVE_MODE_PROVIDER_HASH;

  // Resolving `warble` is memoized here so it happens at most once per call no matter how many of
  // the two spots below need it (identity computation, and — on a miss — actually running it).
  let resolvedWarbleBin: string | undefined;
  const ensureWarbleBin = async (): Promise<string> => {
    if (resolvedWarbleBin === undefined) {
      resolvedWarbleBin = await resolveWarbleBinary(options.warbleBin);
    }
    return resolvedWarbleBin;
  };

  // Without an explicit `options.warbleIdentity`, computing the key requires resolving the binary
  // even for what would otherwise be a cache hit — the whole point of folding warble's identity in
  // is to invalidate a hit whose binary has since been rebuilt, which is unknowable without
  // checking. A caller who wants the old "no warble touched at all on a hit" property back can get
  // it by passing `warbleIdentity` explicitly (see `CompileProfileOptions.warbleIdentity`).
  const warbleIdentity = options.warbleIdentity ?? (await getWarbleIdentity(await ensureWarbleBin()));

  const cacheKey: CompileCacheKey = { profileHash, contextFingerprint, mode: options.mode, providerFragmentHash, warbleIdentity };

  const cached = await cache.get(cacheKey);
  if (cached !== undefined) {
    return { ...cached, cacheHit: true };
  }

  const warbleBin = await ensureWarbleBin();
  const callerSuppliedWorkDir = options.workDir !== undefined;
  const workDir = options.workDir ?? (await mkdtemp(path.join(os.tmpdir(), "wren-harness-compile-")));
  // Only ever remove a scratch dir we created ourselves; refine to `false` if the cache leaves the
  // artifacts inside it (removing them would invalidate the returned paths).
  let removeWorkDir = !callerSuppliedWorkDir;

  try {
    const composedDir = await composeUserProfile({
      profileSource: options.profileSource,
      userProject: options.userProject,
      destDir: workDir,
    });

    const irPath = path.join(workDir, "ir.json");
    await runWarble(warbleBin, ["compile", composedDir, "-o", irPath]);

    let bundlePath: string | undefined;
    if (options.mode === "agnostic") {
      const bundleOutDir = path.join(workDir, "bundle");
      const providerArgs = providerPaths.flatMap((provider) => ["--provider", provider]);
      await runWarble(warbleBin, ["dispatch", "--target", "vercel", ...providerArgs, irPath, "--out", bundleOutDir]);
      bundlePath = path.join(bundleOutDir, "bundle.json");
    }

    const freshEntry = { irPath, ...(bundlePath !== undefined ? { bundlePath } : {}) };
    await cache.set(cacheKey, freshEntry);

    // Prefer the cache's persisted paths; if the cache relocated the IR out of the scratch dir the
    // scratch dir is pure garbage now and safe to delete, otherwise keep it so paths stay valid.
    const persisted = (await cache.get(cacheKey)) ?? freshEntry;
    if (persisted.irPath === freshEntry.irPath) {
      removeWorkDir = false;
    }
    return { ...persisted, cacheHit: false };
  } finally {
    if (removeWorkDir) {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}

/**
 * Shells a `warble` subcommand (no shell interpolation — `execFile`, argv
 * array only). Exported for `ModeASetupRunner` (`harness/setup/runner.ts`),
 * which dispatches the pre-committed `genbi-setup/ir.golden.json` straight to
 * `warble dispatch --target vercel`, bypassing `compileProfile`'s
 * `composeUserProfile` rewrite entirely (there is no user project to bind
 * context against at setup time — see that runner's doc comment). Reusing
 * this rather than duplicating an `execFile` wrapper keeps the two callers'
 * timeout/max-buffer/error-shaping behavior identical.
 */
export function runWarble(bin: string, args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      [...args],
      { maxBuffer: 32 * 1024 * 1024, timeout: WARBLE_COMMAND_TIMEOUT_MS },
      (error, stdout, stderr) => {
        if (error) {
          const exitCode = typeof error.code === "number" ? error.code : 1;
          const clarifiedStderr =
            stderr.length > 0
              ? stderr
              : error.killed === true
                ? `warble subprocess timed out after ${WARBLE_COMMAND_TIMEOUT_MS}ms`
                : error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
                  ? "warble subprocess exceeded the 32 MiB output buffer"
                  : stderr;
          reject(new WarbleCommandFailedError(bin, args, exitCode, clarifiedStderr, stdout));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}
