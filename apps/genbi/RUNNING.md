# Running GenBI locally

This covers getting a live, BFF-backed GenBI running from a source checkout:
hot reload, real questions against an adopted Wren project, and the attested
launch flow that ties a specific UI + BFF + Warble build together. For the
daily build/test/typecheck loop, see [README.md](./README.md#build). For
installing the published package instead of building from source, see
[INSTALL.md](./INSTALL.md).

**Every command below runs from `apps/genbi`**, after `pnpm install` at the
repo root — see [README.md § Getting started](./README.md#getting-started).

```bash
cd apps/genbi
```

## Prerequisites

In addition to the prerequisites in [README.md](./README.md#prerequisites):

- `pnpm install` already pulls in the pinned `@warble/cli`,
  `@warble/claude-agent-sdk`, `@warble/codex-local`, and `@warble/ir-spec`
  packages, which is enough for tests, builds, and any tooling that resolves
  a `warble` binary or dispatcher CLI without an explicit override — see
  [Package-based Warble dependency](#package-based-warble-dependency) below.
- For a live, attested BFF: the pinned `@warble/cli` / `@warble/claude-agent-sdk`
  packages above already satisfy the launch gate on their own — no separate
  Warble checkout is required. A clean checkout of
  [Canner/Warble](https://github.com/Canner/Warble), a Rust toolchain, and
  [`just`](https://github.com/casey/just) are needed only when attesting
  against your own in-progress Warble build instead — see
  [Package-based Warble dependency](#package-based-warble-dependency) below.
- A logged-in Claude CLI subscription. The currently supported attested local
  launch flow is explicitly `subscription:claude`; API-key, local, gateway,
  and Codex runtime code are not accepted by the current launch gate.

### Install the CLIs

Install Wren in an isolated Python environment and verify that the executable
is on `PATH`. For example, with [`uv`](https://docs.astral.sh/uv/):

```bash
uv tool install wrenai
wren --version
```

Warble's CLI is published on crates.io. **GenBI does not need this** — it
consumes the pinned `@warble/cli` npm package (see below), and that pin is what
the launch gate attests. Install this only if you want a standalone `warble` on
your `PATH`:

```bash
cargo install warble-cli --locked
warble --version
```

Deliberately no `--version` here: Warble releases often, and a version written
into this file goes stale within weeks. If you need the exact version GenBI is
pinned to, read it from `package.json` rather than from prose:

```bash
node -p "require('./package.json').dependencies['@warble/cli']"
```

### Package-based Warble dependency

This package pins `@warble/cli`, `@warble/claude-agent-sdk`, `@warble/codex-local`,
and `@warble/ir-spec` as ordinary npm dependencies (see `package.json`), so
`pnpm install` from the repo root already gives every resolver
(`resolveWarbleBinary`, `resolveAgentSdkCli`, `resolveCodexLocalCli`) a working
binary with no extra setup: tests, `pnpm build`/`pnpm preview`, and any tooling
that calls those resolvers without an explicit override run against the pinned
package version by default. A previously-supported sibling `warble` git
checkout next to this repo is no longer picked up implicitly — it now requires
`WREN_HARNESS_ALLOW_WARBLE_SIBLING_CHECKOUT=1`, an explicit opt-in.

**That flag alone will not give you your checkout.** The sibling tier sits below
the installed package, deliberately, so that a reviewable pinned version always
beats whatever happens to be next door — which means once `pnpm install` has run
here, the package wins and the flag never gets a turn. The flag matters only when
the packages are absent. **To develop GenBI against an in-progress Warble build,
pass `--warble-bin` (or `warbleBin`) explicitly**; that is tier 1 and beats
everything.

This is also how the attested live-BFF flow below identifies Warble: the
attestation names Warble by *how it was resolved*, not by which commit built it.
For an installed package it records the version, the `pnpm-lock.yaml` integrity
for that version, a hash of the package's own resolution logic (`run-warble.js`,
`binary.js`, `binary-install.js`, `package.json`), and a hash of what that logic
extracted into the package's `node_modules/.bin_real`. For a Warble checkout it
records the content hash of the built executable, as before.

The split exists because `@warble/cli`'s `bin` is a small trampoline that's
byte-identical across releases — hashing it alone couldn't tell 0.6.0 from
0.9.0 — while a checkout's own binary hash is the whole story.

`--warble-bin` accepts either, and a binary inside a checkout still works
exactly as before — that is how you attest against your own in-progress Warble
build (see the next section). What the gate defends against — either binary
being swapped after it was attested — is caught by re-deriving the same
identity every time the BFF boots. **Not covered**: package provenance (npm
Sigstore), and anything fetched at runtime from outside the package, such as
the Hub archive downloaded on first compile.

Because pnpm silently accepts (and exits 0 on) an unmet peer-dependency range
between these packages — e.g. an `@warble/codex-local` built against a
different `@warble/ir-spec` minor than the one this workspace has installed —
run this after any Warble package version bump, in CI or locally, rather than
trusting a clean `pnpm install` alone:

```bash
pnpm run check:warble-peers   # pnpm peers check — reads the lockfile, exits non-zero on a real conflict
```

Measured, so you know what it covers: a version conflict between registry packages —
a consumer wanting `@warble/ir-spec` `0.5.x` against an installed `0.6.0`, which is what
a Warble IR bump looks like — is reported and exits 1. A peer satisfied by a `file:` or
`link:` dependency is **not** checked, and passes silently. Plain `pnpm install` reports
neither: it warns and exits 0 even on a real conflict, and `strictPeerDependencies` does
not change that, so this separate step is the gate rather than the install itself.

The GenBI launch gate needs more than a standalone binary: it hashes the exact
profiles, IR files, Warble binary, and Claude Agent SDK dispatcher used by the
BFF. The installed `@warble/cli` / `@warble/claude-agent-sdk` packages already
satisfy this (see above) — the steps below are for attesting against your own
Warble checkout instead, e.g. while developing Warble itself. Clone a clean
checkout you have access to and build those inputs in place:

```bash
git clone https://github.com/Canner/Warble.git Warble
cd Warble
just release
just install-ts
just build-ts
```

The attested flow passes absolute paths and deliberately does not rely on
`PATH` or `npm link`. Check the two built executables directly:

```bash
./target/release/warble --version
./dispatcher/claude-agent-sdk/dist/cli.js --help
claude --version
```

### Generate the launch attestation

If you skipped the checkout section above and are attesting the pinned
packages instead, resolve their installed `bin` paths from `apps/genbi`
(after `pnpm install`) rather than guessing at `node_modules` layout:

```bash
cd /absolute/path/to/WrenAI/apps/genbi
WARBLE_BIN="$(node -p "require('node:path').join(require('node:path').dirname(require.resolve('@warble/cli/package.json')), require('@warble/cli/package.json').bin.warble)")"
AGENT_SDK_BIN="$(node -p "require('node:path').join(require('node:path').dirname(require.resolve('@warble/claude-agent-sdk/package.json')), require('@warble/claude-agent-sdk/package.json').bin['warble-agent-sdk'])")"
PROFILES_ROOT="$PWD/profiles"
```

Otherwise, return to this repository's `apps/genbi` directory and identify the
exact Warble checkout you just built:

```bash
cd /absolute/path/to/WrenAI/apps/genbi
WARBLE_ROOT=/absolute/path/to/Warble
WARBLE_BIN="$WARBLE_ROOT/target/release/warble"
AGENT_SDK_BIN="$WARBLE_ROOT/dispatcher/claude-agent-sdk/dist/cli.js"
PROFILES_ROOT="$PWD/profiles"
```

The `warble` binary and its dispatcher come from either the installed package
or that Warble checkout; the GenBI profiles and their committed IRs are always
this package's own `profiles/` tree, which is what the launch gate defaults to
and attests under `genbi`.

The BFF has a single boot mode: bootstrap, against a workspace root where
Setup may create projects. An existing Wren project is adopted afterward,
through the running app — there is no separate boot-time mode or flag for it.

```bash
pnpm run verify:launch -- \
  --workspace-root /absolute/path/to/fresh-bootstrap-workspace \
  --runtime subscription:claude \
  --warble-bin "$WARBLE_BIN" \
  --agent-sdk-bin "$AGENT_SDK_BIN"
```

The command rebuilds `dist-server`, validates the runtime contracts without a
model call, and writes an attestation bound to both clean worktrees. Export it
in every terminal that starts the BFF or UI:

```bash
export WREN_GENBI_LAUNCH_ATTESTATION="$PWD/dist-server/local-launch-attestation.json"
```

If the command reports `launch gate BLOCKED`, fix the named input and rerun it.
Do not reuse the attestation after changing either checkout or rebuilding a
verified runtime input.

## Running the BFF

Start the BFF with the exact paths the gate verified. The SQLite state must be
outside the bootstrap workspace and every project adopted through the app.

```bash
mkdir -p /absolute/path/to/private-bff-state

WREN_HARNESS_WARBLE_BIN="$WARBLE_BIN" \
WREN_HARNESS_AGENT_SDK_BIN="$AGENT_SDK_BIN" \
WREN_HARNESS_MODE=subscription \
WREN_HARNESS_PROVIDER=claude \
WREN_HARNESS_PROFILE="$PROFILES_ROOT/genbi-default" \
WREN_HARNESS_SETUP_IR="$PROFILES_ROOT/genbi-setup/ir.golden.json" \
WREN_HARNESS_ENRICH_IR="$PROFILES_ROOT/genbi-enrich-context/ir.golden.json" \
WREN_HARNESS_ANALYSIS_IR="$PROFILES_ROOT/genbi-default/ir.golden.json" \
WREN_HARNESS_WORKSPACE_ROOT=/absolute/path/to/fresh-bootstrap-workspace \
WREN_BFF_DB_PATH=/absolute/path/to/private-bff-state/bff.sqlite \
PORT=4787 \
pnpm run start:bff
```

The BFF listens on `:4787` by default (`PORT` overrides it).

In a second terminal, return to the same `apps/genbi` worktree, export the same
attestation, and point Vite at the BFF:

```bash
export WREN_GENBI_LAUNCH_ATTESTATION="$PWD/dist-server/local-launch-attestation.json"
VITE_BFF_URL=http://localhost:4787 pnpm dev
```

The UI listens on `http://localhost:5273`. `VITE_BFF_URL` enables the dev proxy;
without it, the SPA cannot reach the BFF.

To check the two are actually wired up rather than merely both running, ask the
dev server for something only the BFF can answer:

```bash
curl -s http://localhost:5273/api/config/runtime
```

JSON back means the proxy reached the BFF. The SPA's own `index.html` means
`VITE_BFF_URL` isn't in effect; `502` means it is, but nothing is listening.

Once a project has been adopted through the running app, the same endpoint
reflects it:

```bash
curl -s http://localhost:4787/api/context/overview
```

An adopted, built project returns its name and models.

Finally, rerun the same launch-gate command with the live endpoints appended:

```bash
pnpm run verify:launch -- \
  --workspace-root /absolute/path/to/fresh-bootstrap-workspace \
  --runtime subscription:claude \
  --warble-bin "$WARBLE_BIN" \
  --agent-sdk-bin "$AGENT_SDK_BIN" \
  --live --bff-url http://localhost:4787 --ui-url http://localhost:5273
```

This live pass is the proof that the UI, BFF, runtime, and Warble tuple are
the ones selected above.

## Codex status

The codebase contains Codex Setup and Ask runtime support, but the mandatory
local launch gate currently accepts only `subscription:claude` and an explicit
Claude Agent SDK binary. Do not substitute `subscription:codex`,
`warble-codex-local`, or a dedicated `CODEX_HOME` into the commands above: that
tuple cannot currently produce a valid launch attestation. Codex local-launch
instructions should be added when the gate supports and verifies that tuple.

### Codex in the published package

The paragraph above describes the local development launch gate. The installed
package (`npx @wrenai/genbi` or a global/`npm i -g` install) behaves
differently, worth stating precisely since the two are easy to conflate.

`server/bin.ts` starts the BFF without a launch attestation whenever
`WREN_GENBI_LAUNCH_ATTESTATION` is not set — which is always, for an installed
package, since nothing sets that variable outside the local dev launch-gate
flow. In that mode `readLaunchAttestation()` (which otherwise throws if the
attestation is missing, unparseable, or hash-mismatched) is never called, and
`server/bin.ts` writes a one-line stderr notice instead: the build is
unverified against the Warble binary it is running with, relying instead on
its pinned `@warble/*` version plus the npm installer's own checksum check of
the downloaded Warble executable.

One concrete effect: the four Codex identity fields normally read out of the
attestation (`codexBinSha256`, `codexSource`, `codexSourceClosureSha256`,
`codexVersion`) stay `undefined`. This does not crash the server —
`NativeSessionService`'s readiness computation treats a missing pinned Codex
executable as cleanly unavailable, so a user asking "is Codex ready?" gets a
normal "unavailable" answer, not an error.

What is *not* currently gated is selection: the Setup wizard
(`src/setup/RuntimeStepCard.tsx`) offers "Codex CLI" as an ordinary
runtime-provider option, and `useSetupStore.ts` does not check native-session
readiness before letting someone select and save that binding. So a user of
the installed package can walk through Setup, choose Codex, and save it — the
failure only surfaces later, when actually starting a native Codex session.
That attempt throws a typed `InteractiveLaunchError`, which `server/app.ts`
catches and turns into an ordinary `409 Bad Request` JSON error response, not
a crash or a hang.

Net effect: Codex is selectable but non-functional in the published package,
and a user only finds out when they try to use it, not when they configure
it. This is a documentation and (potentially, later) a Setup-UI polish gap,
not a crash, data-loss, or security issue.
