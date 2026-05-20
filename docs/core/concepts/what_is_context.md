# What is context?

Context is the difference between an agent that can see your database and an agent that can understand your business.

A schema tells an agent that a table has columns. Context tells it which table is canonical, what the columns mean, which joins are approved, which definitions your company trusts, and what has worked before.

That distinction matters because AI agents do not fail on business data only because they are not smart enough. They fail because the meaning they need is scattered across warehouses, dashboards, SQL files, docs, decks, Slack threads, and people's heads.

Wren AI exists to turn that scattered meaning into an open, machine-readable context layer that humans, agents, dashboards, and applications can share.

## Why schema is not enough

Your agent sees schema. It reads column names, catches types, and may even parse semantic-layer YAML. But schema does not tell the whole story:

- `status = 4` means refunded
- `loyalty_v3` is the table your team actually uses
- "monthly active users" excludes service accounts
- "Project Lighthouse" maps to `campaign_id = 4172`
- some joins are approved, while others produce misleading numbers
- some questions should be clarified before any SQL is written

Without that context, the agent guesses. It picks a plausible table, writes plausible SQL, and returns a plausible answer. The demo may look fine. Production is where the missing meaning shows up.

**AI agents over business data are bottlenecked on context, not on intelligence.**

## The five layers of context

For an agent to answer real business questions on real company data, it needs five layers of context:

| Layer | What it answers | Examples | Status |
| --- | --- | --- | --- |
| **Structural** | What data exists? | Tables, columns, types, keys, relationships | Ships today |
| **Semantic** | What does the data mean? | Models, metrics, calculated fields, enum labels, canonical tables | Ships today |
| **Business** | What does this company mean? | Active customer, revenue, churn, internal project names, team-specific definitions | Ships today |
| **Operational** | How should this data be used safely? | Approved join paths, sanctioned queries, query-time governance, things never to compute | In active development |
| **Behavioral** | What worked before? | Successful natural-language-to-SQL pairs, examples, feedback, memory | In active development |

The first layer lets an agent read the database. The next two layers let it understand the business. The last two layers help it act safely and improve over time.

Together, these layers form the context layer.

## Context vs. semantic layer

A semantic layer is one important part of context. It defines business-facing models, relationships, calculations, and reusable logic so people and tools do not have to query raw tables directly.

A context layer is broader. It includes the semantic layer, then adds the knowledge an autonomous agent needs to behave well in the real world:

- which definitions are trusted
- which tables should be preferred
- which values mean what
- which joins are allowed
- when to ask a clarification
- which past examples should guide the next query
- how to validate, retry, repair, and evaluate generated SQL

Traditional semantic layers were designed mostly for dashboards and BI workflows. Wren AI is designed for a world where agents, applications, and humans all need the same trusted answer through different interfaces.

## How Wren AI represents context

Wren AI does not treat context as a single prompt or a hidden product feature. It stores context in explicit, reviewable pieces.

### MDL: the semantic contract

[Modeling Definition Language (MDL)](/oss/concepts/what_is_mdl) is the core semantic contract. It describes models, relationships, calculated fields, views, and business-facing structure in files your team can read and version.

MDL helps an agent map a question like "top customers by revenue" to the right models, joins, and calculations instead of reconstructing logic from raw warehouse structure.

### Instructions: business and operational guidance

Project instructions capture guidance that may not belong in a model definition: preferred terminology, default filters, table selection rules, caveats, and policies the agent should follow.

This is where business meaning starts to become operational. The agent is not only told what exists; it is told how your team expects the data to be used.

### Queries and memory: examples that compound

Most text-to-SQL systems treat every question like the first question. Wren AI adds a [memory layer](/oss/concepts/memory_system) so successful work can improve future work.

Memory has two jobs:

- **Schema context retrieval** - index MDL and instructions, then retrieve the relevant models, columns, relationships, and guidance for each question.
- **Query recall** - store confirmed natural-language-to-SQL pairs so similar future questions can use proven examples.

This turns usage into a learning loop. The context layer becomes more useful as your team asks, corrects, and confirms more questions.

### Skills: repeatable agent workflows

[Skills](/oss/reference/skills) give AI coding agents structured workflows for working with Wren AI. Instead of asking an agent to improvise every step, skills guide it through repeatable actions such as onboarding, generating MDL, validating context, and querying safely.

Skills matter because context is not only data. Context is also procedure: when to inspect, when to validate, when to ask, when to store, and when to stop.

## What context unlocks

When context is explicit and shared, the same governed layer can serve many surfaces:

- **AI agents** can query business data without inventing joins or metrics.
- **Data teams** can keep definitions in version-controlled files instead of scattered prompts and dashboard settings.
- **Business users** can get answers that trace back to approved models and definitions.
- **Product teams** can embed analytics into customer-facing apps without building a one-off data logic layer.
- **Platform teams** can give agents access to data through a narrower, more governable surface.

The end state is not just faster answers. It is faster answers that your team can trust.

## Correctness needs a system

Context is the foundation, but correctness still requires a system around it.

Reliable text-to-SQL depends on several primitives working together:

- **Schema linking** - find the right models and columns for the question.
- **Value profiling** - understand what values actually appear in the data.
- **Ambiguity detection** - know when the question needs clarification.
- **Generation trace** - show how the answer was built.
- **Retry and repair** - recover when the first attempt fails.
- **Eval** - detect regressions as definitions and schemas change.

Wren AI exposes these as primitives the agent can orchestrate instead of hiding correctness inside a closed product. See [How does Wren AI keep agents from hallucinating?](/oss/concepts/correctness) for the deeper view and [Architecture](/oss/reference/architecture) for the technical breakdown.

## Where context comes from

The first version of context usually comes from the database. Wren AI can scaffold MDL from tables, columns, types, and relationships so the agent has a working structural and semantic layer quickly.

The deeper context comes from everywhere else:

- analyst-written SQL
- business glossaries
- metric definitions
- onboarding docs
- product specs
- decks and strategy docs
- past questions and accepted answers
- human corrections and review

That is why Wren AI is designed around the workflow **scaffold fast, then enrich deep**. Start with the structure, then bring in the business meaning that makes the answers trustworthy.

## In short

- **Schema** tells an agent what exists.
- **Semantic layer** tells an agent what the data means.
- **Context layer** tells an agent how the business uses the data, how to act safely, and what has worked before.

Wren AI is the open context layer for AI agents: portable, inspectable, versionable, and shared across every agent and app that needs trusted business data.
