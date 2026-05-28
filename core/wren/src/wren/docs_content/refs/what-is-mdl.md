# What is Modeling Definition Language (MDL)?

Modeling Definition Language (MDL) is the semantic contract at the center of Wren AI.

It is how you tell agents, applications, and humans what your business data means: which datasets exist, which fields are exposed, how entities relate, which calculations are reusable, and which query-shaped objects should be treated as stable interfaces.

Raw schemas describe storage. MDL describes meaning.

## Why MDL exists

Warehouses are optimized for systems that store data, not for people and agents trying to reason about the business.

A warehouse can tell an agent that a table has a column named `status`, but not that `status = 4` means refunded. It can expose `loyalty_v3`, but not explain that this is the canonical loyalty table. It can show foreign keys, but not always the join path your analytics team trusts.

Without MDL, every agent, dashboard, SQL script, and embedded analytics feature has to rediscover the same logic from raw structure. That leads to duplicated definitions, inconsistent metrics, brittle SQL, and answers no one fully trusts.

MDL makes the important parts explicit. It turns business logic into files your team can review, version, and share.

## MDL in the context layer

Wren AI is the open context layer for AI agents. MDL is the core layer where structural, semantic, and business meaning become machine-readable.

In the five-layer context model, MDL carries the first three layers:

| Context layer | How MDL helps |
| --- | --- |
| **Structural** | Defines the datasets, columns, types, keys, and relationships the agent can use. |
| **Semantic** | Gives raw warehouse objects business-facing names, descriptions, calculations, views, and cubes. |
| **Business** | Captures canonical tables, reusable metrics, relationship meaning, and agreed analytical interfaces. |

Operational guidance and behavioral memory live alongside MDL in project instructions, skills, and the memory layer. Together, they give agents the wider context they need to query safely and improve over time.

## What MDL defines

MDL models the business-facing shape of your data. A Wren project stores these definitions as readable YAML and compiles them into an engine-ready `target/mdl.json` manifest.

Core MDL objects include:

- **Models** - logical datasets backed by physical tables or SQL definitions.
- **Columns** - exposed fields, including renamed fields, expressions, primary keys, and calculated fields.
- **Relationships** - reusable join logic between models.
- **Calculated fields** - business logic defined once and reused across queries.
- **Views** - named SQL statements that behave like stable virtual tables.
- **Cubes** - structured aggregation objects with measures, dimensions, time dimensions, and hierarchies.

See the [MDL schema reference](/oss/reference/mdl) for the full field surface of every modeling object.

## MDL as a contract

The word contract matters.

MDL is not just documentation. It is the agreement between your data team, your agents, and your query engine.

- **For data teams**, MDL is a reviewable place to define business logic.
- **For agents**, MDL is the structured context used to choose models, joins, and calculations.
- **For applications**, MDL is a stable interface over changing warehouse structure.
- **For the engine**, MDL is the source of truth for planning modeled SQL against the underlying data source.

When the contract changes, you can review the diff. When a query runs, Wren AI can plan against the contract. When another agent joins the workflow, it does not need to learn the business from scratch.

## How MDL helps AI agents

AI agents are good at pattern matching, but raw schemas leave too much room for interpretation. MDL narrows that space.

With MDL, an agent can:

- map business questions to the right modeled datasets
- prefer canonical tables over legacy or staging tables
- follow defined relationships instead of inventing joins
- reuse approved calculations instead of creating one-off metrics
- query views and cubes as stable analytical interfaces
- ground retrieval and text-to-SQL planning in explicit business structure

The result is not magic accuracy. It is better grounding. MDL gives the agent fewer reasons to guess.

## Why files matter

MDL lives in files because business context should be portable.

Your definitions should not be trapped inside one BI tool, one prompt, or one vendor UI. They should be easy to inspect, commit, review, fork, and deploy across environments.

A Wren project separates the parts that should move with the project from the parts that belong to an environment:

- Models, views, relationships, cubes, and instructions live in the project and can be version controlled.
- Connection profiles live outside the project, so credentials and environment-specific settings do not leak into shared files.
- The compiled `target/mdl.json` is derived from source YAML and can be rebuilt.

See [Manage project](/oss/guides/manage_project) for the project structure and lifecycle commands.

## From raw schema to trusted context

MDL usually starts with scaffolding. The `wren-generate-mdl` skill can inspect a database, normalize types, detect structure, and generate an initial project so the agent can query through a modeled layer quickly.

That first pass is useful, but it is only the beginning. The deeper value comes when your team enriches the model:

- add descriptions and business names
- mark primary keys and relationships clearly
- define reusable calculations
- publish views for common analytical paths
- define cubes for governed aggregations
- hide or avoid fields that should not be exposed
- document canonical sources and business rules

This is the same philosophy as the broader Wren AI workflow: **scaffold fast, then enrich deep**.

## MDL and execution

MDL is not only metadata for prompts. Wren AI uses MDL during SQL planning.

When a query references modeled objects, Wren AI expands those models, relationships, calculated fields, and views into executable SQL for the target data source. The Rust semantic engine is the source of truth for how MDL semantics map to SQL.

This matters because agent reliability depends on more than generating SQL text. The query needs to be planned against the same definitions your team agreed on.

See [Architecture](/oss/reference/architecture) for how planning and execution work.

## In short

- **Schema** describes how data is stored.
- **MDL** describes how data should be understood and queried.
- **Context** combines MDL with instructions, memory, skills, and governance so agents can operate reliably.

MDL is the durable semantic contract for Wren AI: readable by humans, usable by agents, enforceable by the engine, and portable across every app that needs trusted business data.
