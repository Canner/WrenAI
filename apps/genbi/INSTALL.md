# Installing `@wrenai/genbi`

How to install and run `@wrenai/genbi` without developing it. If you are working
on the app itself, see [README.md](./README.md) instead.

It is not on npm yet — see [Status](#status-not-yet-published) — so the install
below packs a tarball from a checkout. Everything after that step is what a
published install will do too.

## What it is

`@wrenai/genbi` is a GenBI web app: a small HTTP server (the "BFF") plus a
built single-page UI. It talks to the [Wren](https://github.com/Canner/WrenAI)
semantic layer through the `wren` CLI and to an AI agent backend (Warble)
that it installs as a dependency. Once running, it serves a web UI for
asking questions over your data and getting back verified, structured
answers (tables, charts, KPIs, narrative text).

## Status: not yet published

**`@wrenai/genbi` is not yet published to the npm registry.** `npx
@wrenai/genbi` or `npm install @wrenai/genbi` will not work today. This
guide instead documents the only working install path right now: building a
local tarball with `npm pack` from a checkout of this repo, then installing
that tarball. Once the package is published, the tarball step is replaced
by a normal `npm install -g @wrenai/genbi` (or `npx @wrenai/genbi`) — the
rest of this guide (running it, configuration, troubleshooting) will still
apply unchanged.

## Supported platforms

`@wrenai/genbi` depends on `@warble/cli`, a Rust binary fetched from GitHub
Releases during install. That binary is published for exactly these four
platforms:

| OS | Architecture |
| --- | --- |
| macOS | Apple Silicon (`aarch64-apple-darwin`) |
| macOS | Intel (`x86_64-apple-darwin`) |
| Linux (glibc ≥ 2.31) | x86_64 (`x86_64-unknown-linux-gnu`) |
| Linux (glibc ≥ 2.31) | aarch64 (`aarch64-unknown-linux-gnu`) |

**Windows is not supported.** **musl-based Linux (e.g. Alpine) is not
supported**, nor is glibc older than 2.31 — install fails outright on these;
see [Troubleshooting](#troubleshooting).

## Prerequisites

- **Node.js 20 or later.** `apps/genbi/package.json` declares `"engines":
  {"node": ">=20"}`.
- **npm** (or another package manager capable of running npm lifecycle
  scripts and installing a local tarball).
- **The `wren` CLI on `PATH`**, already configured against a Wren project.
  `@wrenai/genbi` shells out to it for live questions and context
  inspection; it does not install or configure `wren` for you. See the
  [Wren project](https://github.com/Canner/WrenAI).
- **Network access to `github.com`** during install (to fetch the Warble
  binary) and on first use (see [Network](#network) below). Fully offline /
  air-gapped installs are not supported and are out of scope for this guide.

## Install

From a checkout of this repo, on `apps/genbi`:

```bash
npm pack
```

This produces a tarball named `wrenai-genbi-<version>.tgz` in the current
directory (built via the package's own `prepack` script, which builds the
UI and server first). Copy that tarball wherever you want to run the app
from, then install it there, e.g.:

```bash
npm install /path/to/wrenai-genbi-0.0.0.tgz
```

This installs `@wrenai/genbi` as a local dependency and, as part of `npm
install`, runs `@warble/cli`'s postinstall script, which downloads the
Warble binary for your platform (about 12 MB) from GitHub Releases and
verifies its checksum against the release manifest. This is the point
where an unsupported platform (see above) fails — before any of the app's
own code runs.

## Run

`@wrenai/genbi` requires one environment variable to start:

```bash
WREN_HARNESS_WORKSPACE_ROOT=/path/to/a/writable/directory npx genbi
```

(If you installed the tarball as a project dependency rather than
globally, run `npx genbi` from that project, or invoke
`node_modules/.bin/genbi` directly.)

## What to expect on first start

On a successful start you'll see, in order:

1. Possibly a Node.js `ExperimentalWarning` on stderr about SQLite (Node's
   built-in `node:sqlite` module, which this package uses for its state
   file). This comes from Node itself, not from `@wrenai/genbi`; whether it
   appears depends on your Node version, and it's not an error.
2. A warning on stderr about using a personal provider subscription (e.g. a
   Claude subscription) to authenticate — that it may be against that
   provider's Terms of Service, that it's for personal single-operator use
   only, and that you're responsible for checking the current ToS. This
   warning is expected on every start where a personal subscription is the
   auth mode; it is not a sign of misconfiguration.
3. A final line on stdout: `wren-harness BFF listening on
   http://127.0.0.1:<port> (db: <path>)`.

At that point the BFF is up but **unbound** — no Wren project has been
selected yet. Opening the printed URL in a browser starts the setup wizard,
which is where you point the app at a project (either scaffolding a new one
under `WREN_HARNESS_WORKSPACE_ROOT`, or adopting an existing one from any
path on disk).

## Configuration

All configuration is via environment variables. The two most commonly
needed ones:

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `WREN_HARNESS_WORKSPACE_ROOT` | Yes | none — the process exits with an error if unset | Directory the setup wizard scaffolds **new** Wren projects into. An **existing** project is brought in separately via the setup wizard's "adopt" flow, which accepts any path on disk and is not affected by this variable. |
| `PORT` | No | `4787` | HTTP port the BFF listens on. |
| `WREN_BFF_DB_PATH` | No | `./wren-harness-bff.sqlite` (created in the current working directory) | Path to the BFF's SQLite state file. |

There are additional environment variables for authentication mode,
provider selection, and other advanced configuration; they are not covered
here because they aren't needed for a first install and run.

## Network

`@wrenai/genbi` reaches `github.com` at two points:

1. **At install time** — `@warble/cli`'s postinstall script downloads the
   Warble executable for your platform (~12 MB) from a GitHub Release and
   checksum-verifies it.
2. **At runtime, on first use** — the first time the app compiles a
   profile, it downloads a Hub component archive from GitHub. After that
   first download it's cached locally and no further network access to
   GitHub is needed for subsequent compiles.

Offline or air-gapped environments are not supported by this guide.

## Troubleshooting

**"Platform ... is not supported by @warble/cli"** (during `npm install`) —
your OS/architecture isn't one of the four supported platforms listed
above. This includes Windows and musl-based Linux distributions (e.g.
Alpine), where the installer additionally reports a libc mismatch before
failing. There is no workaround; a matching platform is required.

**Node version errors, or unexpected syntax/runtime errors on startup** —
confirm your Node version is 20 or later (`node --version`). Older
versions are not supported by this package (`engines.node` in
`package.json` declares `>=20`) and are not tested.

**`error: WREN_HARNESS_WORKSPACE_ROOT is required`** — this environment
variable must be set before starting the app; see [Run](#run) above. There
is no default.

**`error: port 4787 is already in use`** — something else is bound to
`4787` (or to whatever `PORT` you set). Either stop it, or start on a free
port:

```bash
PORT=4790 WREN_HARNESS_WORKSPACE_ROOT="$HOME/wren-workspace" npx @wrenai/genbi
```
