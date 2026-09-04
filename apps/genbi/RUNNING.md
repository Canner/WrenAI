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
  packages above already satisfy the contract check on their own — no separate
  Warble checkout is required. A clean checkout of
  [Canner/Warble](https://github.com/Canner/Warble), a Rust toolchain, and
  [`just`](https://github.com/casey/just) are needed only when attesting
  against your own in-progress Warble build instead — see
  [Package-based Warble dependency](#package-based-warble-dependency) below.
- A logged-in Claude CLI subscription. The currently supported attested local
  launch flow is explicitly `subscription:claude`; API-key, local, gateway,
  and Codex runtime code are not accepted by the current contract check.

### Install the CLIs

Install Wren in an isolated Python environment and verify that the executable
is on `PATH`. For example, with [`uv`](https://docs.astral.sh/uv/):

```bash
uv tool install wrenai
wren --version
```

Warble's CLI is published on crates.io. **GenBI does not need this** — it
consumes the pinned `@warble/cli` npm package (see below), and that pin is what
the contract check attests. Install this only if you want a standalone `warble` on
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

The attested live-BFF flow below identifies Warble by *how it was resolved*, not
by which commit built it: an installed package by its version, its
`pnpm-lock.yaml` integrity, and hashes of its resolution logic and of what that
logic extracted; a checkout by its binary's content hash. The two differ because
`@warble/cli`'s `bin` is a small trampoline that is byte-identical across
releases, so hashing it alone could not tell 0.6.0 from 0.9.0. `--warble-bin`
accepts either. **Not covered**: package provenance, and anything fetched at
runtime from outside the package, such as the Hub archive.

Because pnpm silently accepts (and exits 0 on) an unmet peer-dependency range
between these packages — e.g. an `@warble/codex-local` built against a
different `@warble/ir-spec` minor than the one this workspace has installed —
run this after any Warble package version bump, in CI or locally, rather than
trusting a clean `pnpm install` alone:

```bash
pnpm run check:warble-peers   # pnpm peers check — reads the lockfile, exits non-zero on a real conflict
```

What it catches, measured: a genuine resolution conflict between registry
packages — a consumer wanting `@warble/ir-spec` `0.5.x` against an installed
`0.6.0`, which is what an IR bump looks like — is reported and exits 1. What it
does **not** catch: a peer satisfied by a `file:` or `link:` dependency, and a
peer range edited in the lockfile itself, which only
`pnpm peers check --lockfile-only` sees. Plain `pnpm install` warns and exits 0
even on a real conflict, and `strictPeerDependencies` does not change that; what
catches a hand-edited `package.json` is an install with `--frozen-lockfile`.

The GenBI contract check needs more than a standalone binary: it hashes the exact
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

Start the BFF with the exact paths the check verified. The SQLite state must be
outside the bootstrap workspace and every project adopted through the app.

```bash
mkdir -p /absolute/path/to/private-bff-state

WREN_HARNESS_WARBLE_BIN="$WARBLE_BIN" \
WREN_HARNESS_AGENT_SDK_BIN="$AGENT_SDK_BIN" \
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
