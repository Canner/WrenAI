# What is Modeling Definition Language (MDL)?

Modeling Definition Language (MDL) is the way Wren AI Core describes business data in a structured, machine-readable form. It defines models, relationships, calculations, and views so that both humans and AI agents can work from the same business context.

Instead of exposing only raw tables and columns, MDL gives your data a logical shape. It tells Wren AI Core how datasets relate to each other, how business metrics should be defined, and how analytical logic should be reused across queries.

## Why MDL matters

Raw schemas are not enough for reliable analytics or AI-driven querying. A warehouse may contain hundreds of tables, inconsistent naming, and business logic scattered across dashboards or SQL scripts. MDL helps centralize that logic into a form that is easier to understand, review, and execute.

With MDL, Wren AI Core can provide AI agents with the context they need to:

- understand business entities and terminology
- follow defined relationships between datasets
- reuse approved calculations and aggregations
- generate more reliable SQL from natural language

## What MDL defines

MDL is used to model the business-facing structure of your data. Depending on your use case, it can define:

- models that reference physical tables or query results
- columns and their expressions
- relationships between models
- calculated fields and reusable metrics
- views built on top of modeled datasets

This gives Wren AI Core a consistent representation of how your data should behave, rather than forcing every user or agent to rediscover that logic from scratch.

## How MDL helps AI agents

AI agents perform better when they can reason over structured context instead of guessing from raw schema alone. MDL helps by giving Wren AI Core an explicit description of your business layer.

That improves agent behavior in several ways:

- better mapping from business questions to data models
- fewer incorrect joins and ambiguous field selections
- more consistent metric definitions across queries
- clearer grounding for text-to-SQL and RAG workflows

In this sense, MDL is one of the core building blocks that lets Wren AI Core act as an open context layer for AI agents.

## Benefits of MDL

### 1. Shared definitions

MDL creates a single, reviewable place to define business logic. Teams can align on the meaning of models, relationships, and metrics instead of duplicating that logic across prompts, dashboards, and SQL files.

### 2. Reusable modeling logic

Once a relationship or calculation is defined in MDL, it can be reused across workflows. This reduces repeated SQL logic and makes analytical behavior more consistent.

### 3. Better collaboration

Because MDL is structured and explicit, it is easier for data teams to review, maintain, and improve over time. It also makes the business context more accessible to non-authors, including AI systems.

### 4. More reliable execution

Wren AI Core can plan and generate queries more reliably when it has modeled definitions to work from. This helps reduce errors caused by incomplete schema interpretation or one-off query logic.

### 5. A stronger foundation for agentic analytics

If you want AI agents to operate on business data safely and accurately, they need more than access. They need context. MDL gives Wren AI Core that context in a durable, portable form.

## In short

MDL is the modeling language that powers Wren AI Core. It turns raw data structures into usable business context, making analytics workflows easier to govern for people and easier to reason over for AI agents.
