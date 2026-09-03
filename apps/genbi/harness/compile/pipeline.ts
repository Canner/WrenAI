import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFileSystemCompileCache } from "./cache.js";
import { composeUserProfile } from "./compose-profile.js";
import { resolveContextLoaderBinary } from "./context-loader.js";
import { WarbleCommandFailedError } from "./errors.js";
import { hashDirectory, hashFiles } from "./fingerprint.js";
import { resolveHubDir, resolveWarbleBinary } from "./resolve-binary.js";
import type { CompileCacheKey, CompileProfileOptions, CompileProfileResult, CompileRawProfileOptions } from "./types.js";
import { getBinaryIdentity, getWarbleIdentity } from "./warble-identity.js";

/** Fixed `providerFragmentHash` for `"native"` mode, which never reads `--provider` fragments at all. */
const NATIVE_MODE_PROVIDER_HASH = "native:no-providers";

/**
 * Fixed `contextLoaderIdentity` for `compileRawProfile`, which compiles a raw-source binding and so
 * never runs the `wren-context-loader` generator. A sentinel rather than an empty string, for the
 * same reason `NATIVE_MODE_PROVIDER_HASH` is one: "the generator was not involved" is a distinct
 * fact, not an alias for some generator that happened to hash to nothing.
 */
const RAW_PROFILE_CONTEXT_LOADER_IDENTITY = "raw-profile:no-context-loader";

/**
 * This package's bundled wren capability-provider fragment (`providers/wren.provider.yaml`) — the
 * default `--provider` for in-process dispatch, matching how `fixtures/genbi-default.native.bundle.json`
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
 * The rebind runs WrenAI's own `wren-context-loader` generator over `userProject` and binds its
 * output as a `kind: prepared` document, so Warble reads a projection WrenAI produced rather than
 * introspecting the semantic layer itself. Resolving that generator loud-fails
 * ({@link ContextLoaderNotFoundError}) — there is no fallback to Warble's built-in `wren_project`
 * adapter, because the compiled IR is byte-identical either way and a silent degrade would be
 * undetectable from the artifact.
 *
 * A cache hit (see below) never *executes* `warble`, but by default DOES need to resolve + read
 * the binary — its content hash and the Hub root derived from its location are both cache-key
 * inputs (see `warbleIdentity` and `hubDir` below), so a hit can't be trusted without knowing which
 * binary is current and which component library it reads. Pass both `options.warbleIdentity` and
 * `options.hubDir` explicitly to skip touching the binary at all even on a hit.
 *
 * Deliberately shells via plain `node:child_process` (`execFile`, no shell) rather than this
 * package's `ExecutionEnv` seam (`harness/exec/`): `ExecutionEnv` gates *runtime* native-tool side
 * effects against a bundle's guardrail-derived `EnforcementPolicy` (read-only / write-scope /
 * egress) — there is no bundle or agent yet at this point, compiling happens before any of that
 * exists, so synthesizing a policy for it would be a semantic mismatch, not a reuse. This mirrors
 * the same no-shell, structured-result `execFile` convention `harness/exec/local.ts` already uses.
 *
 * Results are cached on (profile content hash x user-context fingerprint x mode x resolved
 * provider-fragment content hash x warble binary identity x `wren-context-loader` binary identity x
 * resolved Hub root) — see `./cache.js` — so an unchanged profile/context/providers/compiler/
 * generator/Hub tuple returns the previous artifact instead of recompiling. Folding in the
 * provider-fragment hash, warble identity, generator identity and Hub root (rather than just
 * profile+context+mode) matters: otherwise a custom `options.providers` and this package's default
 * fragment collide on the same key, and editing a provider fragment, rebuilding `warble`, rebuilding
 * the generator, or compiling against a different component library would keep serving a stale
 * artifact forever, since there's no TTL/eviction.
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
  // Resolving the generator is memoized here the same way `ensureWarbleBin` memoizes warble below:
  // both the identity computation (a cache-key input) and the compose step (on a miss) need it, and
  // resolution loud-fails rather than degrading to Warble's built-in adapter.
  let resolvedLoaderBin: string | undefined;
  const ensureContextLoaderBin = (): string => {
    resolvedLoaderBin ??= resolveContextLoaderBinary(options.contextLoaderBin);
    return resolvedLoaderBin;
  };

  return compileProfileSource(
    options,
    await hashDirectory(path.resolve(options.userProject)),
    async () => options.contextLoaderIdentity ?? (await getBinaryIdentity(ensureContextLoaderBin())),
    (workDir) => composeUserProfile({
      profileSource: options.profileSource,
      userProject: options.userProject,
      destDir: workDir,
      contextLoaderBin: ensureContextLoaderBin(),
    }),
  );
}

/**
 * Compiles a profile's authored context without composing it against a bound
 * project. The fixed context fingerprint keeps raw-profile artifacts distinct
 * from every user-project-bound compile while `profileHash` still invalidates
 * the entry whenever the source profile changes.
 */
export async function compileRawProfile(options: CompileRawProfileOptions): Promise<CompileProfileResult> {
  return compileProfileSource(
    options,
    "raw-profile-context",
    async () => RAW_PROFILE_CONTEXT_LOADER_IDENTITY,
    async () => path.resolve(options.profileSource),
  );
}

type CompileSourceOptions = Omit<CompileProfileOptions, "userProject">;

async function compileProfileSource(
  options: CompileSourceOptions,
  contextFingerprint: string,
  /**
   * Deferred so `compileRawProfile` never resolves a generator it has no use for, and so the
   * `contextLoaderIdentity` escape hatch can still skip touching the binary on a hit.
   */
  contextLoaderIdentityOf: () => Promise<string>,
  prepareProfile: (workDir: string) => Promise<string>,
): Promise<CompileProfileResult> {
  const cache = options.cache ?? createFileSystemCompileCache();

  const profileHash = await hashDirectory(path.resolve(options.profileSource));

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

  // Derived from the resolved binary, never configured on its own, so the compiler and the Hub it
  // reads always come from the same warble (see `resolveHubDir`). That means it shares
  // `warbleIdentity`'s caveat: without an explicit `options.hubDir` the key can't be computed
  // without resolving the binary. `undefined` here means no `--hub-dir` is passed at all and
  // warble's compiled-in default applies — today's behaviour, preserved.
  const hubDir = options.hubDir ?? resolveHubDir(await ensureWarbleBin());

  const contextLoaderIdentity = await contextLoaderIdentityOf();

  const cacheKey: CompileCacheKey = {
    profileHash,
    contextFingerprint,
    mode: options.mode,
    providerFragmentHash,
    warbleIdentity,
    contextLoaderIdentity,
    hubDir,
  };

  const cached = await cache.get(cacheKey);
  if (cached !== undefined) {
    return { ...cached, cacheHit: true, ...(resolvedWarbleBin !== undefined ? { warbleBin: resolvedWarbleBin } : {}) };
  }

  const warbleBin = await ensureWarbleBin();
  const callerSuppliedWorkDir = options.workDir !== undefined;
  const workDir = options.workDir ?? (await mkdtemp(path.join(os.tmpdir(), "wren-harness-compile-")));
  // Only ever remove a scratch dir we created ourselves; refine to `false` if the cache leaves the
  // artifacts inside it (removing them would invalidate the returned paths).
  let removeWorkDir = !callerSuppliedWorkDir;

  try {
    const compiledProfile = await prepareProfile(workDir);

    const irPath = path.join(workDir, "ir.json");
    // `--hub-dir` reached the compiler in July 2026, well before the IR version this harness
    // requires, so any binary new enough to satisfy that contract accepts the flag. A binary
    // older than both was already unsupported — but it used to say so as an IR version
    // mismatch, and now clap rejects the argument first. The configuration is no more broken
    // than before; only the message got less helpful, which is worth knowing when one appears.
    const hubDirArgs = hubDir !== undefined ? ["--hub-dir", hubDir] : [];
    await runWarble(warbleBin, ["compile", compiledProfile, "-o", irPath, ...hubDirArgs]);

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
    return { ...persisted, cacheHit: false, warbleBin };
  } finally {
    if (removeWorkDir) {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}

/**
 * Shells a `warble` subcommand (no shell interpolation — `execFile`, argv
 * array only). Exported for `InProcessSetupRunner` (`harness/setup/runner.ts`),
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
