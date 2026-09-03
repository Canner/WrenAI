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

> This README is for people building or contributing to the app from
> source. If you just want to install and run the published package, see
> [INSTALL.md](./INSTALL.md) instead.

This file covers the daily build/test/typecheck loop. Two companion docs
cover the rest:

- [RUNNING.md](./RUNNING.md) — installing the CLIs and running a live,
  BFF-backed dev loop (hot reload, real questions against an adopted project).
- [MAINTAINING.md](./MAINTAINING.md) — versioning policy and the procedure
  for bumping the pinned Warble version.

## Prerequisites

- Node 20+ and `pnpm` (the repo pins its version via `corepack`).
- Python 3.11+ for the separately installed `wren` CLI.
- The separately installed `wren` CLI on `PATH`. Live questions and context
  inspection shell out to it; the app does not install it for you.

For a live, BFF-backed dev loop you'll also need the pinned `@warble/*`
packages (already pulled in by `pnpm install`, see below) or a Warble
checkout, and a logged-in Claude CLI subscription — see
[RUNNING.md § Prerequisites](./RUNNING.md#prerequisites).

## Getting started

This app lives in a pnpm workspace, so install JavaScript dependencies from
the repo root:

```bash
corepack enable
pnpm install
```

Installation alone does not start the UI. Both `pnpm genbi:dev` and
`pnpm --filter @wrenai/genbi start:bff` require a launch attestation generated
from a compatible GenBI/Warble tuple — see [RUNNING.md](./RUNNING.md) for the
live launch flow needed for hot reload or any BFF-backed work.

**Every command below runs from `apps/genbi`**, not the repo root — the
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

## Build

Like everything else below the [Getting started](#getting-started) section,
these run **from `apps/genbi`**. The repo root has no bare `build` script; it
exposes only the passthroughs `pnpm genbi:build`, `pnpm genbi:test` and
`pnpm genbi:dev`.

```bash
cd apps/genbi
pnpm build      # tsc -b (frontend typecheck) && vite build (→ dist/) && tsc -p tsconfig.server.json (server + harness → dist-server/)
pnpm start:bff  # requires WREN_GENBI_LAUNCH_ATTESTATION and the verified BFF env — see RUNNING.md
pnpm preview    # serve the frontend production build
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
