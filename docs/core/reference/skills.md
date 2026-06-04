# Skills

Wren AI ships **skills** — reusable AI agent workflow guides that teach
Claude Code (or other AI coding agents) how to use the Wren CLI for
multi-step tasks. A skill is a structured markdown guide with a decision
tree, agent-side rules, and references to deeper documentation.

## The new delivery model

Earlier versions of Wren shipped each skill as a separate folder of
markdown installed into the agent's skill directory (`~/.claude/skills/`,
Cursor `rules/`, etc.). That model had two recurring problems: the bundled
markdown drifted from the installed CLI version, and the agent loaded all
the content up-front whether it was needed or not.

Since Wren `0.8`, skill content **lives inside the `wren` CLI** and is
served on demand:

- One ~50-line **discovery stub** is installed into your agent
  (`skills/wren/SKILL.md`). It teaches the agent that workflow guides and
  shaped prompts are fetched from the CLI.
- The actual workflow guides live in the `wrenai` Python package and are
  printed to stdout by `wren skills get <name>`.
- Prompt templates are served the same way: `wren ask "<q>" --guided|--direct`.
  Reference docs live on the web under
  [`docs/core/`](https://github.com/Canner/WrenAI/tree/main/docs/core).

Because the content travels with the wheel, the version the agent reads
always matches the installed CLI.

## Available skills

| Skill | Fetch with | Purpose |
|-------|-----------|---------|
| **onboarding** | `wren skills get onboarding` | Entry point: environment checks, project scaffolding, profile setup, first query |
| **usage** | `wren skills get usage` | Day-to-day workflow: gather schema context, recall past queries, write SQL, execute, store results |
| **generate-mdl** | `wren skills get generate-mdl` | One-time setup: explore database schema, normalize types, scaffold MDL YAML project |
| **enrich-context** | `wren skills get enrich-context` | Deepen business context the schema can't carry: enum/unit/null semantics, default filters, synonyms, currency rules, and named aggregation metrics as cubes — via grill or auto-pilot mode |
| **dlt-connector** | `wren skills get dlt-connector` | Connect SaaS APIs (HubSpot, Stripe, Salesforce, GitHub, Slack, …) into DuckDB via dlt, then auto-generate a Wren project |

List them with `wren skills list`.

## Installation

```bash
pip install wrenai                       # core CLI (DuckDB included)
npx skills add Canner/WrenAI             # one-line discovery stub for your agent
```

The installer auto-detects Claude Code, Cursor, Cline, Codex, and similar
clients. After installing, start a new agent session — the stub is loaded
at session start; from then on it pulls workflow guides on demand.

## How content is delivered

The agent fetches guides using `wren skills get <name>`. The first call
returns the SKILL.md body — a focused workflow guide. When the agent
needs more depth it can ask for:

```bash
wren skills get <name> --full             # include the skill's references/ inline
wren skills get <name> --script <stem>    # print a bundled script's source
```

Shaped prompts are served the same way:

```bash
wren ask "<question>" --guided            # for weaker LLMs
wren ask "<question>" --direct            # for stronger LLMs
```

Reference docs live on the web under
[`docs/core/`](https://github.com/Canner/WrenAI/tree/main/docs/core).

A bundled CI guard (`tests/unit/test_served_content_guard.py`) scans every
`wren <cmd>` invocation in served skill content, reference docs, and ask
templates against the real CLI command tree — so a guide can't tell an
agent to run a command or flag that doesn't exist.

---

## onboarding

The entry-point skill. It walks the agent through the full setup flow —
environment checks, project scaffolding, connection configuration, MDL
generation, and a first query — by routing to docs and other skills at
each step. The skill itself stays focused on agent-side rules (one step
per turn, never ask for credentials in chat).

### Workflow

```text
User says "install wren" / "set up wren"
  │
  ├── Preflight (read-only)
  │     Python 3.11+, virtualenv, wren CLI, working dir
  │
  ├── Branch: bundled demo or own database?
  │     demo → quickstart guide, stop
  │     own DB → continue
  │
  ├── Step 1. Project name + database type
  │     (asked together, no credentials yet)
  │
  ├── Step 2. Project setup (batch)
  │     mkdir, pip install, wren context init,
  │     generate .env template via connector introspection
  │
  ├── Step 3. User fills .env in editor
  │     (agent never sees credential values)
  │
  ├── Step 4. Validate connection
  │     wren profile debug
  │
  ├── Step 5. Generate MDL
  │     wren skills get generate-mdl
  │
  └── Step 6. First query
        wren --sql "SELECT 1" (sanity)
        then real query against generated MDL
```

### Agent-side rules enforced

| Rule | Why |
|------|-----|
| **One step per round-trip** | Avoids overwhelming the user; keeps each turn focused |
| **Never ask for credentials in chat** | Host, port, user, password, tokens all go through `.env` only |
| **Never invent connection field names** | Always run `wren docs connection-info <ds>` to introspect real fields |
| **Never query the database before MDL is built** | Forces the agent to scaffold a semantic layer first |

### When to trigger

The discovery stub routes the agent here on phrases like:

- "install wren"
- "set up wren engine"
- "connect a new database"
- "I want to start a Wren project"

### Reference docs (the skill points to these, never duplicates)

- [`docs/core/get_started/installation.md`](https://github.com/Canner/WrenAI/blob/main/docs/core/get_started/installation.md)
- [`docs/core/guides/connect.md`](https://github.com/Canner/WrenAI/blob/main/docs/core/guides/connect.md)
- [`docs/core/get_started/quickstart.md`](https://github.com/Canner/WrenAI/blob/main/docs/core/get_started/quickstart.md)

---

## usage

The primary skill for day-to-day querying. It guides the agent through a
complete query lifecycle.

### Query workflow

```text
User asks a question
  │
  ├── 1. Gather context
  │     wren memory fetch -q "..."
  │     wren context instructions      (first query only)
  │
  ├── 2. Recall past queries
  │     wren memory recall -q "..." --limit 3
  │
  ├── 3. Assess complexity
  │     Simple → write SQL directly
  │     Complex → decompose into sub-questions
  │
  ├── 4. Write and execute SQL
  │     Simple: wren --sql "..."
  │     Complex: wren dry-plan first, then execute
  │
  └── 5. Store result
        wren memory store --nl "..." --sql "..."
```

### Error recovery

The skill includes a two-layer error diagnosis strategy:

| Layer | Tool | Diagnoses |
|-------|------|-----------|
| **MDL-level** | `wren dry-plan` fails | Wrong model/column names, missing relationships |
| **DB-level** | `wren dry-plan` succeeds but execution fails | Type mismatch, permissions, dialect issues |

The agent checks `dry-plan` output first to isolate whether the error is
in the semantic layer or the database.

### Additional workflows

| Workflow | When |
|----------|------|
| **Connect new data source** | `wren profile add` → `wren context init` → build → index |
| **After MDL changes** | `wren context validate` → `wren context build` → `wren memory index` |

### Reference files

`wren skills get usage --full` inlines two reference documents:

- **memory.md** — decision logic for when to `index`, `fetch`, `store`,
  and `recall`. Covers the hybrid retrieval strategy, store-by-default
  policy, and full lifecycle examples.
- **wren-sql.md** — how the CTE-based rewrite pipeline works. Explains
  how the engine injects model CTEs, what SQL features are supported,
  and how to use `dry-plan` to diagnose errors layer by layer.

---

## enrich-context

The "enrich deep" companion to `usage`. A schema-generated MDL only
carries what the database can describe about itself — column names and
types. The business meaning (what `status = 'A'` means, whether `amount`
is in cents, which table is canonical, how the team defines ARR) lives in
handbooks, glossaries, and analyst SQL. This skill brings that meaning
into the project's reviewable context.

### Two modes (chosen at session start)

| Mode | Behavior | Best for |
|------|----------|----------|
| **Grill** | Walks each gap one question at a time, proposes a concrete draft, waits for accept / edit / skip. May sample low-cardinality columns from the live DB (with your OK) to discover enum and sentinel values. | Sensitive data, or when you want to review every change |
| **Auto-pilot** | Reads `raw/` + current context, applies its best inferences directly, escalates to grill only on raw-vs-MDL conflicts and high-blast-radius additions (new cubes / views / relationships). Hands you a confidence-tagged audit at the end. | Bulk backfill from a large doc set |

Both modes only **add** — they never modify an existing field.
Contradictions are surfaced on a "please fix manually" list.

### What it fills

The skill works from a ten-category gap catalog covering the business
semantics a schema can't express:

| Sink | Categories |
|------|-----------|
| Column `properties.description` (prose + `[tag]` line) | enum value meanings, units (USD vs cents), NULL semantics, magic sentinels, time-grain / TZ conventions |
| `instructions.md` (fixed `##` sections) | soft-delete default filters, business synonyms, cross-system identifiers, currency rules, canonical-table preferences |
| `cubes/<name>/metadata.yml` | named aggregation metrics (ARR, churn, DAU) — proposed as cubes, the preferred aggregation primitive |
| `queries.yml` / `wren memory store` | canonical and ad-hoc NL→SQL pairs |

### When to trigger

The discovery stub routes the agent here on phrases like:

- "enrich context" / "augment my project" / "grill me on this project"
- "the agent doesn't understand our docs / enum values / units"
- "what does `status = A` mean" / "is this amount in USD or cents"
- "we keep getting wrong aggregations" / "add cubes for ARR / DAU / churn"
- "we have a handbook / glossary / data dictionary the agent should know"

### Reference files

`wren skills get enrich-context --full` inlines:

- **gap_catalog.md** — the ten gap categories with triggers, default
  sinks, and the prose-first `[tag]` write format.
- **cube_proposals.md** — the decision tree for proposing a cube vs view
  vs calculated column, the cube YAML template, naming policy,
  duplication guard, and validation flow.

---

## generate-mdl

A one-time setup skill that walks the agent through creating an MDL
project from a live database.

### Seven-phase workflow

| Phase | Goal | Key actions |
|-------|------|-------------|
| **1. Connect** | Confirm database access | Test connection via SQLAlchemy, driver, or `wren profile debug` |
| **2. Discover** | Collect schema metadata | Introspect tables, columns, types, foreign keys |
| **3. Normalize** | Convert types | `wren utils parse-type` or Python `parse_type()` |
| **4. Scaffold** | Write YAML project | `wren context init`, create model files, relationships |
| **5. Validate** | Check integrity | `wren context validate` → `wren context build` |
| **6. Index** | Initialize memory | `wren memory index` |
| **7. Iterate** | Refine with user | Add descriptions, calculated columns, views |

### Schema discovery methods

The skill is tool-agnostic — it uses whatever database access the agent has:

| Method | Best for |
|--------|----------|
| **SQLAlchemy** `inspect()` | Most databases — richest metadata (PKs, FKs, types) |
| **Database driver** | When SQLAlchemy is unavailable — query `information_schema` directly |
| **Raw SQL via wren** | Bootstrapping when no Python driver is installed |

### Type normalization

Raw database types must be normalized before use in MDL:

```bash
# Single type
wren utils parse-type --type "character varying(255)" --dialect postgres
# → VARCHAR(255)

# Batch (stdin JSON)
echo '[{"column":"id","raw_type":"int8"}]' | wren utils parse-types --dialect postgres
```

Or via Python:

```python
from wren.type_mapping import parse_type
normalized = parse_type("character varying(255)", "postgres")  # → "VARCHAR(255)"
```

---

## dlt-connector

A specialized skill for users who want to query SaaS data (HubSpot,
Stripe, Salesforce, GitHub, Slack, …) with SQL. It chains a
[dlt](https://dlthub.com) extraction pipeline into DuckDB with
auto-generation of a Wren project on top.

### Four-phase workflow

| Phase | Goal | Key actions |
|-------|------|-------------|
| **1. Extract** | Pull SaaS data into local DuckDB | `pip install "dlt[duckdb]"`, write a small `pipeline.py`, set source credentials, run `pipeline.run(source)` |
| **2. Model** | Auto-generate a Wren project | Run the bundled `introspect_dlt` script to scan DuckDB, normalize types via `wren.type_mapping.parse_type()`, write models, relationships, profile |
| **3. Build & Verify** | Confirm queries work end-to-end | `wren context build`, `wren memory index`, run sample SQL through the engine — not just file generation |
| **4. Handoff** | Show first results | Run a couple of representative queries and surface them to the user |

The user can enter at any phase. If they already have a `.duckdb` file
from a prior dlt run, the skill can start from Phase 2.

The introspection script is fetched separately rather than inlined:

```bash
wren skills get dlt-connector --script introspect_dlt > introspect_dlt.py
python introspect_dlt.py --duckdb-path ./pipeline.duckdb --output-dir ./project
```

### Two non-negotiable invariants

1. **DuckDB catalog naming** — when Wren AI `ATTACH`es a `.duckdb` file,
   it uses the filename stem as the catalog alias. So every model's
   `table_reference.catalog` **must equal the filename stem**.
   `stripe_data.duckdb` → catalog `stripe_data`. The bundled
   `introspect_dlt` script handles this automatically — never override.
2. **Type normalization through wren SDK** — column types must go through
   `wren.type_mapping.parse_type()` (sqlglot-based). Don't hardcode
   mappings; DuckDB-specific types like `HUGEINT` or `TIMESTAMP WITH
   TIME ZONE` need canonical conversion.

### When to trigger

The discovery stub routes the agent here on phrases like:

- "connect HubSpot / Stripe / Salesforce / GitHub / Slack data"
- "load data from a SaaS API"
- "import data from a REST API"
- "set up a dlt pipeline"
- "I have a `.duckdb` file from dlt — make a Wren project from it"

### Source coverage

The skill ships a reference list of common dlt-verified sources with auth
patterns. For sources not on the list, the agent checks
[dlthub.com/docs/dlt-ecosystem/verified-sources](https://dlthub.com/docs/dlt-ecosystem/verified-sources)
before improvising.

---

## Skill bundle layout

Inside the wheel, each skill is a directory under
`src/wren/skills_content/`:

```text
src/wren/skills_content/
├── onboarding/
│   └── SKILL.md
├── usage/
│   ├── SKILL.md
│   └── references/
│       ├── memory.md
│       └── wren-sql.md
├── generate-mdl/
│   └── SKILL.md
├── enrich-context/
│   ├── SKILL.md
│   └── references/
│       ├── gap_catalog.md
│       └── cube_proposals.md
└── dlt-connector/
    ├── SKILL.md
    ├── references/
    │   └── dlt_sources.md
    └── scripts/
        └── introspect_dlt.py
```

Each `SKILL.md` has YAML frontmatter with name, description, and license.
`wren skills get <name>` prints `SKILL.md`; `--full` appends every
`references/*.md` in sorted order; `--script <stem>` prints a single file
from `scripts/`. The skill bundle is shipped inside the `wrenai` wheel
via Hatchling's `[tool.hatch.build.targets.wheel] artifacts` glob, so a
fresh `pip install wrenai` always carries matching skill content.
