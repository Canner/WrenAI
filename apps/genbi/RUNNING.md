# Running GenBI locally

[README.md § Getting started](./README.md#getting-started) has the minimum needed
to get the app up. This file is what comes after that: running against a Warble
build of your own, verifying that your UI, BFF and Warble still fit together, and
the Codex situation. For installing the published package instead of building
from source, see [INSTALL.md](./INSTALL.md).

**Every command here runs from `apps/genbi`**, after `pnpm install` at the repo
root.

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
- For a live BFF: the pinned `@warble/cli` / `@warble/claude-agent-sdk`
  packages above already satisfy the contract check on their own — no separate
  Warble checkout is required. A clean checkout of
  [Canner/Warble](https://github.com/Canner/Warble), a Rust toolchain, and
  [`just`](https://github.com/casey/just) are needed only to run against your own
  in-progress Warble build instead — see
  [Package-based Warble dependency](#package-based-warble-dependency) below.
- A logged-in provider CLI subscription. `check:contracts` takes
  `--runtime subscription:claude` or `subscription:codex`; API-key, local and
  gateway runtimes are not accepted. Claude is much the better exercised of the
  two — see [Codex status](#codex-status).

### Install the CLIs

Install Wren in an isolated Python environment and verify that the executable
is on `PATH`. For example, with [`uv`](https://docs.astral.sh/uv/):

```bash
uv tool install wrenai
wren --version
```

Warble's CLI is published on crates.io. **GenBI does not need this** — it
consumes the pinned `@warble/cli` npm package (see below), and that pin is what
the contract check runs against. Install this only if you want a standalone `warble` on
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

These four packages declare peer ranges on each other, and `pnpm install` exits
`0` even when one is unmet. `pnpm run check:warble-peers` is what catches that —
it matters when you change a pinned version, so it lives with that procedure in
[MAINTAINING.md](./MAINTAINING.md#bumping-the-pinned-warble-version).

The installed packages are enough for everything above. The steps below are for
running GenBI against a Warble you are building yourself — clone it and build the
two executables in place:

```bash
git clone https://github.com/Canner/Warble.git Warble
cd Warble
just release
just install-ts
just build-ts
```

Pass those by absolute path; this flow deliberately does not rely on `PATH` or
`npm link`. Check them first:

```bash
./target/release/warble --version
./dispatcher/claude-agent-sdk/dist/cli.js --help
claude --version
```

### Verify the tuple

Resolve the Warble binary and dispatcher you intend to run against. From the
installed packages, ask node rather than guessing at the `node_modules` layout:

```bash
cd /absolute/path/to/WrenAI/apps/genbi
WARBLE_BIN="$(node -p "require('node:path').join(require('node:path').dirname(require.resolve('@warble/cli/package.json')), require('@warble/cli/package.json').bin.warble)")"
AGENT_SDK_BIN="$(node -p "require('node:path').join(require('node:path').dirname(require.resolve('@warble/claude-agent-sdk/package.json')), require('@warble/claude-agent-sdk/package.json').bin['warble-agent-sdk'])")"
PROFILES_ROOT="$PWD/profiles"
```

Or from a Warble checkout you built yourself:

```bash
cd /absolute/path/to/WrenAI/apps/genbi
WARBLE_ROOT=/absolute/path/to/Warble
WARBLE_BIN="$WARBLE_ROOT/target/release/warble"
AGENT_SDK_BIN="$WARBLE_ROOT/dispatcher/claude-agent-sdk/dist/cli.js"
PROFILES_ROOT="$PWD/profiles"
```

The binary and dispatcher come from either place; the profiles and their
committed IRs are always this package's own `profiles/` tree.

The BFF has a single boot mode: bootstrap, against a workspace root where Setup
may create projects. An existing Wren project is adopted afterward, through the
running app — there is no boot-time flag for it.

```bash
pnpm run check:contracts -- \
  --workspace-root /absolute/path/to/fresh-bootstrap-workspace \
  --runtime subscription:claude \
  --warble-bin "$WARBLE_BIN" \
  --agent-sdk-bin "$AGENT_SDK_BIN"
```

This rebuilds `dist-server` and runs the real Warble against the profiles,
validating the dispatch contracts, tier bindings and IR compatibility of the
tuple you just named — without a model call. It is the check that catches a
Warble whose contracts have moved away from this package's committed profiles.

It reports what it probed and exits non-zero on a mismatch. Nothing is written
and nothing is exported: run it when you change one of its inputs, the way you
would run tests.

## Running the BFF

One variable is required. Everything else the BFF needs, it resolves for itself:

```bash
WREN_HARNESS_WORKSPACE_ROOT=/absolute/path/to/fresh-bootstrap-workspace pnpm run start:bff
```

That is the directory Setup scaffolds new projects into. There is no default for
it because there is no sensible one — it is where your work will live.

Two more are worth setting in practice, both with defaults:

```bash
WREN_BFF_DB_PATH=/absolute/path/to/private-bff-state/bff.sqlite \
PORT=4787 \
WREN_HARNESS_WORKSPACE_ROOT=/absolute/path/to/fresh-bootstrap-workspace \
pnpm run start:bff
```

`PORT` defaults to `4787`. `WREN_BFF_DB_PATH` defaults to
`./wren-harness-bff.sqlite` in the working directory — fine for a quick run, but
keep the state file outside the bootstrap workspace for anything you care about,
since every project is adopted through the app rather than seeded on disk.

### The overrides you do not normally need

The Warble binary and its dispatcher, the profile, and the three IR paths all
resolve on their own: the binary and dispatcher through the resolver's tiers
(the pinned npm package is one of them), and the profile and IRs to this
package's own `profiles/` tree.

Set them only to point somewhere else — most often an in-progress Warble build:

```bash
WREN_HARNESS_WARBLE_BIN="$WARBLE_BIN" \
WREN_HARNESS_AGENT_SDK_BIN="$AGENT_SDK_BIN" \
WREN_HARNESS_PROFILE="$PROFILES_ROOT/genbi-default" \
WREN_HARNESS_SETUP_IR="$PROFILES_ROOT/genbi-setup/ir.golden.json" \
WREN_HARNESS_ENRICH_IR="$PROFILES_ROOT/genbi-enrich-context/ir.golden.json" \
WREN_HARNESS_ANALYSIS_IR="$PROFILES_ROOT/genbi-default/ir.golden.json" \
WREN_HARNESS_WORKSPACE_ROOT=/absolute/path/to/fresh-bootstrap-workspace \
pnpm run start:bff
```

A missing `WREN_HARNESS_PROFILE` is a hard failure at boot; a missing
`WREN_HARNESS_SETUP_IR` is not — only the setup wizard's connect step needs it,
and that returns a clear error at dispatch time instead.

**On picking a provider.** Nothing above names one, because you do not have to.
With no `WREN_HARNESS_MODE`/`WREN_HARNESS_PROVIDER` the harness probes the
machine for an available subscription CLI and uses what it finds, failing with a
clear message if there is none. Setting them pins that choice for boot, which is
only worth doing when more than one is installed and you want a specific one.

Either way this is just the pre-Setup default. The Setup wizard owns the real
choice: once it saves an explicit runtime setting, that takes over and the
boot-time values are deliberately dropped, so switching auth mode in the app
cannot carry a stale binding forward.

In a second terminal, return to the same `apps/genbi` worktree and point Vite at
the BFF:

```bash
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

Finally, rerun the same check with the live endpoints appended:

```bash
pnpm run check:contracts -- \
  --workspace-root /absolute/path/to/fresh-bootstrap-workspace \
  --runtime subscription:claude \
  --warble-bin "$WARBLE_BIN" \
  --agent-sdk-bin "$AGENT_SDK_BIN" \
  --live --bff-url http://localhost:4787 --ui-url http://localhost:5273
```

This live pass is the proof that the UI, BFF, runtime, and Warble tuple are
the ones selected above.

## Codex status

`check:contracts` accepts `--runtime subscription:codex` as well as
`subscription:claude`, so the tuple can be probed either way. The Codex executable is
resolved from `PATH`, the same as `claude`; there is no pinned path for it.

### Codex is selectable before it is known to work

The Setup wizard (`src/setup/RuntimeStepCard.tsx`) offers "Codex CLI" as an
ordinary runtime-provider option, and `useSetupStore.ts` does not check
native-session readiness before letting someone select and save that binding.
So a user can walk through Setup, choose Codex, and save it — with the failure
surfacing later, when a native Codex session actually starts. That attempt
throws a typed `InteractiveLaunchError`, which `server/app.ts` turns into an
ordinary `409` JSON response rather than a crash or a hang.

Codex is also considerably less exercised than Claude here: the end-to-end path
has not been run against an installed package. Treat it as unverified rather
than as known-broken.
