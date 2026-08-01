/**
 * Which back-end a compiled IR is realized for.
 *
 * - `"agnostic"` — Mode A: the compiled IR is additionally dispatched to a **vercel bundle**
 *   (`warble dispatch --target vercel`), the format this package's `runAgent()` consumes.
 * - `"native"` — Mode B: IR only. Dispatching to a file-based target (`claude-code:*`) produces
 *   agent files on disk, not something this harness loads/runs — out of scope for this package.
 */
export type CompileMode = "agnostic" | "native";

export interface CompileCacheKey {
  /** Content fingerprint of the source profile directory (profile.yml + components + fixture binding). */
  readonly profileHash: string;
  /** Content fingerprint of the user's wren project directory (the per-user context binding). */
  readonly contextFingerprint: string;
  readonly mode: CompileMode;
  /**
   * Content hash of the resolved `--provider` fragment file(s) actually used for `"agnostic"` mode's
   * vercel dispatch (order-sensitive — see `hashFiles`), so a custom `options.providers` and this
   * package's default fragment never collide on the same key. Fixed sentinel for `"native"` mode,
   * which never reads providers at all.
   */
  readonly providerFragmentHash: string;
  /**
   * Content identity of the resolved `warble` binary (see `getWarbleIdentity`) — folds the compiler
   * itself into the key so rebuilding/replacing the binary invalidates entries it previously
   * compiled, instead of silently serving an artifact built by a now-stale `warble`.
   */
  readonly warbleIdentity: string;
}

export interface CompileCacheEntry {
  readonly irPath: string;
  readonly bundlePath?: string;
}

/**
 * Pluggable cache seam, keyed on (profile content hash x user-context fingerprint x mode) — see
 * `./fingerprint.js`. `get` returns `undefined` on a miss (including a "hit" whose files were
 * since deleted from disk); `set` persists an entry produced by a fresh compile so a later `get`
 * with the same key can skip recompiling.
 */
export interface CompileCache {
  get(key: CompileCacheKey): Promise<CompileCacheEntry | undefined>;
  set(key: CompileCacheKey, entry: CompileCacheEntry): Promise<void>;
}

export interface CompileProfileOptions {
  /** Directory of the source Warble profile (profile.yml + components/ + context/binding.yml), e.g. `genbi-default`. */
  readonly profileSource: string;
  /** Directory of the per-user wren project (MDL + Knowledge) the profile's context binding is rebound to. */
  readonly userProject: string;
  readonly mode: CompileMode;
  /** Explicit path to the `warble` binary. See `resolveWarbleBinary` for the full resolution order when omitted. */
  readonly warbleBin?: string;
  /**
   * `--provider` fragment paths for the Mode A vercel dispatch (ignored in `"native"` mode).
   * Defaults to this package's bundled `providers/wren.provider.yaml` (the wren capability-provider
   * fragment already used to produce `fixtures/genbi-default.native.bundle.json`). Pass `[]`
   * explicitly to dispatch with no provider fragments at all.
   */
  readonly providers?: readonly string[];
  readonly cache?: CompileCache;
  /** Base scratch directory for the composed profile + compiler output. Defaults to a fresh `os.tmpdir()` mkdtemp. */
  readonly workDir?: string;
  /**
   * Precomputed identity for the resolved `warble` binary (see `CompileCacheKey.warbleIdentity`).
   * When omitted, `compileProfile` resolves `warbleBin` and computes it via `getWarbleIdentity` —
   * which, for a cache MISS, it would need to do anyway to run the compile, but for what would
   * otherwise be a cache HIT this means resolving the binary even though nothing gets executed.
   * Pass this explicitly (e.g. computed once at process startup, or stubbed in a test) to make a
   * hit skip touching the binary at all.
   */
  readonly warbleIdentity?: string;
}

export interface CompileProfileResult {
  readonly irPath: string;
  readonly bundlePath?: string;
  /** `true` when the result came from the cache without invoking `warble` at all. */
  readonly cacheHit: boolean;
}
