---
name: wren-onboarding
description: "Onboard a user to Wren Engine end-to-end. Walks through environment checks, project scaffolding, connection configuration via .env, and first query. Use when: user wants to install Wren Engine, set up a new data source connection, or bootstrap a new project from scratch. Triggers: '/wren-onboarding', 'install wren', 'set up wren engine', 'wren onboarding', 'connect new database to wren'."
license: Apache-2.0
metadata:
  author: wren-engine
  version: "2.1"
---

# Wren Onboarding — Agent Workflow

This skill walks the agent through onboarding — environment checks, project scaffolding, profile creation, MDL generation, and first query. **Procedural details, per-datasource setup notes, and the troubleshooting playbook live in the docs**, not here. The skill's job is to enforce the agent-side rules (one step per turn, never ask for credentials in chat) and to dispatch the agent to the right doc / sibling skill at each step.

Reference docs (the skill points to these — never duplicate their content):
- [`docs/get_started/installation.md`](https://github.com/Canner/wren-engine/blob/main/docs/get_started/installation.md) — CLI install + skill install
- [`docs/get_started/connect.md`](https://github.com/Canner/wren-engine/blob/main/docs/get_started/connect.md) — full connection procedure, **per-datasource setup notes, complete troubleshooting playbook**
- [`docs/get_started/quickstart.md`](https://github.com/Canner/wren-engine/blob/main/docs/get_started/quickstart.md) — bundled `jaffle_shop` demo

## Version check

Silently fetch `https://raw.githubusercontent.com/Canner/wren-engine/main/skills/versions.json`. Compare the `wren-onboarding` key with this skill's version (from the frontmatter above). If the remote version is newer, notify the user:

> A newer version of the **wren-onboarding** skill is available.
> Update with:
> ```
> npx skills add Canner/wren-engine --skill wren-onboarding
> ```

Continue regardless of update status.

## Mode of operation — READ THIS FIRST

**One step per round-trip.** Each numbered step below is its own turn: explain briefly, ask **only** what the step needs, run the command(s), confirm, move on.

- ❌ **Never collect information for future steps upfront.** Do not ask for project name + database type + credentials in one message.
- ❌ **Never ask for credentials in chat — not host, port, user, password, tokens, anything.** Credentials always go through `.env`. The user fills the file in their editor; the agent never sees the values.
- ❌ **Never query the database before MDL is built** via the `wren-generate-mdl` skill.
- ❌ **Never invent connection field names.** Always run `wren docs connection-info <ds>` to see the real fields — it's introspected from the live Pydantic schema, so it's always correct.
- ✅ Wait for each command to finish, report its output in plain language, then move on.
- ✅ For any error, consult `connect.md#troubleshooting` and surface the relevant section to the user — don't carry a copy of the playbook here.

## Preflight (environment only — no user questions about the project)

Read-only checks. Report findings, do **not** ask about project / credentials / datasource yet.

1. `python3 --version` — requires Python 3.11+. If older, ask the user to upgrade and stop.
2. Check virtualenv: `python3 -c "import sys; print(sys.prefix != sys.base_prefix)"`. If `False`, offer to create one (`python3 -m venv .venv && source .venv/bin/activate`). PEP 668 systems will need this.
3. `wren --version` — if already installed, confirm before reinstalling.
4. `pwd` — record it. Don't ask where the project should live yet.

Report findings as a 4-bullet list, then continue.

## Early branch — demo or own database?

> "Try the bundled `jaffle_shop` demo first (~30s, no DB needed), or connect your own database?"

- **demo** → point at [`quickstart.md`](https://github.com/Canner/wren-engine/blob/main/docs/get_started/quickstart.md) and stop this skill.
- **own DB** → continue.

## Step 1 — Collect project name + database type

These two are the only thing Step 2 needs; ask both together so the user has a clean handoff:

> "Two things before I scaffold:
> 1. **Project name** — I'll create `~/<name>/` and `cd` into it.
> 2. **Database type** — run `wren docs connection-info` (no argument) to see the full list, or pick a common one: `postgres`, `mysql`, `bigquery`, `snowflake`, `clickhouse`, `trino`, `duckdb`, …"

Wait for both. Don't ask for credentials.

## Step 2 — Workspace + .env setup (batch)

Side effects: creates `~/<project>/`, installs `wren-engine[<ds>,main]`, generates an empty `.env` template. The project files (`wren_project.yml` etc.) come later in Step 3.5 — at this point we only have a directory with credentials waiting to be filled.

Run as a batch — report each command briefly, then end with one "please fill `.env`" ask:

1. `mkdir -p ~/<project> && cd ~/<project>`.
2. `pip install "wren-engine[<ds>,main]"`. For datasource-specific install gotchas (macOS mysql, etc.), see [`connect.md#per-datasource-setup-notes`](https://github.com/Canner/wren-engine/blob/main/docs/get_started/connect.md).
3. **Generate the `.env` template by introspecting the connector**:

   ```bash
   wren docs connection-info <ds> --format md
   ```

   Use the field list to write `.env` with `<DS>_<FIELD>=` keys (UPPER_SNAKE), values **empty**. Example for postgres:

   ```ini
   POSTGRES_HOST=
   POSTGRES_PORT=5432
   POSTGRES_DATABASE=
   POSTGRES_USER=
   POSTGRES_PASSWORD=
   ```

   Special encodings (BigQuery base64, Snowflake account format, Athena AWS creds, etc.) are documented in [`connect.md#per-datasource-setup-notes`](https://github.com/Canner/wren-engine/blob/main/docs/get_started/connect.md). Surface the relevant section to the user verbatim — don't paraphrase.

4. Add `.env` to `.gitignore` if the project is a git repo. Suggest `chmod 600 .env`.
5. Tell the user: `.env` is at `<path>`, please fill every value and reply **"done"**.

## Step 3 — Create the connection profile

Only after the user replies "done".

Write `/tmp/conn.yml` with **every field as a `${VAR}` placeholder** matching the `.env` keys you generated in Step 2:

```yaml
datasource: <ds>
host: ${<DS>_HOST}
port: ${<DS>_PORT}
# … one line per field from `wren docs connection-info <ds>`
```

Then:

```bash
wren profile add <project> --from-file /tmp/conn.yml
```

Validation runs automatically. The CLI overwrites profiles silently — there is no `--force` flag.

- ✓ **Success** → continue to Step 3.5.
- ⚠ **Any warning** → consult [`connect.md#troubleshooting`](https://github.com/Canner/wren-engine/blob/main/docs/get_started/connect.md) for the exact symptom (missing secret, driver auth failure, ValidationError, unreachable host, …) and tell the user what to fix.

## Step 3.5 — Scaffold the project

```bash
wren context init --empty
```

Refuses to overwrite an existing `wren_project.yml`. Creates the project directory layout (`models/`, `views/`, `relationships.yml`, `instructions.md`, `AGENTS.md`, `queries.yml`).

## Step 3.6 — Bind the profile to the project

```bash
wren context set-profile <project>
```

Writes both `profile: <project>` and `data_source: <ds>` into `wren_project.yml` (data_source is taken from the profile we just validated, so it's guaranteed correct). Future CLI commands and the SDK resolve the connection deterministically — independent of which profile is globally active.

This step also future-proofs the project for multi-project setups: once the binding is recorded, switching `wren profile switch` elsewhere never breaks this project's queries.

## Step 4 — Generate MDL (hand off)

> ⚠️ The agent **must** build MDL before any data query. Queries against tables not in MDL will fail.

Invoke the **`wren-generate-mdl`** skill. It walks the agent through table introspection, type normalization, and YAML generation. When it finishes, return here and run:

```bash
wren context validate
wren context build
```

Report the model count and any validate warnings.

**Memory recommendation**: count models with `wren context show | grep -c '^model:'`. If `>= 200`, suggest `pip install "wren-engine[memory]"` + `wren memory index` (~800 MB). If `< 200`, skip.

## Step 5 — Ready to explore (hand off)

Suggest 2–3 NL questions based on the discovered tables (e.g. for an orders schema: "How many orders last month?", "Top 5 customers by total"). Then end this skill: for day-to-day querying the agent should switch to the **`wren-usage`** skill.

## Cross-skill routing

| Trigger | Skill |
|---------|-------|
| User mentions a SaaS source (HubSpot, Stripe, Salesforce, GitHub, Slack, …) | `wren-dlt-connector` |
| User has a connected DB but no MDL yet | `wren-generate-mdl` |
| User has MDL ready, wants to query | `wren-usage` |
| Anything else from-scratch | `wren-onboarding` (this skill) |

## On error

Don't carry an error playbook here — surface [`connect.md#troubleshooting`](https://github.com/Canner/wren-engine/blob/main/docs/get_started/connect.md) sections to the user. The doc covers:

- `wren: command not found`
- `pip install … externally-managed-environment`
- Missing secret (`MissingSecretError`)
- Driver authentication failures
- Pydantic `ValidationError` / unknown datasource
- Connection refused / firewall / cloud DB IP allow-list
- `wren context validate` warning categories

If you hit something not in the playbook, tell the user:

> "I hit an error I don't know how to fix: `<error>`.
> See <https://docs.getwren.ai/oss/engine> or open an issue at <https://github.com/Canner/wren-engine/issues>."
