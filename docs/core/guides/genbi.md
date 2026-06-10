---
sidebar_label: Build & deploy a GenBI app
---

# Build & deploy a GenBI app

`wren genbi` turns a project's context layer into a shareable, browser-side
GenBI web app — powered by [`wren-core-wasm`](../sdk/wasm.md) — and deploys it
to the user's Vercel or Cloudflare Pages account. The whole flow runs through
an AI agent: the user describes the dashboard they want in natural language,
and the agent drives the CLI to produce a public URL.

## The CLI ↔ agent split

GenBI deliberately divides the work:

- **The CLI owns the deterministic parts** — the authoritative build
  instruction (it knows the live project facts and the pinned wasm version),
  the app index (`.wren/apps.yml`), `verify`, and `deploy`.
- **The agent owns authoring** — it writes the app code by following the build
  instruction, choosing the charts and layout that actually answer the user's
  question.

`.wren/apps.yml` is always machine-written via `wren genbi register/remove` —
never edited by hand.

The matching agent workflow guide is served by the CLI: `wren skills get
genbi`. For the full command/flag reference see the
[CLI reference](../reference/cli.md#wren-genbi--build--deploy-genbi-apps).

## Data modes

Pick one at build time:

| Mode | Where the data lives | Use it for |
|------|----------------------|------------|
| **snapshot** (default) | Bundled with the app as `data/*.parquet`, queried client-side via wasm | Demos, reports, small data, dlt-pipeline output — fully serverless |
| **live** | The app calls back to your warehouse/API at view time | Production-scale or always-fresh data; needs a CORS-enabled endpoint and **never** inlined credentials |

## The conversational flow

The user never has to know the `wren genbi` commands — they describe intent and
the agent translates it. A typical end-to-end conversation:

```text
U: My project is in ~/forecast — last week's forecast by product?
U: And the 8-week trend?
U: Turn this into an interactive dashboard I can filter by product/OSAT and share.
A: (build → author → register → verify) Done — preview locally or deploy?
U: Preview first.            → A: http://127.0.0.1:8848/
U: Make the OSAT chart a share-of-total; lighten the palette.
U: Deploy it to Vercel.
A: I need a VERCEL_TOKEN — add it to ~/.wren/.env, then tell me.
U: Done.                     → A: Deployed <preview-url>
A: Heads-up: the URL returns 401 — Vercel Deployment Protection is on.
   Disable it at Project → Settings → Deployment Protection to make it public.
U: Disabled.                 → A: Confirmed public ✅
U: Ship it to production.    → A: (--prod) <production-url>
```

What the agent runs behind each turn:

### 1. Build — get the instruction

```bash
wren genbi build forecast-dashboard --prompt "<the user's request, verbatim>" --data-mode snapshot
```

Prints the authoritative build instruction (wasm wiring with the pinned
`wren-core-wasm` version, the project's model/column inventory, data-mode
guidance, acceptance criteria, and the target folder). It writes no app files;
it only compiles `target/mdl.json` first if it's missing. Use `--prompt-file`
or `--prompt -` for long prompts.

### 2. Author the app

The agent writes everything under `apps/<name>/`, following the instruction:

- copy the compiled MDL in as `apps/<name>/mdl.json`;
- load `wren-core-wasm` from the CDN in the instruction (never bundle the
  ~68 MB binary);
- **snapshot:** export the data the dashboard needs to `apps/<name>/data/` as
  parquet. A DuckDB-backed project (including anything loaded by the
  [`dlt-connector`](../reference/skills.md#dlt-connector) skill) exports
  trivially:

  ```bash
  python - <<'PY'
  import duckdb
  con = duckdb.connect("<db>.duckdb", read_only=True)
  con.execute(
      "COPY (SELECT * FROM <table>) "
      "TO 'apps/<name>/data/<table>.parquet' (FORMAT parquet)"
  )
  PY
  ```

- **live:** write an endpoint-only connection config — never inline
  credentials.

### 3. Register & verify

```bash
wren genbi register forecast-dashboard --data-mode snapshot
wren genbi verify forecast-dashboard
```

`verify` is a deterministic, no-browser preflight: required files exist,
`mdl.json` parses, snapshot apps ship a `.parquet`/`.duckdb` asset, and a
**default-deny secret scan** flags inlined credentials (and refuses any
`.env*` file outright). `deploy` gates on `verify`.

> The secret scan is best-effort defense-in-depth, **not** a guarantee — the
> real rule is *never inline secrets into app files*. The deploy target is a
> public static host: anyone with the URL can read every shipped file.

### 4. Preview locally

```bash
wren genbi open forecast-dashboard --port 8848
```

### 5. Deploy

```bash
wren genbi deploy forecast-dashboard --provider vercel        # or cloudflare
wren genbi deploy forecast-dashboard --provider vercel --prod # confirm with the user first
```

- **Preview by default;** `--prod` ships to production.
- **Tokens** are discovered from the environment or `.env` files
  (`VERCEL_TOKEN` / `CLOUDFLARE_API_TOKEN`, plus `CLOUDFLARE_ACCOUNT_ID`) —
  never passed as CLI flags (they'd leak into shell history).
- **Cloudflare** shells out to the [`wrangler`](https://developers.cloudflare.com/workers/wrangler/)
  CLI (`npm install -g wrangler`, or have `npx` available) — Pages has no
  single inline-upload REST endpoint.

## Vercel Deployment Protection (the 401 trap)

New Vercel projects ship with **Vercel Authentication** on by default, so every
deployment — preview *and* production — returns **HTTP 401** to anyone not
logged into the owning account. The deploy itself succeeded; the URL is just
gated. To make the app publicly shareable, disable it in the Vercel dashboard:
**Project → Settings → Deployment Protection → Vercel Authentication →
Disabled**. This is a one-time per-project toggle, not controllable from
`wren genbi deploy`. If you only need a private link (viewable while logged
into your account), leaving it on is fine.

## See also

- [`wren genbi` CLI reference](../reference/cli.md#wren-genbi--build--deploy-genbi-apps)
- [`genbi` skill](../reference/skills.md#genbi)
- [`dlt-connector` skill](../reference/skills.md#dlt-connector) — load SaaS data first
- [wren-core-wasm](../sdk/wasm.md) — the in-browser engine that powers the app
