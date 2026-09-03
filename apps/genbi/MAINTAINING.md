# Maintaining GenBI's Warble dependency

This covers `@wrenai/genbi`'s own versioning policy and the procedure for
bumping its pinned Warble version. For building and testing day to day, see
[README.md](./README.md). For the live dev loop these commands feed into, see
[RUNNING.md](./RUNNING.md).

Most commands below run from `apps/genbi`, same as the rest of the app; the
one exception (`pnpm install` in step 2 of the bump procedure) runs at the
workspace root, as noted inline at that step.

## Versioning

`@wrenai/genbi`'s own version (currently `0.0.4`, pre-release) is **independent
of Warble's** — it does not track or mirror Warble's version number. Bump
`@wrenai/genbi`'s version only for genbi's own release events (this doc does
not define genbi's release cadence; that is a separate, not-yet-settled
decision). Recommendation: keep it independent, because Warble releases on its
own weekly cadence driven by its own scope, and coupling the two version
numbers would either force genbi releases it doesn't need or stall Warble pins
waiting on an unrelated genbi release. What genbi commits to instead is
compatibility: the exact `@warble/*` versions this package requires and has
been verified against, expressed as pinned dependency versions plus the contract
check, not as a shared version number.

### Bumping the pinned Warble version

`@warble/cli`, `@warble/claude-agent-sdk`, and `@warble/codex-local` are pinned
to an **exact** version (no `^`/`~`) in `apps/genbi/package.json`, and Warble
publishes roughly weekly. When a new Warble version ships, follow this
procedure (worked examples: commit `73418ad4`, then `da44c60a` for the next
bump after it):

1. Bump the pin for all three `@warble/*` packages to the new exact version in
   `apps/genbi/package.json` in the same change — they come from the same
   Warble release and must move together.
2. Run `pnpm install` at the workspace root to update the lockfile.
3. Check `pnpm-workspace.yaml`'s `minimumReleaseAgeExclude` list. `pnpm
   install` **appends** a new entry for the newly-resolved version rather than
   replacing the old one; repo convention (see both example commits) is to
   **replace** the superseded `@warble/*` entries with the new version, not
   accumulate them. Skipping this step leaves stale version entries behind —
   they do nothing useful, and each one is a permanent hole in
   `minimumReleaseAgeExclude`'s protection (the whole point of that setting is
   to delay trusting a freshly-published version; a stale entry for a version
   already in use provides no protection and just accumulates as dead weight
   that quietly widens the exclusion list over time). Edit the file by hand
   after `pnpm install` to enforce the replacement.
4. Re-run `pnpm run check:warble-peers` to confirm the new versions still satisfy the `0.6.x` peer range the
   three packages declare on `@warble/ir-spec`. This catches a version
   mismatch that plain `pnpm install` accepts silently; it does not check
   `file:`/`link:`-satisfied peers, so it is only meaningful against the
   registry-pinned dependency graph described here.
5. Run the contract probe (`pnpm run check:contracts`, see
   [Verify the tuple](./RUNNING.md#verify-the-tuple)) against the newly-pinned
   `@warble/cli` and `@warble/claude-agent-sdk` binaries. This is the step that
   catches a new Warble whose dispatch contracts or IR compatibility window no
   longer match this package's committed profiles — a mismatch the version bump
   itself will not surface.
6. Run `pnpm typecheck`, `pnpm test`, and `pnpm build` to confirm nothing in
   genbi's own code assumed the old Warble contract.
7. Commit the `package.json` pin bump, the lockfile, and the corrected
   `pnpm-workspace.yaml` together as one change, following the pattern of the
   two example commits above.

If a step is skipped: skipping step 1 (bumping the packages together) risks a
`@warble/*` trio that didn't ship together and was never tested as a set.
Skipping step 3's replacement (leaving the append in place) silently weakens
`minimumReleaseAgeExclude` release over release, with no error message to
notice it by. Skipping step 4 can let a peer-range mismatch land undetected,
since ordinary `pnpm install` exits `0` even when peers conflict. Skipping
step 5 leaves the pinned Warble unproven against this package's committed
profiles, so the mismatch surfaces later, as a
misleading "verified" tuple. Skipping steps 6–7 is the ordinary risk of
skipping tests before a commit.

## Regenerating a profile's prepared-context document and IR golden

Each profile under `profiles/` ships two generated artifacts alongside its hand-written
`profile.yml` and `context/binding.yml`:

| Artifact | What it is |
| --- | --- |
| `context/context.json` | The **prepared-context document** — the JSON projection of a wren project that a `kind: prepared` binding reads. Warble does not introspect MDL itself; WrenAI's `wren-context-loader` generator produces this, and Warble consumes it. |
| `ir.golden.json` | The compiled IR for the profile exactly as authored. Not only a test fixture: `RUNNING.md` passes these to the BFF as `WREN_HARNESS_SETUP_IR` / `WREN_HARNESS_ENRICH_IR` / `WREN_HARNESS_ANALYSIS_IR`, and several test suites read them. |

Both are committed so a profile compiles standalone for CI and dev, pinned to this repo's own
`examples/v5-jaffle`. At run time the host regenerates the document against the user's real project
and rewrites `project:` (see `composeUserProfile`); nothing at run time reads the committed copies.

The generator's content hash is memoized per resolved path for the lifetime of the process, so a
**running** BFF does not notice a generator rebuilt at the same path: the cache key does not move
and a bundle compiled from the previous projection keeps being served. Restart the BFF after
rebuilding the generator. This inherits from `warbleIdentity`, but bites harder here — Warble
arrives pinned from npm, whereas this generator is an in-repo Rust build that is expected to be
rebuilt during development.

Regenerate them, from the repository root, in this order — the golden is compiled *from* the
document, so a stale document silently produces a stale golden:

```sh
# 1. Build the generator (once; it is a Rust binary, not an npm dependency).
cargo build --release --manifest-path core/wren-context-loader/Cargo.toml

# 2. Regenerate the document for each profile that binds `kind: prepared`.
#    (genbi-setup is excluded: it binds `kind: raw_source` and has no document.)
for p in genbi-default genbi-monitor genbi-enrich-context; do
  ./core/wren-context-loader/target/release/wren-context-loader \
    examples/v5-jaffle -o "apps/genbi/profiles/$p/context/context.json"
done

# 3. Recompile each golden with the *pinned* `@warble/cli`, so the committed IR matches the
#    compiler this package actually depends on rather than whatever `warble` is on PATH.
cd apps/genbi
for p in genbi-default genbi-monitor genbi-enrich-context genbi-setup; do
  pnpm exec warble compile "profiles/$p" -o "profiles/$p/ir.golden.json"
done
```

Pass **no** `--hub-dir`: the pinned `@warble/cli` binary carries its own Hub component library baked
in at build time, and that compiled-in default is what makes a golden reproducible for anyone with
the same pin. Pointing it at a local Warble checkout's `hub/components` instead compiles against a
component library nobody else has, which is how a golden silently stops being reproducible.

Verify a regeneration rather than trusting it: recompiling an unchanged profile must be a no-op
(`git diff --stat -- 'apps/genbi/profiles/*/ir.golden.json'` empty). A golden that changes when you
did not intend it to means something else moved — the pin, the Hub, or the generator — and the diff
should be understood before it is committed.

### Open question: distributing the generator

`wren-context-loader` is resolved from an **in-repo Rust build** (or an explicit
`WREN_HARNESS_CONTEXT_LOADER_BIN` override), and resolution loud-fails when neither is present.
That is sufficient for development in this monorepo and for CI, but it is **not** a distribution
story: an installed `@wrenai/genbi` has no Rust toolchain and no `core/` tree, so a
user-project-bound compile cannot resolve the generator at all. Warble faced the same problem with
its own compiler and solved it by publishing a pinned `@warble/cli` npm package whose postinstall
downloads a prebuilt platform binary. The analogue for this generator — publish a
platform-binary npm package, vendor prebuilt binaries, statically link it into an existing
distributed artifact, or drop the separate binary and expose the projection some other way — is a
real packaging decision with release-process consequences, and is deliberately **not** settled here.

### Why `@warble/ir-spec` stays behind

`@warble/ir-spec` is pinned at `0.6.0` and does not move in lockstep with the
other three `@warble/*` packages, by design. The other three packages declare
`@warble/ir-spec` as a peer dependency with a `0.6.x` range, not an exact
version — which is what actually makes this safe: as long as ir-spec stays
inside `0.6.x`, the pinned trio's own version can advance every week without
requiring an ir-spec bump in lockstep. `@warble/ir-spec` is not itself a
build output of Warble's normal release train; it is a hand-maintained
projection of the IR literal that genbi consumes directly, kept intentionally
decoupled from Warble's weekly cadence so it only needs to change when the IR
*shape* actually changes, not on every Warble release.

Bump `@warble/ir-spec` only when Warble ships a new IR line (a `0.7.0`-class
change, not a patch inside `0.6.x`) — and when that happens, re-verify the
peer range in step 4 above still resolves, because widening past `0.6.x`
crosses out of what the other three packages currently declare compatible,
and their own peer ranges will need updating too.
