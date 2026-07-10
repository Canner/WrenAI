---
sidebar_label: How does the agent learn from your context?
---

# How does the agent learn from your context?

> An agent that ships in production does not memorize your business. It reads structured context, recalls proven examples, and writes them back as it works. Wren AI is designed around that loop, and it is what lets the BI your agents generate get more correct over time.

## Why this matters

A first-day analyst does not know which table is canonical. Neither does an agent. Both get better through the same path: a guided start, focused questions, and a record of what worked.

The difference is that an agent forgets between sessions unless your tooling stores the learning somewhere reviewable. Wren AI captures that learning in four explicit places (MDL, business rules, confirmed NL→SQL pairs, and the memory index) so the agent picks up where the team left off, every time.

## Two phases: scaffold fast, enrich deep

Wren AI runs the agent through two phases whenever you set up a new project.

**Phase 1: Scaffold fast.** The `generate-mdl` guide drives the agent through schema discovery, type normalization, and an initial MDL project. The agent can already query through that modeled layer in a few minutes. The MDL is rough but functional. It covers what the database can tell you about itself.

**Phase 2: Enrich deep.** Structure is only the start. The hard business meaning lives in docs, decks, Slack threads, and analyst SQL. The `enrich-context` workflow brings that meaning in through two modes:

- **Grill mode**: the agent asks one focused question at a time ("which is the canonical `orders` table?", "what does `status = 4` mean?", "should `active customer` exclude internal users?"). You answer; the agent patches MDL or `knowledge/` (rules and NL→SQL pairs).
- **Auto-pilot mode**: drop PDFs, glossaries, handbooks, and SQL history into `<project>/raw/`. The agent reads them, proposes context changes with evidence, and waits for review.

Both modes write to reviewable, version-controlled artifacts. Nothing is silently absorbed into a black box.

## Where the learning lives

Four artifacts capture different layers of learning — explicit, inspectable files, not a prompt or a locked UI:

| Artifact | What it holds | Example | Updated by |
|---|---|---|---|
| **MDL** (`models/`, `views/`, `relationships.yml`) | Structural and semantic contract: what data exists, how it relates, which calculations are reusable | `loyalty_v3` is the canonical loyalty table; `revenue = price * qty - refunds` | `wren context build`, manual edits, agent-proposed changes |
| **`knowledge/rules/`** | Business rules and operating policy the schema can't carry | "active customer excludes service accounts"; "always filter `is_deleted = false`" | Manual edits or agent-proposed changes |
| **`knowledge/sql/`** | Confirmed natural-language-to-SQL pairs, one markdown file each — the source of truth for recall | "top customers by revenue" → the accepted SQL | `wren memory store`, manual edits |
| **Memory index** (`.wren/memory/`) | Derived retrieval index over MDL + `knowledge/` (optional Qdrant, else grep) | rebuilt any time, gitignored | `wren memory index` |

MDL says what the data *means*. `knowledge/rules/` says how your team wants it *used*. `knowledge/sql/` records what has *worked*. The first three are version-controlled files in your repo; the memory index is a derived artifact rebuilt from them. Together they are the context layer the rest of the docs refer to — see [What does Wren AI mean by context?](/oss/concepts/what_is_context).

The agent reads from all of these when it gathers context for a new question. MDL and rules
change rarely; the NL→SQL pairs grow with use, and the index is rebuilt from them.

## Why this knowledge stays trustworthy

- **Reviewable.** Every definition, rule, and example is a file you can read in a
  pull request. No black-box embeddings deciding what your metrics mean.
- **Versioned and Git-friendly.** Knowledge evolves with your code, with full
  history and the ability to fork, diff, and roll back.
- **Evidence-linked.** Enrichment records *why* a mapping is true (the doc or
  column it came from), so it can be re-validated when the business changes.
- **Compounding.** Every confirmed answer can feed memory, so the next question,
  and the next dashboard, starts further ahead.

## The query workflow in practice

The `usage` guide orchestrates the day-to-day pattern:

```text
User asks a business question
  │
  ├── 1. wren memory recall   → find similar accepted NL-SQL pairs
  ├── 2. wren memory fetch    → retrieve relevant models, columns, relationships
  ├── 3. Write SQL against MDL objects, not raw tables
  ├── 4. wren dry-plan        → see expanded SQL before execution
  ├── 5. wren --sql ...       → execute
  ├── 6. Repair on failure    → diagnose at MDL layer vs DB layer
  └── 7. wren memory store    → persist the confirmed pair
```

Each step is a deterministic primitive the agent orchestrates. The trace stays visible in the agent's reasoning, not buried in a closed product.

## Why this is different from "more examples"

Sending more examples into a prompt has a ceiling. The model sees the schema and tries its best.

Wren AI lets the system compound:

- Recurring questions retrieve better examples each time.
- Recurring metrics reuse accepted SQL patterns.
- Schema retrieval narrows as the project grows.
- Corrections become future grounding instead of disappearing at session end.
- Teams can commit `knowledge/sql/` so new environments inherit the learning.

The agent is not getting smarter. The context layer it reads from is getting richer, and it is reviewable every step of the way.

## See also

- [How does memory get smarter over time?](./memory_system.md): the mechanics of recall and indexing.
- [What does MDL do for the agent?](./what_is_mdl.md): the semantic contract the agent reads.
- [Refine answer quality](/oss/guides/refine): the recipe for running the enrich loop.
- [Build & deploy a GenBI app](/oss/guides/genbi): turn this knowledge into a dashboard.
