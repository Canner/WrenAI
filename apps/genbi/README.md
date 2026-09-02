# GenBI app (`@wrenai/genbi`)

A verified-first GenBI web app: it renders the structured answer envelopes
(`blocks[]` + a `verified` flag) produced by the Wren agent harness — tables,
charts, KPIs, narrative text — rather than assembling SQL itself.

| Concern | Choice |
| --- | --- |
| Build / dev | Vite — client-rendered SPA, no SSR |
| UI | React + Ant Design (Wren AI Design System theme) |
| Routing | React Router |
| State | Zustand |
| Charts | ECharts |

It's a plain SPA rather than an SSR framework on purpose: it only talks to the
BFF over HTTP/SSE and builds to static assets, so a future desktop shell or
PWA stays a thin increment.

## Prerequisites

- Node 20+ and `pnpm` (the repo pins its version via `corepack`).
- Python 3.11+ for the separately installed `wren` CLI.
- The separately installed `wren` CLI on `PATH`. Live questions and context
  inspection shell out to it; the app does not install it for you.
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

## Getting started

This app lives in a pnpm workspace, so install JavaScript dependencies from
the repo root:

```bash
corepack enable
pnpm install
```

Installation alone does not start the UI. Both `pnpm genbi:dev` and
`pnpm --filter @wrenai/genbi start:bff` require a launch attestation generated
from a compatible GenBI/Warble tuple. Follow the live launch flow below for
hot reload or any BFF-backed work.

**Every other command below runs from `apps/genbi`**, not the repo root — the
root only forwards `genbi:dev`, `genbi:build` and `genbi:test`, so `pnpm build`
or `pnpm test` from there will tell you the script doesn't exist.

```bash
cd apps/genbi
```

For a fixture-only static preview, no BFF or attestation is needed:

```bash
pnpm build
pnpm preview
```

The preview server prints its URL at startup. With no `VITE_BFF_URL` in the
build environment, the SPA stays fixture-driven and makes no BFF calls.

### Install the CLIs

Install Wren in an isolated Python environment and verify that the executable
is on `PATH`. For example, with [`uv`](https://docs.astral.sh/uv/):

```bash
uv tool install wrenai
wren --version
```

Warble 0.2.0 is released on crates.io. For standalone CLI use, you can install
it without cloning the repository:

```bash
cargo install warble-cli --version 0.2.0 --locked
warble --version
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

**This is also how the attested live-BFF flow below identifies Warble.** The
launch gate's attestation records only `warble.binarySha256` — the content
hash of the resolved binary — not which commit or checkout produced it: the
claim is "this is the binary that was verified," not "this binary was built
from this commit, from this tree." `--warble-bin` accepts either the pinned
package's binary or one from a Warble checkout with no difference in how it's
verified: both resolve to a binary that gets hashed the same way, and the gate
no longer requires a `--warble-root` git checkout to hold it. A binary that
does live inside a checkout still works exactly as before — that's how you
attest against your own in-progress Warble build (see the next section) — but
it isn't a requirement any more. What the gate defends against — a binary
swapped after it was attested — is caught by rehashing the same binary path
every time the BFF boots, not by where the binary lives on disk.

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

### Running the BFF

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

### Codex status

The codebase contains Codex Setup and Ask runtime support, but the mandatory
local launch gate currently accepts only `subscription:claude` and an explicit
Claude Agent SDK binary. Do not substitute `subscription:codex`,
`warble-codex-local`, or a dedicated `CODEX_HOME` into the commands above: that
tuple cannot currently produce a valid launch attestation. Codex local-launch
instructions should be added when the gate supports and verifies that tuple.

## Build

```bash
pnpm build      # tsc -b (frontend typecheck) && vite build (→ dist/) && tsc -p tsconfig.server.json (server + harness → dist-server/)
pnpm start:bff  # requires WREN_GENBI_LAUNCH_ATTESTATION and the verified BFF env above
pnpm preview    # serve the frontend production build
```

## Test & typecheck

```bash
pnpm test       # vitest run — frontend (jsdom, src/**) and backend (node, test/**) as separate projects
pnpm typecheck  # tsc -b --noEmit (frontend) && tsc -p tsconfig.server.json --noEmit (backend)
```

Tests mock the BFF client and its SSE stream, so `pnpm test` never needs a
running BFF process.

A handful of end-to-end tests are the exception, and it's worth knowing before
it bites you: they opt themselves in when they find a real `wren` binary, or a
`warble` checkout, on the machine. On a clean machine they skip and the suite is
green. **On a machine that has those tools the suite can exit non-zero for
reasons that have nothing to do with your changes** — they run real queries
against real projects and depend on how well the configured model behaves. If a
test you didn't touch fails and mentions a real query, check whether it's one of
these before going looking for your own bug.

## Layout

```
src/      the frontend SPA — React + Ant Design, one Zustand store per feature
server/   the BFF — Hono REST + SSE routes over a SQLite-backed session/artifact store
harness/  the agent runtime the BFF wraps — compiles a per-user profile and dispatches a turn to it
profiles/ the GenBI Warble profiles (genbi-default/-setup/-enrich-context/-monitor) + their goldens
```

End to end: a question goes to the harness, which compiles the user's
profile and dispatches it to the configured backend; a verified answer
envelope comes back, and the UI renders it.
