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
pip install "wren-engine[memory]"
```

Combine with your data source extra as needed:

```bash
pip install "wren-engine[memory,postgres]"
pip install "wren-engine[memory,bigquery]"
```

Without the `memory` extra, the memory commands below will not be available.

## The flow today

The day-to-day refinement loop runs entirely on the `wren-usage` skill plus a few `wren memory` and `instructions.md` edits. Nothing requires a separate enrichment skill — that is on the roadmap (see [Coming soon](#coming-soon-wren-enrich-context) below).

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

### 2. Let `wren-usage` compound from every confirmed answer

The day-to-day `wren-usage` skill stores confirmed answers automatically:

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

## Coming soon: `wren-enrich-context`

A dedicated `wren-enrich-context` skill is in **active development**. It will surface two structured modes for going deeper than `instructions.md` edits:

- **Grill mode** — the agent walks the MDL one piece at a time and asks focused questions ("Which of `customers`, `customers_v3`, `loyalty_v3` is canonical?", "What does `status = 4` mean?"). You answer in plain language; the agent patches MDL, `instructions.md`, `queries.yml`, or memory based on the answer category.
- **Auto-pilot mode** — drop docs, glossaries, SQL history, or a metric handbook into `<project>/raw/` and the agent reads them, proposes context changes with evidence, and surfaces a diff for review. Nothing writes to production context without your approval.

Until that ships, the flow above (manual `instructions.md` edits + `wren-usage` loop + `queries.yml` curation) covers the same ground. Watch the [WrenAI repo](https://github.com/Canner/WrenAI) for updates.

## See also

- [How does the agent learn from your context?](/oss/concepts/agent_learning) — the design behind the loop
- [How does memory get smarter over time?](/oss/concepts/memory_system) — what's indexed and how recall works
- [Model your business](./model.md) — the scaffolding step before you start refining
