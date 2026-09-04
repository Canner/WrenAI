# GenBI app (`@wrenai/genbi`)

WrenAI's web UI. Point it at your data through the setup wizard, then ask
questions in the browser and get answers back as tables, charts, KPIs and
narrative.

The app does not write SQL itself. A question goes to the Wren agent harness,
which answers with a structured envelope — the blocks to render, and whether the
answer was verified — and the UI renders that.

To just run it, `npx @wrenai/genbi` is the whole story — see
[Getting started](#getting-started) below, or [INSTALL.md](./INSTALL.md) for
what it needs and how to configure it.

The rest of this README is for working on the app **from source**: getting it
running, and the daily build/test/typecheck loop. Three companion docs cover
the rest:

- [RUNNING.md](./RUNNING.md) — a live, BFF-backed dev loop against your own
  Warble build, and checking that the pieces still fit together.
- [MAINTAINING.md](./MAINTAINING.md) — versioning policy and the procedure for
  bumping the pinned Warble version.
- [INSTALL.md](./INSTALL.md) — running the app without developing it: what it
  needs, what it does on first start, and how to configure it.

## Developer preview

`@wrenai/genbi` is published at `0.0.1`. Nothing here is under a compatibility
commitment yet — commands, environment variables and interfaces move without
notice. The Codex runtime is supported in code but has not been exercised end
to end; Claude is the one that is. See
[MAINTAINING.md](./MAINTAINING.md#versioning) for what the version number does
and does not promise.

## Prerequisites

- Node 20+ and `pnpm` (the repo pins its version via `corepack`).
- Python 3.11+ for the separately installed `wren` CLI.
- The separately installed `wren` CLI on `PATH`. Live questions and context
  inspection shell out to it; the app does not install it for you.

A live, BFF-backed dev loop also needs a provider CLI you are logged in to. The
pinned `@warble/*` packages are already pulled in by `pnpm install` — see
[RUNNING.md § Prerequisites](./RUNNING.md#prerequisites).

## Getting started

### Just run it

```bash
WREN_HARNESS_WORKSPACE_ROOT=/absolute/path/to/an/empty/directory npx @wrenai/genbi
```

That fetches the published package, downloads the Warble binary for your
platform on install, and serves the built UI and the BFF from one process on
`http://127.0.0.1:4787`. You still need a provider CLI you are logged in to
(`claude` or `codex`) and the `wren` CLI on `PATH`.
[INSTALL.md](./INSTALL.md) covers the prerequisites, what happens on first
start, and every other environment variable.

### From source

Everything below is the development loop, and is only worth setting up if you
are changing the app. It lives in a pnpm workspace, so install JavaScript
dependencies from the repo root:

```bash
corepack enable
pnpm install
```

**Every command below runs from `apps/genbi`**, not the repo root — the root
only forwards `genbi:dev`, `genbi:build` and `genbi:test`, so `pnpm build` or
`pnpm test` from there will tell you the script doesn't exist.

Then build once and start two processes: the BFF, and Vite pointed at it.

```bash
cd apps/genbi
pnpm build
```

```bash
# terminal 1
WREN_HARNESS_WORKSPACE_ROOT=/absolute/path/to/an/empty/directory pnpm run start:bff
```

```bash
# terminal 2
VITE_BFF_URL=http://localhost:4787 pnpm dev
```

Open the URL Vite prints — `http://localhost:5273` unless something already holds
that port, in which case it takes the next free one and says which.

You need a provider CLI on `PATH` (`claude` or `codex`); the harness probes for one at boot
and says so plainly if it finds none. `WREN_HARNESS_WORKSPACE_ROOT` is the
directory Setup scaffolds new projects into — the one thing with no sensible
default. Everything else the BFF needs it resolves itself.

[RUNNING.md](./RUNNING.md) covers the rest: pointing at a Warble build of your
own, verifying the tuple, and the Codex situation.

## Build

Like everything else below the [Getting started](#getting-started) section,
these run **from `apps/genbi`**. The repo root has no bare `build` script; it
exposes only the passthroughs `pnpm genbi:build`, `pnpm genbi:test` and
`pnpm genbi:dev`.

```bash
cd apps/genbi
pnpm build      # tsc -b (frontend typecheck) && vite build (→ dist/) && tsc -p tsconfig.server.json (server + harness → dist-server/)
pnpm start:bff  # requires the BFF runtime env — see RUNNING.md
pnpm preview    # serve the built SPA on its own — no BFF, no proxy, fixture data only
```

## Test & typecheck

Also from `apps/genbi` (`pnpm genbi:test` from the root runs the same suite).

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

## Architecture

```
src/      the frontend SPA — React + Ant Design, one Zustand store per feature
server/   the BFF — Hono REST + SSE routes over a SQLite-backed session/artifact store
harness/  the agent runtime the BFF wraps — compiles a per-user profile and dispatches it
profiles/ the GenBI Warble profiles (genbi-default/-setup/-enrich-context/-monitor) + IRs
```

End to end: a question goes to the harness, which compiles the user's profile and
dispatches it to the configured backend; a verified answer envelope comes back,
and the UI renders it.

| Concern | Choice |
| --- | --- |
| Build / dev | Vite — client-rendered SPA, no SSR |
| UI | React + Ant Design (Wren AI Design System theme) |
| Routing | React Router |
| State | Zustand |
| Charts | ECharts |

It is a plain SPA rather than an SSR framework on purpose: it only talks to the
BFF over HTTP/SSE and builds to static assets, so a future desktop shell or PWA
stays a thin increment.
