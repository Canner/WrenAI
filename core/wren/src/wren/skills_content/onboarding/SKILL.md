---
name: onboarding
description: "Onboard a user to Wren Engine end-to-end. Walks through environment checks, project scaffolding, connection configuration via .env, and first query. Use when: user wants to install Wren Engine, set up a new data source connection, or bootstrap a new project from scratch. Triggers: '/wren-onboarding', 'install wren', 'set up wren engine', 'wren onboarding', 'connect new database to wren'."
license: Apache-2.0
metadata:
  author: wrenai
---

# Wren Onboarding — Agent Workflow

This skill walks the agent through onboarding — environment checks, project scaffolding, profile creation, MDL generation, and first query. **Procedural details, per-datasource setup notes, and the troubleshooting playbook live in the docs**, not here. The skill's job is to enforce the agent-side rules (one step per turn, never ask for credentials in chat) and to dispatch the agent to the right doc / sibling skill at each step.

Reference docs (the skill points to these — never duplicate their content):
- [`docs/core/get_started/installation.md`](https://github.com/Canner/WrenAI/blob/main/docs/core/get_started/installation.md) — CLI install + skill install
- [`docs/core/guides/connect.md`](https://github.com/Canner/WrenAI/blob/main/docs/core/guides/connect.md) — full connection procedure, **per-datasource setup notes, complete troubleshooting playbook**
- [`docs/core/get_started/quickstart.md`](https://github.com/Canner/WrenAI/blob/main/docs/core/get_started/quickstart.md) — bundled `jaffle_shop` demo

## Mode of operation — READ THIS FIRST

**One step per round-trip.** Each numbered step below is its own turn: explain briefly, ask **only** what the step needs, run the command(s), confirm, move on.

- ❌ **Never collect information for future steps upfront.** Do not ask for project name + database type + credentials in one message.
- ❌ **Never ask for credentials in chat — not host, port, user, password, tokens, anything.** Credentials always go through `.env`. The user fills the file in their editor; the agent never sees the values.
- ❌ **Never query the database before MDL is built** via `wren skills get generate-mdl`.
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

- **demo** → point at [`quickstart.md`](https://github.com/Canner/WrenAI/blob/main/docs/core/get_started/quickstart.md) and stop this skill.
- **own DB** → continue.

## Step 1 — Collect project name + database type

These two are the only thing Step 2 needs; ask both together so the user has a clean handoff:

> "Two things before I scaffold:
> 1. **Project name** — I'll create `~/<name>/` and `cd` into it.
> 2. **Database type** — run `wren docs connection-info` (no argument) to see the full list, or pick a common one: `postgres` (use for Aurora PostgreSQL), `mysql` (use for Aurora MySQL), `bigquery`, `snowflake`, `clickhouse`, `trino`, `duckdb`, …"

Wait for both. Don't ask for credentials.

## Step 2 — Workspace + .env setup (batch)

Side effects: creates `~/<project>/`, installs `wrenai[<ds>,main]`, generates an empty `.env` template. The project files (`wren_project.yml` etc.) come next in Step 3 — at this point we only have a directory with credentials waiting to be filled.

Run as a batch — report each command briefly, then end with one "please fill `.env`" ask:

1. `mkdir -p ~/<project> && cd ~/<project>`.
2. `pip install "wrenai[<ds>,main]"`. For datasource-specific install gotchas (macOS mysql, etc.), see [`connect.md#per-datasource-setup-notes`](https://github.com/Canner/WrenAI/blob/main/docs/core/guides/connect.md).
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

   Special encodings (BigQuery base64, Snowflake account format, Athena AWS creds, etc.) are documented in [`connect.md#per-datasource-setup-notes`](https://github.com/Canner/WrenAI/blob/main/docs/core/guides/connect.md). Surface the relevant section to the user verbatim — don't paraphrase.

4. Add `.env` to `.gitignore` if the project is a git repo. Suggest `chmod 600 .env`.
5. Tell the user: `.env` is at `<path>`, please fill every value and reply **"done"**.

## Step 3 — Scaffold the project

```bash
wren context init --empty
```

Refuses to overwrite an existing `wren_project.yml`. Creates the project directory layout (`models/`, `views/`, `relationships.yml`, `knowledge/` (rules + sql), `AGENTS.md`). No connection profile needs to exist yet — this step only writes placeholder project files (`data_source:` is left as a to-be-changed placeholder for now; Step 3.5 fixes it).

Run this **before** creating the connection profile (Step 3.5), not after — it's what lets Step 3.5 bind the profile to this project the moment it's created, instead of needing a separate binding step later.

## Step 3.5 — Create the connection profile (binds automatically)

Only after the user replies "done" in Step 2.

From inside `~/<project>` (the directory scaffolded in Step 3), write a scratch file named `conn.profile.yml` with **every field as a `${VAR}` placeholder** matching the `.env` keys you generated in Step 2 — a placeholder token only, **never** a value read out of `.env` or typed from memory. You must not open, cat, or otherwise read `.env` to produce this file; you only need the field *names*, which you already have from Step 2's `wren docs connection-info <ds>` output. Use exactly this name, not `conn.yml` — a same-named file is reserved for hand-authored fixtures elsewhere in the toolchain, and this scratch file must never be mistaken for one:

```yaml
datasource: <ds>
host: ${<DS>_HOST}
port: ${<DS>_PORT}
# … one line per field from `wren docs connection-info <ds>`
```

Then, still from inside `~/<project>`:

```bash
wren profile add <project> --from-file conn.profile.yml --activate
```

(`conn.profile.yml` is a project-relative path — deliberately not `/tmp` or any other absolute location outside the project directory.)

Because Step 3 already scaffolded `~/<project>` and it has no `profile:` pin yet, this command **pins itself into the project automatically** — look for a line starting `⚠ Pinned profile '<project>' to the project at …` in its output. That line, not `--activate`, is what makes this project resolve `<project>`'s connection deterministically going forward, independent of whatever else later becomes the globally active profile. `--activate` still matters (it's what makes validation and Step 4 work in *this* turn), but it no longer needs to survive as the project's connection of record — the pin does that.

- ✓ **Success + the `⚠ Pinned profile …` line present** → delete the scratch file (`rm conn.profile.yml`) — it only ever held `${VAR}` placeholders, and those are now captured in `~/.wren/profiles.yml`, so nothing is lost — then continue to Step 4.
- ✓ **Success but no `⚠ Pinned profile …` line** → the project already had a different profile pinned (this command never overwrites an existing pin) — but it can also mean the command wasn't actually run from inside `~/<project>`, or the project's declared datasource doesn't match this profile's (a real mismatch is left unpinned rather than silently repinned). Run `wren context show` and confirm the pinned profile is the one you intend; if not, use `wren context set-profile <project>` to repin explicitly before continuing. Delete `conn.profile.yml` once the pin situation is resolved.
- ⚠ **Any warning** → consult [`connect.md#troubleshooting`](https://github.com/Canner/WrenAI/blob/main/docs/core/guides/connect.md) for the exact symptom (missing secret, driver auth failure, ValidationError, unreachable host, …) and tell the user what to fix. Leave `conn.profile.yml` in place until a retry succeeds, then delete it.

## Step 4 — Generate MDL (hand off)

> ⚠️ The agent **must** build MDL before any data query. Queries against tables not in MDL will fail.

Run `wren skills get generate-mdl` and follow it. It walks the agent through table introspection, type normalization, and YAML generation. When it finishes, return here and run:

```bash
wren context validate
wren context build
```

Report the model count and any validate warnings.

**Memory recommendation**: count models with `wren context show | grep -c '^model:'`. If `>= 200`, suggest `pip install "wrenai[memory]"` + `wren memory index` (~800 MB). If `< 200`, skip.

## Step 5 — Ready to explore (hand off)

Suggest 2–3 NL questions based on the discovered tables (e.g. for an orders schema: "How many orders last month?", "Top 5 customers by total"). Then end this skill: for day-to-day querying the agent should run `wren skills get usage`.

## Cross-skill routing

| Trigger | Skill |
|---------|-------|
| User mentions a SaaS source (HubSpot, Stripe, Salesforce, GitHub, Slack, …) | `wren skills get dlt-connector` |
| User has a connected DB but no MDL yet | `wren skills get generate-mdl` |
| User has MDL ready, wants to query | `wren skills get usage` |
| Anything else from-scratch | `wren skills get onboarding` (this skill) |

## On error

Don't carry an error playbook here — surface [`connect.md#troubleshooting`](https://github.com/Canner/WrenAI/blob/main/docs/core/guides/connect.md) sections to the user. The doc covers:

- `wren: command not found`
- `pip install … externally-managed-environment`
- Missing secret (`MissingSecretError`)
- Driver authentication failures
- Pydantic `ValidationError` / unknown datasource
- Connection refused / firewall / cloud DB IP allow-list
- `wren context validate` warning categories

If you hit something not in the playbook, tell the user:

> "I hit an error I don't know how to fix: `<error>`.
> See <https://docs.getwren.ai/oss/introduction> or open an issue at <https://github.com/Canner/WrenAI/issues>."
