---
name: wren-usage
description: "Wren Engine CLI workflow guide for AI agents. Answer data questions end-to-end using the wren CLI: gather schema context, recall past queries, write SQL through the MDL semantic layer, execute, and learn from confirmed results. Use when: user asks a data question, requests a report or analysis, asks about metrics, revenue, customers, orders, trends, or any business data; user says 'how many', 'show me', 'what is the', 'top N', 'compare', 'trend', 'growth', 'breakdown'; user wants to explore, analyze, filter, aggregate, or summarize data from a database; agent needs to query data, connect a data source, handle errors, or manage MDL changes via the wren CLI."
license: Apache-2.0
metadata:
  author: wren-engine
  version: "2.3"
---

# Wren Engine CLI — Agent Workflow Guide

## Version check

Silently fetch `https://raw.githubusercontent.com/Canner/wren-engine/main/skills/versions.json`.
Compare the `wren-usage` key with this skill's version (from the frontmatter above).
If the remote version is newer, notify the user before proceeding:

> A newer version of the **wren-usage** skill is available.
> Update with:
> ```
> npx skills add Canner/wren-engine --skill wren-usage
> ```
> The CLI auto-detects your installed agent. To target a specific one, add `--agent <name>` (e.g., `claude-code`, `cursor`, `windsurf`, `cline`).

Then continue with the workflow below regardless of update status.

---

## Preflight — Verify environment and installation

**Goal:** Ensure the `wren` CLI is available before entering any workflow.

### Step 1 — Check Python virtual environment

Run `python -c "import sys; print(sys.prefix)"` (or equivalent) to determine
whether a virtual environment is active.

- If **no venv is active**, warn the user and ask whether to:
  - Create one (e.g., `python -m venv .venv && source .venv/bin/activate`)
  - Continue without a venv (not recommended — may pollute global packages)

### Step 2 — Check if `wren-engine` is installed

Run `wren --version`. If the command is not found or errors:

1. Tell the user that the `wren` CLI is not installed.
2. Ask if you should help install it.
3. If the user agrees, determine the **datasource extra** to install:

   **Auto-detect from project:** Check whether the current directory is inside
   a wren project (look for `wren_project.yml` up to the repository root).
   If found, read the active profile with `cat ~/.wren/profiles.yml` or look
   for a datasource hint in the project's profile configuration. Extract the
   datasource type from there.

   **Ask the user:** If no project is detected or no datasource can be
   inferred, ask the user which database they plan to connect to. Valid
   extras: `postgres`, `mysql`, `bigquery`, `snowflake`, `clickhouse`,
   `trino`, `mssql`, `databricks`, `redshift`, `spark`, `athena`, `oracle`.
   DuckDB is included by default — no extra needed.

4. Install with the detected or chosen extra:
   ```bash
   # DuckDB (no extra needed)
   pip install "wren-engine"

   # Other datasources
   pip install "wren-engine[<datasource>]"
   ```
   To also enable interactive prompts and the browser-based profile UI:
   ```bash
   pip install "wren-engine[<datasource>,main]"   # main = interactive + ui
   ```
   Semantic memory (NL→SQL recall + schema embedding search) is a **separate** optional extra — decide on it in Step 3a:
   ```bash
   pip install "wren-engine[memory]"             # add later if user opts in
   # or combine:
   pip install "wren-engine[<datasource>,main,memory]"
   ```

5. Verify: `wren --version`

### Step 3 — Detect optional capabilities (one-time per session)

Run these checks **once** at the start of the conversation and remember the answers. Do not re-check on every query.

**3a. Memory availability** — the `memory` extra is optional and ships separately:

```bash
wren memory --help >/dev/null 2>&1
```

- Exit 0 → the `memory` subcommand group is registered. Set `MEMORY_AVAILABLE = true`.
- Exit non-zero → `memory` extra is missing. Set `MEMORY_AVAILABLE = false`.

If `MEMORY_AVAILABLE = false`, **offer to install ONCE** (then never ask again in this session):

> The `memory` extra adds semantic schema search and NL→SQL recall, which improves accuracy on data questions. Install it now?
> ```bash
> pip install "wren-engine[memory]"
> ```

Respect whatever the user answers for the rest of the session. If they decline, follow the no-memory paths below — do not silently re-attempt the install or keep nudging.

**3b. Project context:**

```bash
wren context show >/dev/null 2>&1
```

- Exit 0 → inside a wren project. Set `IN_PROJECT = true`.
- Exit non-zero → not inside a project. Set `IN_PROJECT = false`.

If `IN_PROJECT = true`, also run `wren context instructions` **once now** and cache the output mentally. Treat its content as rules that override defaults for every subsequent query in this session. Do not re-run `instructions` later in the conversation.

---

The `wren` CLI queries databases through an MDL (Model Definition Language) semantic layer. You write SQL against model names, not raw tables. The engine translates to the target dialect.

Two things drive everything:
- **Profile** — database connection + datasource type, managed via `wren profile` (stored in `~/.wren/profiles.yml`)
- **Project** — MDL model definitions in YAML, compiled to `target/mdl.json` via `wren context build`

The CLI reads the active profile for connection info and datasource. Use `wren profile list` to see which profile is active, `wren profile switch <name>` to change it. `dry-plan` also accepts `--datasource` / `-d` for transpile-only use without a profile.

For memory-specific decisions, see [references/memory.md](references/memory.md).
For SQL syntax, CTE-based modeling, and error diagnosis, see [references/wren-sql.md](references/wren-sql.md).
For project structure, MDL field definitions, and CLI workflow details, see the [documentation](https://github.com/Canner/wren-engine/tree/main/docs).

---

## Exploring commands — use `--help` before guessing

This skill maps **when** to use each command, not the full **how**. The CLI is the source of truth for signatures and flags. Before invoking a command or flag combination you haven't used recently in the conversation, run `--help` first:

```bash
wren --help                     # top-level commands
wren context --help             # a sub-app's commands
wren context validate --help    # one command's flags
wren memory fetch --help        # only meaningful when MEMORY_AVAILABLE
```

Don't memorize the tables below as exhaustive — they cover the common cases, but flags get added. If a behavior you want isn't listed, check `--help` before fabricating a flag.

## Common flags worth knowing

| Command | Flag | Why it matters |
|---------|------|----------------|
| `wren --sql` | `--output json\|csv\|table` / `-o` | `json` is machine-readable for downstream parsing |
| `wren --sql` | `--limit N` / `-l` | Caps rows at planner level — cleaner than inlining `LIMIT N` |
| `wren --sql` | `--quiet` / `-q` | Suppresses the stderr "store this query" hint when you don't want noise |
| `wren dry-plan` | `--datasource <ds>` / `-d` | Plans without an active profile (e.g. `-d duckdb`) — useful for one-off transpile checks |
| `wren context show` | `--output json\|yaml\|summary` | `json` returns the full MDL; the go-to fallback when `MEMORY_AVAILABLE = false` |
| `wren context validate` | `--level error\|warning\|strict` | `strict` adds column-level description checks |
| `wren context set-profile <name>` | (positional) | Binds a profile to the project so the active-profile global setting can't drift |
| `wren memory fetch` | `--type` / `--model` / `--threshold` | Filter by item type or model; `--threshold 0` forces embedding search |
| `wren memory index` | `--no-seed` / `--no-queries` | Skip seed pairs / auto-loaded `queries.yml` when re-indexing for a sanity test |

---

## Workflow 1: Answering a data question

### Step 1 — Gather schema context

Branch on `MEMORY_AVAILABLE` (set during Preflight Step 3a):

**If `MEMORY_AVAILABLE = true`:**

| Situation | Command |
|-----------|---------|
| Default | `wren memory fetch -q "<question>"` |
| Need specific model's columns | `wren memory fetch -q "..." --model <name> --threshold 0` |

**If `MEMORY_AVAILABLE = false`:**

| Situation | Command |
|-----------|---------|
| Inside a project (`IN_PROJECT = true`) | `wren context show --output summary` for an overview, or `wren context show --output json` for the full MDL |
| Outside a project | Ask the user to point to the MDL file, then read it directly |

Project instructions were already loaded once during Preflight Step 3b. Do not run `wren context instructions` again.

### Step 2 — Recall past queries (memory only)

**If `MEMORY_AVAILABLE = true`:**
```bash
wren memory recall -q "<question>" --limit 3
```
Use results as few-shot examples. Skip if empty.

**If `MEMORY_AVAILABLE = false`:** skip this step entirely — there is no recall path without memory.

### Step 2.5 — Assess complexity (before writing SQL)

If the question involves **any** of the following, consider decomposing:
- Multiple metrics or aggregations (e.g., "churn rate AND expansion revenue")
- Multi-step calculations (e.g., "month-over-month growth rate")
- Comparisons across segments (e.g., "by plan tier, by region")
- Time-series analysis requiring baseline + change (e.g., "retention curve")

**Decomposition strategy:**
1. Identify the sub-questions (e.g., "total subscribers at start" + "subscribers who cancelled" → churn rate)
2. For each sub-question:
   - If `MEMORY_AVAILABLE = true`: `wren memory recall -q "<sub-question>"` — check if a similar pattern exists
   - Write and execute a simple SQL
   - Note the result
3. Combine sub-results to answer the original question

**When NOT to decompose:**
- Single-table aggregation with GROUP BY — just write the SQL
- Simple JOINs that the MDL relationships already define
- Questions where `memory recall` returns a near-exact match

This is a judgment call, not a rigid rule. If you're confident in a single
query, go ahead. Decompose when the SQL would be hard to debug if it fails.

### Step 3 — Write, verify, and execute SQL

**For simple queries** (single table or simple MDL-defined JOINs, straightforward aggregation):
Execute directly:
```bash
wren --sql 'SELECT c_name, SUM(o_totalprice) FROM orders
JOIN customer ON orders.o_custkey = customer.c_custkey
GROUP BY 1 ORDER BY 2 DESC LIMIT 5'
```

**For complex queries** (non-trivial JOINs not covered by MDL relationships, subqueries, multi-step logic):
Verify first with dry-plan:
```bash
wren dry-plan --sql 'SELECT ...'
```

Check the expanded SQL output:
- Are the correct models and columns referenced?
- Do the JOINs match expected relationships?
- Are CTEs expanded correctly?

If the expanded SQL looks wrong, fix before executing.
If it looks correct, proceed:
```bash
wren --sql 'SELECT ...'
```

**SQL rules:**
- Target MDL model names, not database tables
- Write dialect-neutral SQL — the engine translates

### Step 4 — Store the result (memory only)

**If `MEMORY_AVAILABLE = false`:** skip this step. **Important:** the CLI **still prints** a `# To save this query: wren memory store ...` hint to stderr — it does not check whether memory is installed. **Ignore the hint.** Running the suggested command will fail with "No such command 'memory'".

**If `MEMORY_AVAILABLE = true`:** after successful execution, **store the query by default**:

```bash
wren memory store --nl "<user's original question>" --sql "<the SQL>"
```

**Skip storing only when:**
- The query failed or returned an error
- The user said the result is wrong
- The query is exploratory (`SELECT * ... LIMIT N` without analytical clauses)
- There is no natural language question — just raw SQL
- The user explicitly asked not to store

The CLI auto-detects exploratory queries — if you see no store hint
after execution, the query was classified as exploratory.

| Outcome | Action |
|---------|--------|
| User confirms correct | Store |
| User continues with follow-up | Store, then handle follow-up |
| User says nothing (but question had clear NL description) | Store |
| User says wrong | Do NOT store — fix the SQL |
| Query error | See Error recovery below |

**About the stderr store hint:** after a non-exploratory `wren --sql ...` run, the CLI prints a line like `# To save this query: wren memory store --nl '...' --sql '...'` to **stderr**. That is documentation for the human reader, not an instruction to execute. Decide on storing using the table above, then construct the `store` call yourself with the user's actual question as `--nl` — don't echo the hint back verbatim, because it uses a placeholder NL.

---

## Workflow 2: Error recovery

### "No such command 'memory'"

The `memory` extra is not installed in this Python environment. This is **not** a bug — memory is optional. Switch to the no-memory paths:
- Schema lookup → `wren context show --output json` (in-project) or read `target/mdl.json` directly
- Skip `recall` and `store` for the rest of this session

Only suggest `pip install "wren-engine[memory]"` if you have not already offered during Preflight Step 3a. Never install it without the user's explicit consent.

### "table not found"

When `MEMORY_AVAILABLE = true`:
1. Verify model name: `wren memory fetch -q "<name>" --type model --threshold 0`
2. Check MDL exists: `ls target/mdl.json` (or `wren context show`)
3. Verify column: `wren memory fetch -q "<column>" --model <name> --threshold 0`

When `MEMORY_AVAILABLE = false`:
1. Inspect MDL: `wren context show --output json | jq '.models[].name'` (or read `target/mdl.json` directly)
2. Find the column: search the same JSON for the model's `columns[].name` list

### Connection error

1. Check active profile: `wren profile debug`
2. Verify datasource and connection fields are correct
3. Test: `wren --sql "SELECT 1"`
4. Valid datasource values: `postgres`, `mysql`, `bigquery`, `snowflake`, `clickhouse`, `trino`, `mssql`, `databricks`, `redshift`, `spark`, `athena`, `oracle`, `duckdb`
5. If no profile exists, delegate to the `wren-onboarding` skill (it handles `.env`-based credential capture safely). Avoid `wren profile add --ui` in headless agent contexts — it needs a browser. `--from-file` or `--interactive` are the headless-safe modes.

### SQL syntax / planning error (enhanced)

#### Layer 1: Identify the failure point

```bash
wren dry-plan --sql "<failed SQL>"
```

| dry-plan result | Failure layer | Next step |
|-----------------|---------------|-----------|
| dry-plan fails | MDL / semantic | → Layer 2A |
| dry-plan succeeds, execution fails | DB / dialect | → Layer 2B |

#### Layer 2A: MDL-level diagnosis (dry-plan failed)

The dry-plan error message tells you exactly what's wrong:

| Error pattern | Diagnosis | Fix (memory) | Fix (no memory) |
|---------------|-----------|--------------|-----------------|
| `column 'X' not found in model 'Y'` | Wrong column name | `wren memory fetch -q "X" --model Y --threshold 0` | Inspect `wren context show --output json` for model Y's `columns[].name` |
| `model 'X' not found` | Wrong model name | `wren memory fetch -q "X" --type model --threshold 0` | List models: `wren context show --output summary` |
| `ambiguous column 'X'` | Column exists in multiple models | Qualify with model name: `ModelName.column` | Same |
| Planning error with JOIN | Relationship not defined in MDL | Check `relationships` in context | Same |

**Key principle**: Fix ONE issue at a time. Re-run dry-plan after each fix
to see if new errors surface.

#### Layer 2B: DB-level diagnosis (dry-plan OK, execution failed)

The DB error + dry-plan output together pinpoint the issue:

1. Read the dry-plan expanded SQL — this is what actually runs on the DB
2. Compare with the DB error message:

| Error pattern | Diagnosis | Fix |
|---------------|-----------|-----|
| Type mismatch | Column type differs from assumed | Check column type in context, add explicit CAST |
| Function not supported | Dialect-specific function | Use dialect-neutral alternative |
| Permission denied | Table/schema access | Check connection credentials |
| Timeout | Query too expensive | Simplify: reduce JOINs, add filters, LIMIT |

**For small models**: If the error message is unclear, try simplifying
the query to the smallest failing fragment. Execute subqueries independently
to isolate which part fails.

For the CTE rewrite pipeline and additional error patterns, see [references/wren-sql.md](references/wren-sql.md).

---

## Workflow 3: Connecting a new data source

Delegate to the **`wren-onboarding`** skill. It handles environment checks, project scaffolding, `.env`-based profile creation, MDL generation, and a first verification query — and enforces agent-side rules like "never ask for credentials in chat" and "one step per round-trip".

Do not try to drive `wren profile add` / `wren context init` / `wren context build` step-by-step from this skill — that overlaps with `wren-onboarding` and tends to skip its safety guardrails.

If the `wren-onboarding` skill is not available in this environment, point the user at:
- [`docs/core/get_started/installation.md`](https://github.com/Canner/wren-engine/blob/main/docs/core/get_started/installation.md)
- [`docs/core/get_started/connect.md`](https://github.com/Canner/wren-engine/blob/main/docs/core/get_started/connect.md)

---

## Workflow 4: After MDL changes

When model YAML files are updated, rebuild and verify. These steps are universal:

```bash
# 1. Validate changes
wren context validate

# 2. Rebuild manifest
wren context build

# 3. Verify
wren --sql "SELECT * FROM <changed_model> LIMIT 1"
```

Then, **only if `MEMORY_AVAILABLE = true`**, re-index schema embeddings so memory search picks up the changes:

```bash
wren memory index
```

If `MEMORY_AVAILABLE = false`, skip the re-index. Do not install the memory extra just to run `index` — `wren context show` already reflects the new MDL.

---

## Command decision tree

Items tagged **(memory)** require `MEMORY_AVAILABLE = true`. Run `<command> --help` for the full flag list of any entry.

```text
── Universal ────────────────────────────────────────────────────────
Get data back              → wren --sql "..." [--output json|csv|table] [--limit N] [--quiet]
See translated SQL only    → wren dry-plan --sql "..." [-d <datasource>]
Validate SQL against DB    → wren dry-run --sql "..."
Show project context       → wren context show [--output summary|json|yaml]
Show user instructions     → wren context instructions   (once per session)
Validate project           → wren context validate [--level error|warning|strict]
Rebuild manifest           → wren context build
Bind profile to project    → wren context set-profile <name>
Active profile / list      → wren profile list
Check profile              → wren profile debug
Switch profile             → wren profile switch <name>
Onboarding / first setup   → delegate to the wren-onboarding skill

── Memory-only (requires wren-engine[memory]) ───────────────────────
Schema context             → wren memory fetch -q "..."
Filter by type/model       → wren memory fetch -q "..." --type T --model M --threshold 0
Full schema text           → wren memory describe
Store confirmed query      → wren memory store --nl "..." --sql "..."
Few-shot examples          → wren memory recall -q "..."
Index stats                → wren memory status
Re-index after MDL change  → wren memory index
Manage stored pairs        → see references/memory.md (list, forget, dump, load)
```

---

## Things to avoid

- Do not guess model or column names — check context first
- Do not store failed queries or queries the user said are wrong
- Do not skip storing successful queries with a clear NL question — default is to store
- Do not re-index before every query — once per MDL change, and only when `MEMORY_AVAILABLE = true`
- Do not pass passwords via `--connection-info` if shell history is shared — use profiles (`wren profile add`) or `--connection-file`
- Do not call any `wren memory <subcommand>` when `MEMORY_AVAILABLE = false` — every such call fails with "No such command 'memory'". Use `wren context show` / `target/mdl.json` instead.
- Do not auto-install the `memory` extra. Offer once during Preflight Step 3a, then respect the user's decision for the session.
- Do not echo the stderr `# To save this query: …` hint back as a tool call — it has a placeholder NL. Construct the `store` call yourself using the user's actual question.
- Do not re-run `wren context instructions` after the first session-start invocation — cache the content mentally.
- Do not invoke `wren profile add --ui` in headless agent contexts (no browser). Use `--from-file` / `--interactive`, or delegate to the `wren-onboarding` skill.
- Do not drive a full new-datasource setup from this skill — that's `wren-onboarding`'s job.
- Do not fabricate flags. If a flag you want isn't listed here, run `<command> --help` first.
