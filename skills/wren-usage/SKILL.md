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
   To also enable semantic memory, interactive prompts, and web UI (recommended):
   ```bash
   pip install "wren-engine[<datasource>,main]"
   # or for DuckDB:
   pip install "wren-engine[main]"
   ```

5. Verify: `wren --version`

If `wren --version` succeeds, proceed to the relevant workflow below.

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

## Workflow 1: Answering a data question

### Step 1 — Gather context

| Situation | Command |
|-----------|---------|
| Default | `wren memory fetch -q "<question>"` |
| Need specific model's columns | `wren memory fetch -q "..." --model <name> --threshold 0` |
| Memory not installed | Read `target/mdl.json` in the project directory, or run `wren context show` |

If this is the first query in the conversation, also run:

```text
wren context instructions
```

If it returns content, treat it as **rules that override defaults** — apply them to all subsequent queries in this session.

### Step 2 — Recall past queries

```bash
wren memory recall -q "<question>" --limit 3
```

Use results as few-shot examples. Skip if empty.

### Step 2.5 — Assess complexity (before writing SQL)

If the question involves **any** of the following, consider decomposing:
- Multiple metrics or aggregations (e.g., "churn rate AND expansion revenue")
- Multi-step calculations (e.g., "month-over-month growth rate")
- Comparisons across segments (e.g., "by plan tier, by region")
- Time-series analysis requiring baseline + change (e.g., "retention curve")

**Decomposition strategy:**
1. Identify the sub-questions (e.g., "total subscribers at start" + "subscribers who cancelled" → churn rate)
2. For each sub-question:
   - `wren memory recall -q "<sub-question>"` — check if a similar pattern exists
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

### Step 4 — Store and continue

After successful execution, **store the query by default**:

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

---

## Workflow 2: Error recovery

### "table not found"

1. Verify model name: `wren memory fetch -q "<name>" --type model --threshold 0`
2. Check MDL exists: `ls target/mdl.json` (or `wren context show`)
3. Verify column: `wren memory fetch -q "<column>" --model <name> --threshold 0`

### Connection error

1. Check active profile: `wren profile debug`
2. Verify datasource and connection fields are correct
3. Test: `wren --sql "SELECT 1"`
4. Valid datasource values: `postgres`, `mysql`, `bigquery`, `snowflake`, `clickhouse`, `trino`, `mssql`, `databricks`, `redshift`, `spark`, `athena`, `oracle`, `duckdb`
5. If no profile exists, create one: `wren profile add --ui` (or `--interactive` / `--from-file`)

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

| Error pattern | Diagnosis | Fix |
|---------------|-----------|-----|
| `column 'X' not found in model 'Y'` | Wrong column name | `wren memory fetch -q "X" --model Y --threshold 0` to find correct name |
| `model 'X' not found` | Wrong model name | `wren memory fetch -q "X" --type model --threshold 0` |
| `ambiguous column 'X'` | Column exists in multiple models | Qualify with model name: `ModelName.column` |
| Planning error with JOIN | Relationship not defined in MDL | Check available relationships in context |

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

1. Add a profile: `wren profile add --ui` (or `--interactive` / `--from-file`)
2. Test connection: `wren profile debug`
3. Test query: `wren --sql "SELECT 1"`
4. Initialize project: `wren context init`
5. Build manifest: `wren context build`
6. Index: `wren memory index`
7. Verify: `wren --sql "SELECT * FROM <model> LIMIT 5"`

---

## Workflow 4: After MDL changes

When model YAML files are updated, rebuild and re-index:

```bash
# 1. Validate changes
wren context validate

# 2. Rebuild manifest
wren context build

# 3. Re-index schema memory
wren memory index

# 4. Verify
wren --sql "SELECT * FROM <changed_model> LIMIT 1"
```

---

## Command decision tree

```text
Get data back           → wren --sql "..."
Aggregation across dims → wren cube query --cube <name> --measures <m> (if cube defined)
See translated SQL only → wren dry-plan --sql "..." (accepts -d <datasource> if no active profile)
Validate against DB     → wren dry-run --sql "..."
Schema context          → wren memory fetch -q "..."
Filter by type/model    → wren memory fetch -q "..." --type T --model M --threshold 0
Store confirmed query   → wren memory store --nl "..." --sql "..."
Few-shot examples       → wren memory recall -q "..."
Index stats             → wren memory status
Re-index after MDL change → wren memory index
Show project context    → wren context show
Rebuild manifest        → wren context build
Check profile           → wren profile debug
Switch profile          → wren profile switch <name>
```

---

## Cube Query Workflow

When the user asks an aggregation question (e.g., "total revenue by month",
"top customers"), check if the MDL defines cubes before writing raw SQL.

### Step 1: Discover cubes

```bash
wren cube list
```

If cubes exist and cover the user's question, prefer cube query over raw SQL.
Lower error rate, especially for small / local models — agents don't have to
hand-write GROUP BY / DATE_TRUNC.

### Step 2: Inspect cube structure

```bash
wren cube describe <cube_name>
```

Shows the cube's baseObject, measures (with expressions), dimensions,
time dimensions, and hierarchies.

### Step 3: Match user's question to cube measures + dimensions

| User phrase | Maps to |
|---|---|
| "total revenue" | `--measures revenue` |
| "by month" | `--time-dimension "created_at:month"` |
| "in 2024" | `--time-dimension "created_at:month:2024-01-01,2025-01-01"` |
| "for completed orders" | `--filter "status:eq:completed"` |
| "top N customers" | `--dimensions customer --limit N` |

### Step 4: Execute via CLI flags OR JSON input

CLI flags:

```bash
wren cube query \
  --cube order_metrics \
  --measures revenue,order_count \
  --time-dimension "created_at:month:2024-01-01,2025-01-01" \
  --filter "status:eq:completed" \
  --limit 100
```

JSON input (good for agent-generated structured queries):

```bash
echo '{"cube":"order_metrics","measures":["revenue"]}' | wren cube query --from -
```

Add `--sql-only` to print the generated SQL without executing — useful for
verification before paying for execution on a remote warehouse.

### Step 5: Error recovery

| Error | Action |
|---|---|
| `Unknown measure 'X'` | `wren cube describe <cube>` for available measures |
| `Unknown dimension 'X'` | `wren cube describe <cube>` for available dimensions |
| `Cube 'X' not found` | `wren cube list` |
| `Circular dependency detected` | Derived measure references itself — inspect the cube YAML |

### When NOT to use cube query

Fall back to `wren --sql` when:

- Custom JOINs across multiple models
- Window functions, CTEs, or subqueries
- Queries with no aggregation
- No cubes defined in the MDL

---

## Aggregation decision tree

```text
User question → Is it an aggregation question?
                (SUM, COUNT, AVG, GROUP BY, "by month", "per customer", ...)
  ├── Yes → Are cubes defined? (`wren cube list` once at start of session)
  │         ├── Yes → Does a cube cover the question? (`wren cube describe`)
  │         │         ├── Yes → Use `wren cube query` (preferred — lower error rate)
  │         │         └── No  → Write raw SQL with `wren --sql`
  │         └── No  → Write raw SQL with `wren --sql`
  └── No  → Write raw SQL with `wren --sql` (look for memory recall first)
```

---

## Things to avoid

- Do not guess model or column names — check context first
- Do not store failed queries or queries the user said are wrong
- Do not skip storing successful queries with a clear NL question — default is to store
- Do not re-index before every query — once per MDL change
- Do not pass passwords via `--connection-info` if shell history is shared — use profiles (`wren profile add`) or `--connection-file`
