/**
 * Which back-end a compiled IR is realized for.
 *
 * - `"agnostic"` — in-process: the compiled IR is additionally dispatched to a **vercel bundle**
 *   (`warble dispatch --target vercel`), the format this package's `runAgent()` consumes.
 * - `"native"` — dispatched: IR only. Dispatching to a file-based target (`claude-code:*`) produces
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
  /**
   * Content identity of the resolved `wren-context-loader` binary — the generator that renders the
   * user's semantic layer into the prepared-context document a `kind: prepared` binding reads (see
   * `getBinaryIdentity`). Fixed sentinel for `compileRawProfile`, which binds a raw source and never
   * runs the generator at all.
   *
   * This is here for the *generator's* identity, not the project's: `contextFingerprint` already
   * content-hashes the user project's semantic-layer files, so folding in the generated document
   * would say nothing new about the project. What it would miss is a changed generator — a new
   * version that projects the same layer differently (or extracts a facet the old one dropped)
   * produces a different document, and therefore a different compiled artifact, from byte-identical
   * project inputs. Same reason `warbleIdentity` is here, one stage earlier in the pipeline.
   */
  readonly contextLoaderIdentity: string;
  /**
   * The Hub component-library root passed to `warble compile --hub-dir` (see `resolveHubDir`), or
   * `undefined` when none could be derived and the compile therefore ran against warble's own
   * compiled-in default. Two compiles that differ only by Hub root read different component
   * libraries and must not share a cached artifact — the same reason `warbleIdentity` is here.
   */
  readonly hubDir: string | undefined;
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
   * `--provider` fragment paths for the in-process vercel dispatch (ignored in `"native"` mode).
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
  /**
   * Explicit path to the `wren-context-loader` binary. See `resolveContextLoaderBinary` for the
   * resolution order when omitted (explicit → `WREN_HARNESS_CONTEXT_LOADER_BIN` → in-repo build →
   * verified exact `@wrenai/context-loader` package → loud failure; there is no fallback to
   * Warble's built-in `wren_project` adapter).
   */
  readonly contextLoaderBin?: string;
  /**
   * Precomputed identity for the resolved `wren-context-loader` binary (see
   * `CompileCacheKey.contextLoaderIdentity`). Same purpose as `warbleIdentity`: without it,
   * computing the cache key has to resolve and read the generator even for what would otherwise be
   * a cache hit. Pass this, `warbleIdentity` and `hubDir` together to make a hit touch no binary at
   * all. Ignored by `compileRawProfile`, which never runs the generator.
   */
  readonly contextLoaderIdentity?: string;
  /**
   * Explicit Hub component-library root for `warble compile --hub-dir`. When omitted it is derived
   * from the resolved `warble` binary (see `resolveHubDir`) so the compiler and its Hub always come
   * from the same warble version — prefer that over setting this. Like `warbleIdentity`, this also
   * doubles as an escape hatch: because the derived value is a cache-key input, computing the key
   * without it has to resolve the binary even for what would otherwise be a cache hit. Pass both to
   * make a hit touch the binary not at all.
   */
  readonly hubDir?: string;
}

/**
 * Compiles a profile exactly as authored, without rebinding its context to a
 * user project. Bootstrap profiles intentionally use this path because their
 * context is part of the profile source rather than a completed Setup result.
 */
export type CompileRawProfileOptions = Omit<CompileProfileOptions, "userProject">;

export interface CompileProfileResult {
  readonly irPath: string;
  readonly bundlePath?: string;
  /** `true` when the result came from the cache without invoking `warble` at all. */
  readonly cacheHit: boolean;
  /**
   * The resolved `warble` binary path used for this call, when resolution actually happened —
   * lets a caller that hits a downstream `BundleCompatError` name which on-disk checkout produced
   * the bundle (see `loadBundleWithProvenance`, `harness/bundle/loader.ts`). `undefined` only in
   * the one case where resolution is skippable: a cache hit with an explicit
   * `options.warbleIdentity` (see that option's doc comment) never touches the binary at all.
   */
  readonly warbleBin?: string;
}
