---
sidebar_label: How Wren manages your business knowledge
---

# How Wren manages your business knowledge

GenBI is only as good as what the agent knows. The *Generate* and *Deploy* beats
produce trustworthy BI because of a third beat that runs underneath them:
**Know** — the way Wren captures, reviews, and reuses your business knowledge so
agents stop rediscovering it from scratch.

This page is the map of that knowledge: where each kind lives, how it gets in,
and why it stays trustworthy.

## The four places knowledge lives

Wren keeps business knowledge in explicit, version-controlled artifacts — never
buried in a prompt or locked inside a UI:

| Artifact | What it holds | Example |
| --- | --- | --- |
| **MDL** (semantic models) | Structure and semantics: models, columns, relationships, calculated fields, views, cubes | `loyalty_v3` is the canonical loyalty table; `revenue = price * qty - refunds` |
| **`instructions.md`** | Business rules and operating policy the schema can't carry | "active customer excludes service accounts"; "always filter `is_deleted = false`" |
| **Memory** | Behavioral knowledge: which schema items were relevant, which SQL answered a similar question, confirmed examples | a proven "top accounts by ARR this quarter" query, ready to reuse |
| **`queries.yml`** | Curated, exported question→SQL pairs you want to keep and share | a reviewed library of canonical analyses |

MDL says what the data *means*. Instructions say how your team wants it *used*.
Memory says what has *worked*. Together they are the context layer the rest of
the docs refer to — see [What does Wren AI mean by context?](/oss/concepts/what_is_context).

## How knowledge gets in: scaffold fast, enrich deep

You do not write all of this by hand. The agent builds it in two beats (the
loop described in [How does the agent learn from your context?](/oss/concepts/agent_learning)):

1. **Scaffold fast.** The `generate-mdl` skill introspects your database and
   produces a working MDL — one model per table, normalized types, detected
   relationships. Enough to start querying in minutes.
2. **Enrich deep.** The `enrich-context` skill brings in the meaning that lives
   *outside* the database — enum meanings, units, NULL semantics, default
   filters, synonyms, currency rules, and named metrics (ARR, churn, DAU) as
   cubes. It runs in **grill** mode (one question at a time) or **auto-pilot**
   mode (reads everything under `<project>/raw/` — PDFs, glossaries, handbooks —
   and proposes). See [Refine answer quality](/oss/guides/refine).

This is the difference between a *semantic* layer and a *context* layer: Wren
ingests the company know-how that dbt, Cube, and the warehouse structurally
can't, because it doesn't live in the schema.

## Why this knowledge stays trustworthy

- **Reviewable** — every definition, rule, and example is a file you can read in
  a pull request. No black-box embeddings deciding what your metrics mean.
- **Versioned and Git-friendly** — knowledge evolves with your code, with full
  history and the ability to fork, diff, and roll back.
- **Evidence-linked** — enrichment records *why* a mapping is true (the doc or
  column it came from), so it can be re-validated when the business changes.
- **Compounding** — every confirmed answer can feed memory, so the next
  question — and the next dashboard — starts further ahead.

## Where to go next

- [Refine answer quality](/oss/guides/refine) — the hands-on enrichment recipe
- [The memory system](/oss/concepts/memory_system) — how behavioral knowledge works
- [What does MDL do for the agent?](/oss/concepts/what_is_mdl) — the semantic contract
- [Build & deploy a GenBI app](/oss/guides/genbi) — turn this knowledge into a dashboard
