# Wren Engine CLI Skill Reference

Skills are instruction files that extend AI agents with Wren-specific workflows. Install them into your local skills folder and invoke them by name during a conversation.

---

## wren-usage

**File:** [wren-usage/SKILL.md](wren-usage/SKILL.md)

**Primary entry point** for day-to-day Wren Engine CLI usage. Covers the full query workflow: gather schema context, recall past queries, write SQL through the MDL semantic layer, execute via `wren --sql`, and store confirmed results.

### When to use

- Answering data questions using the `wren` CLI
- Debugging SQL errors (MDL-level vs DB-level diagnosis)
- Connecting a new data source via `wren profile`
- Re-indexing memory after MDL changes
- Any ongoing Wren task after initial setup is complete

### Reference files

| File | Topic |
|------|-------|
| [references/memory.md](wren-usage/references/memory.md) | When to index, fetch, store, and recall |
| [references/wren-sql.md](wren-usage/references/wren-sql.md) | CTE rewrite pipeline, SQL rules, error diagnosis |

### Dependent skills

| Skill | Purpose |
|-------|---------|
| `wren-generate-mdl` | Generate or regenerate MDL from a database |

---

## wren-generate-mdl

**File:** [wren-generate-mdl/SKILL.md](wren-generate-mdl/SKILL.md)

Generates a Wren MDL project by exploring a live database using whatever tools are available to the agent (SQLAlchemy, database drivers, raw SQL). Handles schema discovery, type normalization via `wren utils parse-type`, and YAML project scaffolding via `wren context init`.

### When to use

- Onboarding a new data source into Wren
- Scaffolding an MDL project from an existing database schema
- Re-generating models after database schema changes

### Workflow summary

1. Establish connection and agree on scope with the user
2. Discover schema (tables, columns, types, constraints)
3. Normalize types via `wren.type_mapping.parse_type` or `wren utils parse-type`
4. Scaffold project with `wren context init`
5. Write model YAML files and `relationships.yml`
6. Validate (`wren context validate`) and build (`wren context build`)
7. Initialize memory (`wren memory index`)

---

## wren-enrich-context

**File:** [wren-enrich-context/SKILL.md](wren-enrich-context/SKILL.md)

Augments a Wren project with the business context that DB schema cannot carry. The session starts by asking the user to pick one of two modes:

- **Grill mode** — one question at a time, agent proposes a draft, user accepts / edits / skips.
- **Auto-pilot mode** — agent reads `raw/` + current context, applies best inferences directly, escalates to grill only on raw-vs-MDL conflicts and high-blast-radius additions (new metrics / views / relationships), and hands the user a confidence-tagged audit at the end.

Both modes read everything under `<project>/raw/` (PDFs, glossaries, handbooks, code, data dictionaries), compare against the current MDL / `instructions.md` / `queries.yml` / memory pairs, then fill missing relationships, metrics, views, default filters, business rules, and NL→SQL patterns. Confirmed findings are written back to the right sink — **only adds, never modifies existing fields**.

### When to use

- After scaffolding an MDL when the agent still doesn't grasp business semantics
- When the user has handbooks / glossaries / financial reports / data dictionaries the agent should know
- When schema-derived MDL is too thin to drive accurate SQL generation
- When the user wants to commit project-wide rules (e.g., "user means type=default by default") into a place the agent will see them

### Sinks

| Sink | Type of finding |
|------|-----------------|
| MDL YAML | Schema structure, relationships, metrics, views, descriptions |
| `instructions.md` | Default filters, implicit rules, business conventions |
| `queries.yml` | Canonical NL→SQL pairs (git-trackable, team-shared) |
| `wren memory store` (only when memory extra installed) | Ad-hoc user-local NL→SQL pairs |

### Dependent skills

| Skill | Purpose |
|-------|---------|
| `wren-generate-mdl` | Generate the initial MDL before context augmentation |

---

## wren-dlt-connector

**File:** [wren-dlt-connector/SKILL.md](wren-dlt-connector/SKILL.md)

Connects SaaS data (HubSpot, Stripe, Salesforce, GitHub, Slack, etc.) to Wren Engine for SQL analysis. Walks through the full flow: install dlt, pick a SaaS source, set up credentials, run the data pipeline into DuckDB, then auto-generate a Wren semantic project from the loaded data.

### When to use

- Connecting SaaS data sources (HubSpot, Stripe, Salesforce, GitHub, Slack, etc.)
- Importing data from an API via dlt pipelines
- Loading SaaS data into DuckDB for SQL analysis
- Creating a Wren project from an existing dlt-produced DuckDB file

### Dependent skills

| Skill | Purpose |
|-------|---------|
| `wren-generate-mdl` | Generate or regenerate MDL from the DuckDB database |

---

## Installing a skill

```bash
# Install wren-usage (auto-installs dependencies)
bash skills/install.sh wren-usage

# Or install everything
bash skills/install.sh
```

Then invoke in your AI client:

```
/wren-usage
/wren-generate-mdl
/wren-enrich-context
```
