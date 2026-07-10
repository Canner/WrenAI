---
name: genbi
description: "Turn a Wren project's context layer into a shareable, browser-side GenBI web app and deploy it to the user's Vercel or Cloudflare account. Orchestrates the full flow: `wren genbi build` returns a project-hydrated build instruction, the agent authors the app from scratch into apps/<name>/, then register → verify → deploy produce a shareable URL. Use this skill whenever the user wants to: build a dashboard from their Wren project, make a shareable analytics app, deploy their context layer as a web app, host a GenBI app on Vercel or Cloudflare Pages, or asks for a 'genbi app'."
license: Apache-2.0
metadata:
  author: wrenai
---

# Wren GenBI App — Agent Workflow Guide

> This guide is served by the `wren` CLI (`wren skills get genbi`), so it
> always matches your installed wrenai version.

Turn a Wren context layer into a shareable GenBI app — from a natural-language
request to a public URL in one conversation.

**Division of labor:** the CLI owns the authoritative build instruction (it
knows the live project facts and the pinned `wren-core-wasm` version) and all
deterministic state (index, verify, deploy). You — the agent — author the app
code by following the instruction. Never hand-write `.wren/apps.yml`.

## Preconditions

1. A Wren project is discoverable (`wren_project.yml` in cwd/ancestors, or ask
   for the path and pass `-p`).
2. The context layer exists. If `target/mdl.json` is missing, `wren genbi
   build` compiles it implicitly — no separate step needed.
3. `wren` CLI ≥ the version that ships the `genbi` command group
   (`wren genbi --help` works).

## Workflow

### 1. Resolve the app name and data mode

- App name: short kebab-case derived from the request (e.g. `sales-overview`).
- Data mode:
  - `snapshot` (default) — data is bundled with the app as parquet/duckdb and
    queried client-side. Fully serverless. Right for demos, reports, small
    data, and dlt-pipeline output.
  - `live` — the app calls back to the user's warehouse/API at view time.
    Right for production-scale or always-fresh data. Requires a CORS-enabled
    endpoint and carries strict no-credentials rules.
- Ask the user ONLY if the choice is genuinely ambiguous.

### 2. Get the build instruction

```bash
wren genbi build <name> --prompt "<the user's request, verbatim>" --data-mode <mode>
```

For long or multi-line prompts use `--prompt-file <file>` or pipe to
`--prompt -`. The command prints the authoritative build instruction —
wasm wiring (pinned version, CDN load), the project's model/column inventory,
data-mode guidance, acceptance criteria, and the target folder. It writes no
app files — the only thing it may touch is `target/mdl.json`, which it compiles
first if missing (see Precondition 2).

### 3. Author the app

Follow the instruction exactly. Key conventions:

- Write everything under `apps/<name>/` — never outside it.
- Copy the compiled MDL into the app as `apps/<name>/mdl.json`.
- Load `wren-core-wasm` from the CDN given in the instruction; never bundle
  the ~68MB binary.
- snapshot: export the data the dashboard needs into `apps/<name>/data/` as
  parquet (`verify` requires at least one `.parquet`/`.duckdb` asset). See
  **Snapshot data export** below for the recipe and where the data comes from.
- live: write an endpoint-only connection config. NEVER inline credentials —
  `verify` scans for them (best-effort) and `deploy` gates on `verify`, but
  the rule is on you: a public static host exposes every shipped file.
- Design the dashboard to actually answer the user's request: pick the right
  charts/tables for the question, not a generic template.

#### Snapshot data export

The CLI hands you the build instruction, but the snapshot bytes still have to
be exported into the app folder — that step is yours.

**Where the data comes from:**

- **DuckDB-backed project** (incl. anything loaded by the `dlt-connector`
  skill — its pipelines always land in a `.duckdb` file): the project's DuckDB
  file *is* your snapshot source. If the user is connecting SaaS data (HubSpot,
  Stripe, Salesforce, …) and has no project yet, run the SaaS→project flow
  first: `wren skills get dlt-connector`. Then come back here to ship it.
- **Warehouse-backed project** (Postgres, BigQuery, Snowflake, …): run the
  query/queries the dashboard needs through the MDL layer and write the result
  to parquet. Keep snapshots small — snapshot mode is for demos/reports, not
  full warehouse extracts; use `live` mode for large or always-fresh data.

**Recipe (DuckDB → parquet):**

```bash
# from the project root; <db> is the project's DuckDB file (see wren_project.yml)
python - <<'PY'
import duckdb
con = duckdb.connect("<db>.duckdb", read_only=True)
con.execute(
    "COPY (SELECT * FROM <table>) "
    "TO 'apps/<name>/data/<table>.parquet' (FORMAT parquet)"
)
PY
```

Only export the columns/rows the dashboard uses. The compiled `mdl.json` you
copied in keeps the context layer intact regardless of how you bundle data.

### 4. Register and verify

```bash
wren genbi register <name> --data-mode <mode>
wren genbi verify <name>
```

If verify fails: fix the reported problems and re-run verify. Do NOT proceed
to deploy on a failed verify. Offer `wren genbi open <name>` for a local
preview before shipping.

### 5. Deploy (only if the user asked for it)

```bash
wren genbi deploy <name> --provider vercel      # or cloudflare
```

- Preview deployment by default. **Confirm with the user before `--prod`.**
- Tokens: the CLI discovers `VERCEL_TOKEN` / `CLOUDFLARE_API_TOKEN` from the
  environment or `.env` files. If missing, ask the user to export it or add
  it to the project `.env`. NEVER put a token on the command line.
- Cloudflare also needs `CLOUDFLARE_ACCOUNT_ID` (env or `.env`), a token
  scoped with Pages:Edit, and the `wrangler` CLI on PATH (or `npx` available)
  — the adapter shells out to `wrangler pages deploy`. If it's missing, ask
  the user to `npm install -g wrangler`.
- Report the returned URL to the user. Re-deploying the same app updates the
  same provider target.
- **Verify the URL actually loads.** After deploying, fetch the URL — a
  successful deploy can still return **HTTP 401/403** to outsiders because of
  the provider's access protection (see below). Don't report a link as
  "shareable" until you've confirmed it serves.

### Vercel Deployment Protection (the 401 trap)

New Vercel projects ship with **Vercel Authentication** turned ON by default,
so every deployment — preview *and* production — returns **401** to anyone not
logged into the owning Vercel account/team. The deploy itself succeeded; the
URL is just gated.

- To make the app publicly shareable, the user disables it in the Vercel
  dashboard: **Project → Settings → Deployment Protection → Vercel
  Authentication → Disabled** (or scope it to production only). This setting
  is not controllable from `wren genbi deploy`; it's a one-time toggle per
  project in Vercel.
- If the user only needs a private link (viewable while logged into their
  Vercel account), leaving protection on is fine — just tell them the link
  won't work for logged-out visitors.

## Safety boundaries

- Never inline secrets/credentials into app files — the deploy target is a
  public static host; anyone with the URL can read every file. `verify`
  scans for inlined credentials, but treat it as best-effort
  defense-in-depth, not a guarantee — never rely on it to catch a secret
  you shouldn't have written in the first place.
- Never pass tokens as CLI flags; they leak into shell history.
- Confirm before production deploys.
- All index state goes through `wren genbi register/remove` — never edit
  `.wren/apps.yml` by hand.

## Quick reference

| Step | Command |
| --- | --- |
| Get build instruction | `wren genbi build <name> --prompt "…" [--data-mode snapshot\|live]` |
| Record the app | `wren genbi register <name> --data-mode <mode>` |
| Preflight | `wren genbi verify <name>` |
| Local preview | `wren genbi open <name>` |
| Ship | `wren genbi deploy <name> --provider vercel\|cloudflare [--prod]` |
| Inventory | `wren genbi list` / `wren genbi remove <name>` |
