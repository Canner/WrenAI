---
name: wren-genbi-app
description: "Turn a Wren project's semantic layer into a shareable, browser-side GenBI web app and deploy it to the user's Vercel or Cloudflare account. Orchestrates the full flow: `wren genbi build` returns a project-hydrated build instruction, the agent authors the app from scratch into apps/<name>/, then register → verify → deploy produce a shareable URL. Use this skill whenever the user wants to: build a dashboard from their Wren project, make a shareable analytics app, deploy their semantic layer as a web app, host a GenBI app on Vercel or Cloudflare Pages, or says '把這個語意層變成 app', '做一個 dashboard 分享出去', '部署成網頁', 'genbi app'."
license: Apache-2.0
metadata:
  author: wrenai
  version: "1.0"
---

# wren-genbi-app

Turn a Wren semantic layer into a shareable GenBI app — from a natural-language
request to a public URL in one conversation.

**Division of labor:** the CLI owns the authoritative build instruction (it
knows the live project facts and the pinned `wren-core-wasm` version) and all
deterministic state (index, verify, deploy). You — the agent — author the app
code by following the instruction. Never hand-write `.wren/apps.yml`.

## Preconditions

1. A Wren project is discoverable (`wren_project.yml` in cwd/ancestors, or ask
   for the path and pass `-p`).
2. The semantic layer exists. If `target/mdl.json` is missing, `wren genbi
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
data-mode guidance, acceptance criteria, and the target folder. It writes
nothing to disk.

### 3. Author the app

Follow the instruction exactly. Key conventions:

- Write everything under `apps/<name>/` — never outside it.
- Copy the compiled MDL into the app as `apps/<name>/mdl.json`.
- Load `wren-core-wasm` from the CDN given in the instruction; never bundle
  the ~68MB binary.
- snapshot: convert the data (e.g. the dlt pipeline's DuckDB output) to
  parquet and place it under `apps/<name>/data/`.
- live: write an endpoint-only connection config. NEVER inline credentials —
  `verify` will fail the app and `deploy` will refuse to ship it.
- Design the dashboard to actually answer the user's request: pick the right
  charts/tables for the question, not a generic template.

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
- Cloudflare also needs `CLOUDFLARE_ACCOUNT_ID` (env or `.env`) and a token
  scoped with Pages:Edit.
- Report the returned URL to the user. Re-deploying the same app updates the
  same provider target.

## Safety boundaries

- Never inline secrets/credentials into app files — the deploy target is a
  public static host; anyone with the URL can read every file.
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
