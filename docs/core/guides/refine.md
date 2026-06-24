---
sidebar_label: Refine answer quality
---

# Refine answer quality

Scaffolding gives you a baseline MDL. This recipe is how you close the loop. Bring in the business meaning that lives outside the database, store proven examples, and let the agent compound from every confirmed answer. It is the hands-on version of the [Know beat](/oss/concepts/knowledge_management): richer knowledge here means more trustworthy BI downstream.

## What you'll end up with

- Business rules under `knowledge/rules/` capturing canonical tables and team conventions
- Confirmed natural-language-to-SQL pairs under `knowledge/sql/`, committed to your repo
- A memory index over MDL + `knowledge/` so agents retrieve relevant context per question
- An agent that gets better at your business each time someone confirms an answer

## Optional: the `memory` extra

Refinement works out of the box — `wren memory store`, `index`, and `recall` operate over
the markdown in `knowledge/` with no extra dependency (token/substring matching).

Install the `memory` extra only when you want **semantic** (embedding) recall and schema
search (`wren memory fetch`):

```bash
pip install "wrenai[memory]"
# combine with your data source extra as needed:
pip install "wrenai[memory,postgres]"
```

With the extra, recall is embedding-based and LanceDB caches the index; without it, the
same commands fall back to the dependency-free grep backend.

## The flow today

The day-to-day refinement loop runs on the `usage` guide plus a few `wren memory` and
`knowledge/rules/` edits. When you need to go deeper than incremental edits, such as
backfilling enum meanings, units, default filters, synonyms, or named metrics across a
whole project, reach for the [`enrich-context`](#enrich-context) guide described below.

### 1. Capture business rules in `knowledge/rules/`

`knowledge/rules/` is where you write down the rules that are not visible from the schema.
Use one markdown file per topic (e.g. `knowledge/rules/revenue.md`):

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

Each file (and `##` heading within it) becomes a retrievable chunk in memory. Edit by hand,
or have your agent propose changes when it spots a recurring confusion. (Older projects: a
top-level `instructions.md` is still read, but it's deprecated — move it into
`knowledge/rules/`; see [Migration](/oss/reference/migration).)

### 2. Let `usage` compound from every confirmed answer

The day-to-day `usage` guide stores confirmed answers automatically:

```text
User asks a question
  → wren memory recall  (find similar past pairs)
  → wren memory fetch   (retrieve relevant schema)
  → write SQL, dry-plan, execute
  → wren memory store   (write the confirmed pair to knowledge/sql/ + index)
```

Each `store` writes a `knowledge/sql/<slug>.md` file — that markdown is the durable record;
the index is built from it. Future similar questions get faster and more accurate, with no
separate enrichment phase needed.

### 3. Re-index after each change

Whenever you edit MDL or `knowledge/`, rebuild the memory index so the agent's retrieval
reflects the new context:

```bash
wren memory index
```

This re-reads MDL + `knowledge/rules/` + `knowledge/sql/` into the index. Targeted
retrieval (`wren memory fetch -q "..."`) and recall (`wren memory recall -q "..."`) now see
the new context. Run `wren memory check` to see whether the index is in sync with the
markdown.

### 4. Commit the learned context

The pairs are already files — committing `knowledge/` *is* the export:

```bash
git add knowledge/
git commit -m "curate query pairs and rules from this sprint"
```

A new environment picks them up automatically on the next `wren memory index` (which
rebuilds the local index from the committed markdown).

## When to come back here

- A user complains the agent picked the wrong table
- A new business term shows up (a project name, a metric, a customer segment)
- You import a new dataset and need to teach the agent its quirks
- You want a teammate's environment to inherit accumulated learning

## Memory hygiene

Because the pairs are files under `knowledge/sql/`, hygiene is mostly ordinary file edits:

| Action | How |
|---|---|
| Browse stored pairs | `wren memory list`, or read `knowledge/sql/*.md` |
| Fix an incorrect pair | edit (or delete) its `knowledge/sql/<slug>.md`, then `wren memory index` |
| Share confirmed pairs | commit `knowledge/sql/` (no export step) |
| Check index vs. markdown | `wren memory check` |

See the [CLI reference](/oss/reference/cli) for the full memory command surface.

## `enrich-context`

The `enrich-context` guide goes deeper than incremental `knowledge/rules/` edits. It reads everything you drop into `<project>/raw/` (PDFs, glossaries, handbooks, analyst SQL, data dictionaries), compares it against the current MDL and `knowledge/`, and fills the gaps, writing back only to reviewable, version-controlled artifacts. It works from a ten-category gap catalog: enum value meanings, units, NULL semantics, magic sentinels, default filters, synonyms, time conventions, cross-system identifiers, currency rules, and canonical-table preferences. Named aggregation metrics (ARR, churn, DAU) are proposed as cubes.

Pick one of two modes at session start:

- **Grill mode**: the agent walks each gap one question at a time and asks focused questions ("Which of `customers`, `customers_v3`, `loyalty_v3` is canonical?", "What does `status = 4` mean?"). You answer in plain language; the agent drafts the change and patches MDL or `knowledge/` (rules and NL→SQL pairs) based on the answer category. With your OK, it can also sample low-cardinality columns from the live DB to discover enum and sentinel values.
- **Auto-pilot mode**: drop docs, glossaries, SQL history, or a metric handbook into `<project>/raw/` and the agent reads them, applies its best inferences directly, and escalates to grill only on raw-vs-MDL conflicts and high-blast-radius additions (new cubes / views / relationships). It hands you a confidence-tagged audit at the end.

Both modes only **add**. They never modify an existing field; contradictions are surfaced on a "please fix manually" list. With the `wren` skill installed (`npx skills add Canner/WrenAI`), trigger it by saying "enrich context" or "grill me on this project". The stub fetches the guide with `wren skills get enrich-context`. See the [skills reference](/oss/reference/skills#enrich-context) for the full breakdown.

## See also

- [How does the agent learn from your context?](/oss/concepts/agent_learning): the design behind the loop
- [How does memory get smarter over time?](/oss/concepts/memory_system): what's indexed and how recall works
- [Model your business](./model.md): the scaffolding step before you start refining
