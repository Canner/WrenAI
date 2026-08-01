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
- The `warble` CLI on `PATH` — only if you intend to run the BFF against a
  real backend. It's what compiles and dispatches the agent profile this app
  renders answers from. There are no prebuilt releases yet, so you build it
  from source: see [Building the warble CLI](#building-the-warble-cli). The
  frontend alone, running against bundled fixtures, doesn't need it.
- A model for the agent to run on. The server picks one up automatically: a
  logged-in Claude subscription if it finds one, otherwise an API key, a local
  model, or a gateway. **A weak local model is the one setup that tends to
  disappoint**, and it fails in a way that looks like a bug in the app: asked
  to build a query it will sometimes describe the SQL in prose instead of
  calling the tool that runs it, so the answer comes back unverified or
  refused. If that's what you're seeing, try a stronger model before assuming
  something is misconfigured. Note the server starts whether or not it can
  actually reach a model — an unusable one surfaces when you ask a question,
  not at boot, so a clean startup isn't confirmation that this part is set up.
  If it does pick up a subscription, it says so at boot with a warning about
  the provider's terms; that line is expected, not a sign of a problem.

## Getting started

This app lives in a pnpm workspace, so install from the repo root:

```bash
corepack enable
pnpm install
pnpm genbi:dev   # or: pnpm --filter @wrenai/genbi dev
```

That's enough to work on the UI: `http://localhost:5273`, every store reads
from bundled fixtures, and with no `VITE_BFF_URL` set the app never makes a
network call.

**Every other command below runs from `apps/genbi`**, not the repo root — the
root only forwards `genbi:dev`, `genbi:build` and `genbi:test`, so `pnpm build`
or `pnpm test` from there will tell you the script doesn't exist.

```bash
cd apps/genbi
```

### Building the warble CLI

Skip this if you're only working on the frontend against fixtures.

Clone the repo and build the Rust CLI. You'll need a Rust toolchain (`cargo`)
and [`just`](https://github.com/casey/just):

```bash
git clone https://github.com/Canner/Warble.git warble
cd warble
just release      # or, without just: cargo build --release -p warble-cli
```

That produces `target/release/warble`. Put it on your `PATH` (or point the BFF
at it explicitly — the harness looks for a configured path first, then `PATH`).

Running the agent on a **logged-in Claude subscription** additionally needs
`warble-agent-sdk`, the TypeScript dispatcher in the same repo. API-key, local
and gateway auth don't use it, so skip this unless you want the subscription
path:

```bash
just install-ts && just build-ts
cd dispatcher/claude-agent-sdk && npm link   # puts warble-agent-sdk on PATH
```

Check both resolve before starting the BFF — this is the same probe the harness
itself does, so if either command fails here it will fail there too:

```bash
warble --version
warble-agent-sdk --help   # only if you built it
```

### Running the BFF

The BFF and the agent harness it wraps live alongside the frontend, in
`server/` and `harness/`. Build it, then start it with at least one of two
env vars set — the process exits with an error if neither is:

If you don't already have a wren project, use the second form — the app's setup
wizard builds one for you. The first form is for pointing at one you have, and
it means a directory that has already been built (it needs a `target/mdl.json`
in it); the server does not check at startup, so a wrong path here starts
cleanly and only fails when something asks it for the project.

```bash
pnpm build
WREN_HARNESS_PROJECT=/path/to/existing/wren/project pnpm start:bff
# — or, to boot unbound and let the in-app setup wizard create a project:
WREN_HARNESS_WORKSPACE_ROOT=/path/to/a/workspace/dir pnpm start:bff
```

Listens on `:4787` by default (`PORT` to override); state is a SQLite file
at `./wren-harness-bff.sqlite` by default (`WREN_BFF_DB_PATH` to override).

Point the frontend at it:

```bash
# apps/genbi/.env.local (not committed)
VITE_BFF_URL=http://localhost:4787
```

```bash
pnpm dev   # dev server now proxies /api/* to VITE_BFF_URL
```

`VITE_BFF_URL` is what makes this real — without it the frontend never calls
the BFF at all, it just keeps rendering fixtures, which looks like nothing
happened rather than erroring. A production build has no dev proxy: the
built app calls `VITE_BFF_URL` directly from the browser, so the BFF then
needs to either serve the app from the same origin or send CORS headers.

To check the two are actually wired up rather than merely both running, ask the
dev server for something only the BFF can answer:

```bash
curl -s http://localhost:5273/api/config/runtime
```

JSON back means the proxy reached the BFF. The SPA's own `index.html` means
`VITE_BFF_URL` isn't in effect; `502` means it is, but nothing is listening.

That one answers the same regardless of which boot mode you used, so if you
bound a project, check the project itself resolved:

```bash
curl -s http://localhost:4787/api/context/overview
```

A bound, built project returns its name and its models. A path that isn't one
returns a `500` naming what's missing — usually that it hasn't been built yet.

## Build

```bash
pnpm build      # tsc -b (frontend typecheck) && vite build (→ dist/) && tsc -p tsconfig.server.json (server + harness → dist-server/)
pnpm start:bff  # node dist-server/server/bin.js
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
```

End to end: a question goes to the harness, which compiles the user's
profile and dispatches it to the configured backend; a verified answer
envelope comes back, and the UI renders it.
