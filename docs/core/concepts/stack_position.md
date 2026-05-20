---
sidebar_label: Where does Wren AI sit in my stack?
---

# Where does Wren AI sit in my stack?

> Wren AI does not replace your warehouse, your transformation pipeline, or your existing semantic layer. It sits **between** your data infrastructure and the agents querying it, providing the context they need to do it safely.

## The short version

```text
┌──────────────────────────────────────────────────────┐
│   Your AI agents (Claude Code, Cursor, custom apps)  │
└────────────────────────┬─────────────────────────────┘
                         │  ask questions, get context
                         ▼
┌──────────────────────────────────────────────────────┐
│              Wren AI — open context layer            │
│   MDL · Memory · Skills · Governed execution         │
└────────────────────────┬─────────────────────────────┘
                         │  planned, governed SQL
                         ▼
┌──────────────────────────────────────────────────────┐
│   Your warehouse, transformation pipeline, files     │
│   (PostgreSQL, BigQuery, Snowflake, DuckDB, ...)     │
└──────────────────────────────────────────────────────┘
```

Three things sit above Wren AI: the **agents** that ask questions. Three things sit below: the **data infrastructure** that stores the answers. Wren AI is the layer in between that turns "I can see schema" into "I know what the business means."

## What it does NOT replace

**Your data warehouse.** Wren AI does not store rows. Your warehouse keeps storing rows. Wren AI sends planned SQL there for execution.

**Your transformation pipeline.** If you already model raw data into clean tables — dbt, custom Python, scheduled SQL — keep doing that. Wren AI reads the result, it does not own the upstream pipeline.

**Your existing semantic layer.** If you already have business-facing models, metrics, or a metric layer, Wren AI can layer on top to give agents the same definitions without rebuilding them. The MDL you author is the **agent-facing contract**; what you already have stays where it lives.

**Your BI or dashboard tool.** Wren AI is built for autonomous consumers (agents, scripts, embedded apps). Dashboards keep using whatever you already use.

## What it does provide

**The agent-facing context layer.** The five layers — structural, semantic, business, operational, behavioral — collected into one inspectable, version-controlled surface that any agent can query.

**A governed SQL plane.** The CLI plans modeled SQL into executable SQL, runs dry-plan / dry-run, applies access policies, and executes through your warehouse connectors. The agent does not need direct database credentials or unrestricted access.

**An agent-native interface.** Skills, an SDK for popular agent frameworks, and a CLI built to be driven by an LLM-based coding agent. None of it requires a new UI to maintain.

## Where Wren AI fits depending on what you already have

### You have no semantic layer

Wren AI can be your first one. The `wren-generate-mdl` skill scaffolds an MDL project from your warehouse schema in a few minutes. Enrich it over time with the grill / auto-pilot workflow.

### You have a transformation pipeline (dbt, Coalesce, in-house)

Keep it. Point Wren AI at the **output tables** of your pipeline. The MDL describes the agent-facing meaning of those tables — what columns to expose, which joins are approved, which calculations are reusable. The pipeline keeps owning ingestion and modeling logic. Wren AI owns the layer between modeled data and the agent.

### You have a semantic layer

Wren AI does not compete with it for the data team. It gives the **agents** the same definitions through a structure agents can read and reason about: MDL files, structured retrieval, memory of past answers, governed execution primitives. Think of it as the agent-native projection of the semantic layer you already use.

### You have multiple warehouses

Profiles separate connection credentials from project definitions. The same MDL project can be bound to dev / staging / prod profiles. The MDL stays portable; the profile carries the credentials.

## Where Wren AI does not fit

- **You only need a chat-driven BI app.** Wren AI is a primitive layer, not a chat UI. If you want a turnkey conversational dashboard, the commercial Wren AI product or another vendor will be a better fit.
- **You want zero schema modeling.** Even the scaffold step asks for some review. If "auto-magic with no review" is the requirement, no context layer will be honest with you.
- **You query mostly unstructured text.** Wren AI focuses on structured business data. RAG over docs is a separate problem.

## Why "layered, not replacing"

Replacing your stack to get an AI agent that queries it well is a fast way to make nobody happy. The pattern Wren AI was designed around is the inverse: **leave the existing stack in place, add one inspectable layer on top, give every agent the same governed surface**.

That is also why Wren AI is open source. Business context is too important to lock inside a vendor product — your MDL, examples, query history, and mapping decisions should live in your repo, under your team's review.

## See also

- [What does Wren AI mean by context?](./what_is_context.md) — the conceptual ground
- [Architecture](/oss/reference/architecture) — the technical stack inside Wren AI
- [Connect your data](/oss/guides/connect) — point Wren AI at your warehouse
- [Manage project](/oss/guides/manage_project) — multi-environment profile workflow
