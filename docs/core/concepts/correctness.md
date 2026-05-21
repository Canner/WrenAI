---
sidebar_label: How does Wren AI keep agents from hallucinating?
---

# How does Wren AI keep agents from hallucinating?

> Hallucination on business data is rarely a model problem. It is a missing-context problem. Wren AI exposes correctness as a system of primitives the agent composes — not a single feature you switch on.

## Why "trust the model" is not enough

The temptation is to treat correctness like a setting: add metadata, add examples, swap to a bigger model. That does not work.

We have seen projects ship 100+ examples and still watch the agent pick the wrong table, hallucinate column names, or invent joins. Examples help one of six pillars. Miss any of the other five and the agent fails in that exact gap.

Reliable text-to-SQL needs **six primitives working together**.

## The six correctness pillars

| Pillar | What the agent needs to do | How Wren AI helps |
|---|---|---|
| **Schema linking** | Know which models, columns, and relationships matter for the question | MDL + `wren memory fetch` retrieves only the relevant slice |
| **Value profiling** | Know what values actually appear in the data (`status = 4` means refunded) | Connector introspection + `instructions.md` indexed into memory |
| **Ambiguity detection** | Know when the question needs clarification before any SQL is written | Skill orchestration — the agent stops to ask |
| **Generation trace** | Show what context, examples, model, and join path produced the answer | `wren dry-plan` expands SQL deterministically; the trace lives in the agent's reasoning |
| **Retry and repair** | Distinguish an MDL bug from a DB bug from a prompt bug | Structured errors at every layer; `wren dry-run` validates without executing |
| **Eval** | Detect regressions when MDL, instructions, or schema change | Golden NL-SQL eval workflows in active development |

Drop any one and the agent will eventually fail in that gap.

## Primitives, not a closed product

Other systems hide correctness inside a managed text-to-SQL service and ask you to trust the dashboard. Wren AI takes the opposite stance: every primitive is exposed as a CLI command or SDK tool the agent can call directly.

```bash
wren memory fetch -q "..."     # retrieve relevant schema for the question
wren memory recall -q "..."    # find similar past NL-SQL pairs
wren dry-plan --sql "..."      # expand SQL and show the planned query
wren dry-run  --sql "..."      # validate against the live DB without returning rows
wren --sql "..."               # execute through the modeled layer
wren memory store --nl --sql   # persist the confirmed pair
```

The agent decides when to fetch, when to dry-plan, when to repair, when to ask. The trace stays inside the agent's reasoning loop, where you already review its work.

## Pre-aggregation as a concrete primitive

Pre-aggregation cubes are the clearest example of "remove the failure mode entirely."

Small models routinely break on hand-written `GROUP BY` + `DATE_TRUNC` + filter SQL — joins go wrong, time grain gets misread, measures double-count. Wren AI cubes let you declare a business metric once with measures, dimensions, time grains, and hierarchies. The agent queries the cube with **structured input** instead of inventing SQL.

For small or local models, this is the difference between a 30% error rate and a working production agent. See [Pre-aggregate with cubes](/oss/guides/cubes) for the recipe.

## Schema linking through MDL

The same logic applies one level up. Raw warehouses give the agent ambiguous joins, near-duplicate tables (`customers` vs `customers_v3` vs `loyalty_v3`), and column names that overlap across schemas. MDL collapses that to one canonical surface.

When the agent asks "top customers by revenue":

1. Memory retrieves the `customers`, `orders`, and `revenue` models — not the legacy tables.
2. MDL exposes the approved `orders_customers` relationship — the agent does not invent a join.
3. If `revenue` is a calculated field on `customers`, the agent uses it instead of hand-writing `SUM(amount) - SUM(refunds)`.

Schema linking is not a model capability — it is a context structure that lets the model link correctly.

## Error recovery has a layer

When a query fails, the agent runs two diagnoses in order:

| Layer | Tool | Symptom | Likely fix |
|---|---|---|---|
| **MDL** | `wren dry-plan` fails | Wrong model/column reference, missing relationship, malformed CTE | Update MDL or fix the agent's SQL against MDL |
| **Database** | `dry-plan` succeeds but execution fails | Type mismatch, permission error, dialect issue | Profile/connection fix, not an MDL issue |

This split is small but decisive. Without it, every failure looks the same and the agent retries blindly.

## What "correctness as a system" means in practice

A correctness system is a stance, not a checkbox. Wren AI takes it seriously by:

- Storing context as **explicit artifacts** (MDL, instructions, queries, memory) — reviewable, versionable, Git-friendly
- Exposing every step as a **primitive** the agent can compose
- Keeping the **trace inside the agent's reasoning**, not in another product UI
- Refusing to ship a single "trust me" feature in place of the six pillars

You compose the correctness system your business needs. Wren AI ships the parts.

## See also

- [Architecture](/oss/reference/architecture) — how the pieces fit together under the hood
- [Pre-aggregate with cubes](/oss/guides/cubes) — the recipe for the cube primitive
- [Refine answer quality](/oss/guides/refine) — the recipe for closing the loop with memory and instructions
