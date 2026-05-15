# Skills

Wren AI provides **skills** — reusable AI agent workflow guides that teach Claude Code (or other AI coding agents) how to use the Wren CLI effectively. Skills are not plugins or extensions; they are structured prompts with decision trees that guide an agent through multi-step tasks.

## Available skills

| Skill | Purpose |
|-------|---------|
| **wren-onboarding** | Entry point: environment checks, project scaffolding, profile setup, first query |
| **wren-generate-mdl** | One-time setup: explore database schema, normalize types, scaffold MDL YAML project |
| **wren-usage** | Day-to-day workflow: gather schema context, recall past queries, write SQL, execute, store results |
| **wren-dlt-connector** | Connect SaaS APIs (HubSpot, Stripe, Salesforce, GitHub, Slack, …) into DuckDB via dlt, then auto-generate a Wren project |

## Installation

The installer supports every major AI coding agent (Claude Code, Openclaw, Hermes, Codex, etc.) and auto-detects which one you're using:

```bash
# All skills at once
npx skills add Canner/WrenAI --skill '*'

# Or via install script
curl -fsSL https://raw.githubusercontent.com/Canner/WrenAI/main/skills/install.sh | bash
```

After installation, **start a new agent session** — skills are loaded at session start.

### Update skills

Skills check for updates automatically and notify the agent when a newer version is available. To force-update:

```bash
# All skills
curl -fsSL https://raw.githubusercontent.com/Canner/WrenAI/main/skills/install.sh | bash -s -- --force

# Single skill
curl -fsSL https://raw.githubusercontent.com/Canner/WrenAI/main/skills/install.sh | bash -s -- --force wren-generate-mdl
```

---

## wren-onboarding

The entry-point skill. It walks the agent through the full setup flow — environment checks, project scaffolding, connection configuration, MDL generation, and a first query — by routing to docs and other skills at each step. The skill itself stays focused on agent-side rules (one step per turn, never ask for credentials in chat).

### Workflow

```text
User says "install wren" / "set up wren"
  │
  ├── Preflight (read-only)
  │     Python 3.11+, virtualenv, wren CLI, working dir
  │
  ├── Branch: bundled demo or own database?
  │     demo → quickstart.md, stop
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
  │     dispatch → wren-generate-mdl skill
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

The skill activates on phrases like:

- "install wren"
- "set up wren engine"
- "connect a new database"
- "I want to start a Wren project"
- `/wren-onboarding`

### Reference docs (skill points to these, never duplicates)

- [Installation](../get_started/installation.md)
- [Connect your database](/oss/guides/connect)
- [Quickstart with sample data](../get_started/quickstart.md)

---

## wren-usage

The primary skill for day-to-day querying. It guides the agent through a complete query lifecycle.

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

The agent checks `dry-plan` output first to isolate whether the error is in the semantic layer or the database.

### Additional workflows

| Workflow | When |
|----------|------|
| **Connect new data source** | `wren profile add` → `wren context init` → build → index |
| **After MDL changes** | `wren context validate` → `wren context build` → `wren memory index` |

### Reference files

The skill includes two reference documents loaded on demand:

- **memory.md** — Decision logic for when to `index`, `fetch`, `store`, and `recall`. Covers the hybrid retrieval strategy, store-by-default policy, and full lifecycle examples.
- **wren-sql.md** — How the CTE-based rewrite pipeline works. Explains how the engine injects model CTEs, what SQL features are supported, and how to use `dry-plan` to diagnose errors layer by layer.

---

## wren-generate-mdl

A one-time setup skill that walks the agent through creating an MDL project from a live database.

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

## wren-dlt-connector

A specialized skill for users who want to query SaaS data (HubSpot, Stripe, Salesforce, GitHub, Slack, …) with SQL. It chains a [dlt](https://dlthub.com) extraction pipeline into DuckDB with auto-generation of a Wren project on top.

### Four-phase workflow

| Phase | Goal | Key actions |
|-------|------|-------------|
| **1. Extract** | Pull SaaS data into local DuckDB | `pip install "dlt[duckdb]"`, write a small `pipeline.py`, set source credentials, run `pipeline.run(source)` |
| **2. Model** | Auto-generate a Wren project | Run `introspect_dlt.py` to scan DuckDB, normalize types via `wren.type_mapping.parse_type()`, write models, relationships, profile |
| **3. Build & Verify** | Confirm queries work end-to-end | `wren context build`, `wren memory index`, run sample SQL through the engine — not just file generation |
| **4. Handoff** | Show first results | Run a couple of representative queries and surface them to the user |

The user can enter at any phase. If they already have a `.duckdb` file from a prior dlt run, the skill can start from Phase 2.

### Two non-negotiable invariants

1. **DuckDB catalog naming** — when Wren AI `ATTACH`es a `.duckdb` file, it uses the filename stem as the catalog alias. So every model's `table_reference.catalog` **must equal the filename stem**. `stripe_data.duckdb` → catalog `stripe_data`. The `introspect_dlt.py` script handles this automatically — never override.
2. **Type normalization through wren SDK** — column types must go through `wren.type_mapping.parse_type()` (sqlglot-based). Don't hardcode mappings; DuckDB-specific types like `HUGEINT` or `TIMESTAMP WITH TIME ZONE` need canonical conversion.

### When to trigger

The skill activates on phrases like:

- "connect HubSpot / Stripe / Salesforce / GitHub / Slack data"
- "load data from a SaaS API"
- "import data from a REST API"
- "set up a dlt pipeline"
- "I have a `.duckdb` file from dlt — make a Wren project from it"

### Source coverage

The skill ships a reference list of common dlt-verified sources with auth patterns. For sources not on the list, the agent checks [dlthub.com/docs/dlt-ecosystem/verified-sources](https://dlthub.com/docs/dlt-ecosystem/verified-sources) before improvising.

---

## Skill structure

Skills are installed to `~/.claude/skills/` with this layout:

```text
~/.claude/skills/
├── wren-onboarding/
│   └── SKILL.md              # Setup workflow (routes to docs and other skills)
├── wren-generate-mdl/
│   └── SKILL.md              # MDL generation workflow
├── wren-usage/
│   ├── SKILL.md              # Day-to-day query workflow
│   └── references/
│       ├── memory.md          # Memory command decision logic
│       └── wren-sql.md        # CTE rewrite pipeline reference
└── wren-dlt-connector/
    ├── SKILL.md              # SaaS-via-dlt → DuckDB → Wren project
    ├── references/
    │   └── dlt_sources.md     # Per-source dlt templates and auth patterns
    └── scripts/
        └── introspect_dlt.py  # Auto-generates a Wren project from a .duckdb file
```

Each `SKILL.md` has YAML frontmatter with name, description, version, and license. The agent loads the main SKILL.md when triggered, and loads reference files or scripts on demand when deeper context is needed.
