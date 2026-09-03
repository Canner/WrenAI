# Running GenBI locally

[README.md § Getting started](./README.md#getting-started) has the minimum needed
to get the app up. This file is what comes after that: running against a Warble
build of your own, checking that your UI, BFF and Warble still fit together, and
the Codex situation. For installing the published package instead of building
from source, see [INSTALL.md](./INSTALL.md).

**Every command here runs from `apps/genbi`**, after `pnpm install` at the repo
root.

```bash
cd apps/genbi
```

## Prerequisites

Beyond the prerequisites in [README.md](./README.md#prerequisites):

- A provider CLI you are logged in to. `check:contracts` takes
  `--runtime subscription:claude` or `--runtime subscription:codex`; API-key,
  local and gateway runtimes are not accepted. Claude is by far the better
  exercised of the two — see [Codex status](#codex-status).
- The Wren CLI on `PATH`:
- **The `wren-context-loader` generator, built from this repo.** Binding a user's project
  compiles a prepared-context document first, and the generator is a Rust binary rather than an
  npm dependency, so `pnpm install` does not supply it. Build it once with
  `cargo build --release --manifest-path ../../core/wren-context-loader/Cargo.toml`, or point
  `WREN_HARNESS_CONTEXT_LOADER_BIN` at an existing build. Without either, the first user-project
  bind fails loudly — by design, since a silent fallback would leave no way to tell which path
  produced an IR. Restart the BFF after rebuilding the binary: its identity is memoized for the
  process lifetime.

  ```bash
  uv tool install wrenai
  wren --version
  ```


## Where Warble comes from

`pnpm install` already pins `@warble/cli`, the dispatchers and `@warble/ir-spec`
as ordinary dependencies, so tests, builds and the BFF all resolve a working
Warble with no further setup.

That is the whole story for running GenBI: you do not build Warble to run this.

If you are also working on Warble itself, point `--warble-bin` (and
`WREN_HARNESS_WARBLE_BIN`) at your own build — an explicit path outranks
everything else, including the sibling-checkout opt-in, which the installed
package would otherwise win. Building Warble is documented in
[its own repository](https://github.com/Canner/Warble#from-source).

Changing a pinned version is its own procedure, with a peer check that matters
there rather than here: see
[MAINTAINING.md](./MAINTAINING.md#bumping-the-pinned-warble-version).

## Verify the tuple

`check:contracts` runs your Warble against this package's profiles and reports
whether their dispatch contracts and IR versions still agree. No model is called.
Run it when you change one of its inputs, the way you would run tests.

First resolve the binary and dispatcher you mean. From the installed packages,
ask node rather than guessing at the `node_modules` layout:

```bash
WARBLE_BIN="$(node -p "require('node:path').join(require('node:path').dirname(require.resolve('@warble/cli/package.json')), require('@warble/cli/package.json').bin.warble)")"
AGENT_SDK_BIN="$(node -p "require('node:path').join(require('node:path').dirname(require.resolve('@warble/claude-agent-sdk/package.json')), require('@warble/claude-agent-sdk/package.json').bin['warble-agent-sdk'])")"
```

Then run it. The dispatcher flag depends on the runtime — this is the Claude
form; Codex takes `--codex-local-bin` and `--codex-bin` instead:

```bash
pnpm run check:contracts -- \
  --workspace-root /absolute/path/to/an/empty/directory \
  --runtime subscription:claude \
  --warble-bin "$WARBLE_BIN" \
  --agent-sdk-bin "$AGENT_SDK_BIN"
```

It exits non-zero on a mismatch and names what failed.

## Running the BFF

The workspace root is the only variable with no default — it is where Setup
scaffolds new projects. An existing Wren project is adopted later, through the
running app.

```bash
WREN_BFF_DB_PATH=/absolute/path/to/private-bff-state/bff.sqlite \
PORT=4787 \
WREN_HARNESS_WORKSPACE_ROOT=/absolute/path/to/an/empty/directory \
pnpm run start:bff
```

`PORT` defaults to `4787` and `WREN_BFF_DB_PATH` to `./wren-harness-bff.sqlite`;
keep the state file outside the workspace for anything you care about.

To point the BFF at a Warble other than the pinned one, add the same
`WARBLE_BIN` / `AGENT_SDK_BIN` you resolved above:

```bash
WREN_HARNESS_WARBLE_BIN="$WARBLE_BIN" \
WREN_HARNESS_AGENT_SDK_BIN="$AGENT_SDK_BIN" \
WREN_HARNESS_WORKSPACE_ROOT=/absolute/path/to/an/empty/directory \
pnpm run start:bff
```

You do not have to name a provider. With no `WREN_HARNESS_MODE` /
`WREN_HARNESS_PROVIDER` the harness uses whichever provider CLI it finds, and
says so plainly if it finds none. Setting them pins the choice for boot, worth
doing only when more than one is installed. Either way it is just the pre-Setup
default: once Setup saves an explicit runtime, that takes over.

## The UI

In a second terminal:

```bash
VITE_BFF_URL=http://localhost:4787 pnpm dev
```

`VITE_BFF_URL` is what connects the two — it enables Vite's `/api` proxy, and
without it the SPA never calls the BFF at all. The UI listens on
`http://localhost:5273`, or the next free port if that one is taken.

To confirm they are wired together rather than merely both running, ask the dev
server for something only the BFF can answer:

```bash
curl -s http://localhost:5273/api/config/runtime
```

With both up, the same check accepts live endpoints:

```bash
pnpm run check:contracts -- \
  --workspace-root /absolute/path/to/an/empty/directory \
  --runtime subscription:claude \
  --warble-bin "$WARBLE_BIN" \
  --agent-sdk-bin "$AGENT_SDK_BIN" \
  --live --bff-url http://localhost:4787 --ui-url http://localhost:5273
```

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
