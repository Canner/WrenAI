---
sidebar_label: Build & deploy a GenBI app
---

# Build & deploy a GenBI app

GenBI turns your project's context layer into a shareable, browser-side
dashboard, powered by [`wren-core-wasm`](../sdk/wasm.md), and ships it to your
own Vercel or Cloudflare Pages account. You never type the `wren genbi`
commands yourself: you describe the dashboard you want in plain language, and
your agent drives the CLI to produce a public URL.

This guide shows how to **talk to your agent** to get there: how to ask for a
dashboard and how to ask it to deploy. For the underlying commands and every
flag, see the [`wren genbi` CLI reference](../reference/cli.md#wren-genbi--build--deploy-genbi-apps).

## Before you start

You need two things:

- **A Wren project**: the context layer the dashboard reads from. If you don't
  have one yet, [connect a data source](connect.md) first.
- **An agent with the `wren` CLI**: any coding agent that can run shell
  commands. The agent loads its own GenBI playbook on demand via
  `wren skills get genbi`, so you don't have to teach it the workflow.

That's it. From here on you just have a conversation.

## Create a dashboard

Describe what you want in natural language. The agent figures out the queries,
picks the charts, and assembles the app. Iterate with it the same way you would
iterate with a teammate:

```text
User:  My project is in ~/forecast. Show me last week's forecast by product.
User:  And the 8-week trend.
User:  Turn this into an interactive dashboard I can filter by product and OSAT, then share.
Agent: Built it and ran the checks. Want to preview locally or deploy?
User:  Preview first.
Agent: Serving at http://127.0.0.1:8848/
User:  Make the OSAT chart a share-of-total, and lighten the palette.
Agent: Updated. Refresh the preview.
```

Behind each turn, the agent is doing the deterministic work for you. You do not
have to run any of it:

- **Gets the authoritative build instruction** from the CLI (it knows your live
  project facts and the pinned wasm version).
- **Authors the app** under `apps/<name>/`, following that instruction,
  choosing the charts and layout that answer your question.
- **Records and checks the app** so it's deploy-ready, including a secret scan
  that refuses to ship inlined credentials.
- **Previews it locally** when you ask, so you can see it before anyone else
  does.

If you want to see exactly which commands these map to, they're all in the
[CLI reference](../reference/cli.md#wren-genbi--build--deploy-genbi-apps).

## Snapshot vs live data

This is the one real choice you'll make in the conversation. Tell the agent
which you want (it defaults to **snapshot**):

| Mode | Where the data lives | Use it for |
|------|----------------------|------------|
| **snapshot** (default) | Bundled with the app and queried client-side via wasm | Demos, reports, small data, dlt-pipeline output, fully serverless |
| **live** | The app calls back to your warehouse/API at view time | Production-scale or always-fresh data; needs a CORS-enabled endpoint and **never** inlined credentials |

A snapshot freezes the numbers at build time, so it's perfect for a report you
hand off. Pick live when the dashboard has to stay current.

## Preview before you share

Just ask:

```text
User:  Preview it locally.
Agent: Serving at http://127.0.0.1:8848/
```

The agent serves the built app on your machine so you can click through it
before deploying anything. Refine in the same breath ("make this a bar chart",
"drop the OSAT filter") and the agent rebuilds.

## Deploy it

GenBI ships to your own **Vercel** or **Cloudflare Pages** account, the two
providers supported today (Vercel is the default). When you're happy, ask the
agent to ship it:

```text
User:  Deploy it to Vercel.
Agent: I need a VERCEL_TOKEN. Add it to ~/.wren/.env, then tell me.
User:  Done.
Agent: Deployed to <preview-url>
User:  Ship it to production.
Agent: Promoted to <production-url>
```

A few things worth knowing so the conversation goes smoothly:

- **You supply the deploy token, not the agent.** Add `VERCEL_TOKEN` (or
  `CLOUDFLARE_API_TOKEN` plus `CLOUDFLARE_ACCOUNT_ID`) to your environment or a
  `.env` file. Tokens are never passed on the command line, so they can't leak
  into shell history.
- **Preview vs production.** Deploys go to a preview URL by default; say "ship
  it to production" when you want the agent to promote it.
- **The deploy target is a public static host.** Anyone with the URL can read
  every file the app ships, so never let the agent inline secrets. The
  pre-deploy secret scan is a safety net, not a guarantee.

### The Vercel 401 trap

New Vercel projects ship with **Vercel Authentication** turned on, so every
deployment, preview *and* production, returns **HTTP 401** to anyone who
isn't logged into your Vercel account. The deploy succeeded; the URL is just
gated. To make the dashboard publicly shareable, disable it once in the Vercel
dashboard: **Project → Settings → Deployment Protection → Vercel
Authentication → Disabled**. If you only need a private link for yourself,
leave it on.

## See also

- [`wren genbi` CLI reference](../reference/cli.md#wren-genbi--build--deploy-genbi-apps): every subcommand and flag
- [`genbi` skill](../reference/skills.md#genbi): the agent's workflow playbook
- [`dlt-connector` skill](../reference/skills.md#dlt-connector): load SaaS data before you build
- [wren-core-wasm](../sdk/wasm.md): the in-browser engine that powers the app
