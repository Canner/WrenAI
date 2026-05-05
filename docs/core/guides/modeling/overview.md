# Overview

## Data modeling in Wren Engine

Wren Engine uses Modeling Definition Language (MDL) to describe business data in a structured, queryable form. Modeling is how you turn physical tables and raw schemas into context that can be reused by SQL clients and AI agents.

In practice, the modeling layer defines:

- which datasets are exposed
- how tables relate to each other
- which calculations should be reused
- which query interfaces should be published as stable objects

This guide provides a high-level map of the core modeling primitives in Wren Engine.

## Core modeling objects

### Model

A **Model** is the primary building block in MDL. It represents a logical dataset backed by a physical table or query definition.

Use a model when you need to:

- expose a curated set of columns
- rename physical fields into business-facing names
- define primary keys
- attach relationships to other models
- define calculated fields on top of source columns

Models are the foundation for the rest of the modeling system.

See [Model](./model.md).

### Relationship

A **Relationship** defines how two models are connected. Wren Engine uses relationship metadata to plan joins and enable relationship-aware expressions.

Use a relationship when you need to:

- navigate from one model to another
- define reusable join logic once
- support calculated fields that reference related models
- preserve consistent join behavior across queries

Relationships are especially important for context-aware querying, because they encode how business entities connect to each other.

See [Relationship](./relation.md).

### Calculated field

A **Calculated Field** is a model column whose value is derived from an expression rather than read directly from the underlying source.

Use a calculated field when you need to:

- define reusable business logic once
- derive values from existing columns
- reference fields on related models
- reduce repeated SQL across downstream queries

Calculated fields let you move commonly repeated logic into the modeling layer instead of rewriting it in every query.

Calculated fields are defined in [Model](./model.md#calculated-columns) definitions.

### View

A **View** is a named SQL statement stored in the MDL. It behaves like a virtual table and can be queried by name.

Use a view when you need to:

- publish a reusable query result
- expose a filtered or aggregated dataset
- compose queries across multiple models
- provide a stable interface for downstream consumers

Views are useful when the object you want to expose is query-shaped rather than column-modeled.

See [View](./view.md).

### Memory

The **Memory** layer is a LanceDB-backed semantic index that gives AI agents targeted schema context and few-shot query examples — without sending the entire schema in every prompt.

Use memory when you need to:

- provide relevant schema context to an AI agent per question
- store confirmed NL-SQL pairs as few-shot examples for future queries
- improve query accuracy over time as more examples are stored

Memory sits alongside the modeling layer: models define *what* the data looks like, memory helps agents *find* the right parts of it.

See [Memory](../memory.md).

## Choosing the right object

Use this rule of thumb:

- Use a **Model** to expose a business-facing dataset.
- Use a **Relationship** to define how models join to each other.
- Use a **Calculated Field** to define reusable expression logic inside a model.
- Use a **View** to publish a reusable query result.
- Use **Memory** to give AI agents targeted context and learning from past queries.

## Why this matters

Good modeling is not only about query convenience. It is how Wren Engine turns raw warehouse structure into durable business context. Once models, relationships, and calculations are defined centrally, queries become easier to write, easier to review, and more consistent across users, applications, and AI agents.
