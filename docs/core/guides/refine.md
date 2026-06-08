---
sidebar_label: Refine answer quality
---

# Refine answer quality

Scaffolding gives you a baseline MDL. This recipe is how you close the loop — bring in the business meaning that lives outside the database, store proven examples, and let the agent compound from every confirmed answer.

## What you'll end up with

- An `instructions.md` that captures business rules, canonical tables, and team conventions
- A memory index over MDL + instructions so agents retrieve relevant context per question
- A `queries.yml` of confirmed natural-language-to-SQL pairs, committable to your repo
- An agent that gets better at your business each time someone confirms an answer

## Prerequisite — install the `memory` extra

The memory layer is an optional extra. It is **not** included in the base CLI. Install it before running any `wren memory ...` command:

```bash
pip install "wrenai[memory]"
```

Combine with your data source extra as needed:

```bash
pip install "wrenai[memory,postgres]"
pip install "wrenai[memory,bigquery]"
```

Without the `memory` extra, the memory commands below will not be available.

## The flow today

The day-to-day refinement loop runs on the `usage` guide plus a few `wren memory` and `instructions.md` edits. When you need to go deeper than incremental edits — backfilling enum meanings, units, default filters, synonyms, or named metrics across a whole project — reach for the [`enrich-context`](#enrich-context) guide described below.

### 1. Capture business rules in `instructions.md`

`instructions.md` is the place to write down the rules that are not visible from the schema:

```markdown
## Business rules
- Revenue queries must use `net_revenue`, not `gross_revenue`.
- All active-customer queries exclude rows where `is_internal = true`.

## Canonical tables
- Use `customers` for analytics, not `customers_v3` or `loyalty_v3`.

## Formatting
- Currency is USD; display with thousand separators and 2 decimals.
- Timestamps are stored in UTC.
```

Organize by topic with `##` headings — each heading and its body becomes a retrievable chunk in memory. Edit by hand, or have your agent propose changes when it spots a recurring confusion.

### 2. Let `usage` compound from every confirmed answer

The day-to-day `usage` guide stores confirmed answers automatically:

```text
User asks a question
  → wren memory recall  (find similar past pairs)
  → wren memory fetch   (retrieve relevant schema)
  → write SQL, dry-plan, execute
  → wren memory store   (persist the confirmed pair)
```

Each stored pair makes future similar questions faster and more accurate. The loop runs on every turn — no separate enrichment phase needed.

### 3. Re-index after each change

Whenever you edit `instructions.md`, MDL, or `queries.yml`, rebuild the memory index so the agent's retrieval reflects the new context:

```bash
wren memory index
```

This re-reads MDL + `instructions.md` + `queries.yml` into the memory store. Targeted retrieval (`wren memory fetch -q "..."`) and recall (`wren memory recall -q "..."`) now see the new context.

### 4. Export learned context to your repo

Curate the team's accumulated learning into `queries.yml`:

```bash
wren memory dump --source user -o queries.yml
git add queries.yml
git commit -m "curate query pairs from this sprint"
```

A new environment picks them up automatically on the next `wren memory index`.

## When to come back here

- A user complains the agent picked the wrong table
- A new business term shows up (a project name, a metric, a customer segment)
- You import a new dataset and need to teach the agent its quirks
- You want a teammate's environment to inherit accumulated learning

## Memory hygiene

Three commands to keep memory tidy:

| Command | When |
|---|---|
| `wren memory list` | Browse stored pairs |
| `wren memory forget --id <n> --force` | Remove an incorrect pair |
| `wren memory dump --source user` | Export confirmed pairs to `queries.yml` for commit |

See the [CLI reference](/oss/reference/cli) for the full memory command surface.

## `enrich-context`

The `enrich-context` guide goes deeper than incremental `instructions.md` edits. It reads everything you drop into `<project>/raw/` (PDFs, glossaries, handbooks, analyst SQL, data dictionaries), compares it against the current MDL / `instructions.md` / `queries.yml` / memory, and fills the gaps — writing back only to reviewable, version-controlled artifacts. It works from a ten-category gap catalog: enum value meanings, units, NULL semantics, magic sentinels, default filters, synonyms, time conventions, cross-system identifiers, currency rules, and canonical-table preferences. Named aggregation metrics (ARR, churn, DAU) are proposed as cubes.

Pick one of two modes at session start:

- **Grill mode** — the agent walks each gap one question at a time and asks focused questions ("Which of `customers`, `customers_v3`, `loyalty_v3` is canonical?", "What does `status = 4` mean?"). You answer in plain language; the agent drafts the change and patches MDL, `instructions.md`, `queries.yml`, or memory based on the answer category. With your OK, it can also sample low-cardinality columns from the live DB to discover enum and sentinel values.
- **Auto-pilot mode** — drop docs, glossaries, SQL history, or a metric handbook into `<project>/raw/` and the agent reads them, applies its best inferences directly, and escalates to grill only on raw-vs-MDL conflicts and high-blast-radius additions (new cubes / views / relationships). It hands you a confidence-tagged audit at the end.

Both modes only **add** — they never modify an existing field; contradictions are surfaced on a "please fix manually" list. With the `wren` skill installed (`npx skills add Canner/WrenAI`), trigger it by saying "enrich context" or "grill me on this project" — the stub fetches the guide with `wren skills get enrich-context`. See the [skills reference](/oss/reference/skills#enrich-context) for the full breakdown.

## See also

- [How does the agent learn from your context?](/oss/concepts/agent_learning) — the design behind the loop
- [How does memory get smarter over time?](/oss/concepts/memory_system) — what's indexed and how recall works
- [Model your business](./model.md) — the scaffolding step before you start refining
