# Maintaining GenBI's Warble dependency

This covers `@wrenai/genbi`'s own versioning policy and the procedure for
bumping its pinned Warble version. For building and testing day to day, see
[README.md](./README.md). For the live dev loop these commands feed into, see
[RUNNING.md](./RUNNING.md).

Most commands below run from `apps/genbi`, same as the rest of the app; the
one exception (`pnpm install` in step 2 of the bump procedure) runs at the
workspace root, as noted inline at that step.

## Versioning

`@wrenai/genbi`'s own version (currently `0.0.0`, pre-release) is **independent
of Warble's** — it does not track or mirror Warble's version number. Bump
`@wrenai/genbi`'s version only for genbi's own release events (this doc does
not define genbi's release cadence; that is a separate, not-yet-settled
decision). Recommendation: keep it independent, because Warble releases on its
own weekly cadence driven by its own scope, and coupling the two version
numbers would either force genbi releases it doesn't need or stall Warble pins
waiting on an unrelated genbi release. What genbi commits to instead is
compatibility: the exact `@warble/*` versions this package requires and has
been verified against, expressed as pinned dependency versions plus the
launch-gate contract probes, not as a shared version number.

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
4. Re-run `pnpm run check:warble-peers` (see
   [Package-based Warble dependency](./RUNNING.md#package-based-warble-dependency))
   to confirm the new versions still satisfy the `0.6.x` peer range the
   three packages declare on `@warble/ir-spec`. This catches a version
   mismatch that plain `pnpm install` accepts silently; it does not check
   `file:`/`link:`-satisfied peers, so it is only meaningful against the
   registry-pinned dependency graph described here.
5. Regenerate the launch attestation (`pnpm run verify:launch`, see
   [Generate the launch attestation](./RUNNING.md#generate-the-launch-attestation))
   against the newly-pinned `@warble/cli` and `@warble/claude-agent-sdk`
   binaries, so the attestation actually reflects the new pin rather than a
   stale one left over from before the bump.
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
step 5 leaves the attestation describing a Warble binary that is no longer the
one actually pinned, so a developer regenerating a launch later gets a
misleading "verified" tuple. Skipping steps 6–7 is the ordinary risk of
skipping tests before a commit.

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
