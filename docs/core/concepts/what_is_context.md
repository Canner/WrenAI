# What is context?

In Wren AI Core, context is the structured business understanding an AI agent needs in order to work with data correctly. It goes beyond raw schemas and table access. Context helps an agent understand what your data means, which sources to trust, how entities relate to each other, how metrics should be calculated, and what rules or guidance should shape its behavior.

For AI agents, this matters because answering a question is rarely just a SQL generation problem. The harder problem is knowing what the question means inside a business. Questions like "What is revenue growth last quarter?" depend on business definitions, trusted sources, time conventions, relationships, and sometimes team-specific instructions. Context is what makes those answers reliable.

## Why context matters for AI agents

AI agents often fail not because they cannot write SQL, but because they lack the business and operational grounding needed to plan correctly. A warehouse may contain many similar tables, overlapping metrics, legacy definitions, and tribal knowledge that never appears in a schema.

Context helps agents:

- understand business entities and terminology
- identify the right source of truth
- follow approved relationships and calculations
- apply business rules consistently
- generate more reliable answers across multi-step workflows

This is why Wren AI Core is positioned as an open context layer for AI agents: it helps turn raw data systems into usable context that agents can reason over.

## Context vs. semantics

Semantics and context are related, but they are not the same thing.

**Semantics** is about meaning. In data systems, semantics usually refers to the business meaning of entities, metrics, relationships, and attributes. For example, semantics defines what "revenue" means, how "customer" is modeled, or how two datasets should be joined.

**Context** is broader. It includes semantics, but also adds the surrounding information an agent needs to act correctly in real workflows.

Context can include:

- semantic definitions of metrics and entities
- source-of-truth guidance
- modeling rules and reusable calculations
- identity resolution across systems
- governance and access expectations
- operational instructions and tribal knowledge
- evolving business conventions over time

Put simply:

- semantics explains what data means
- context explains how an agent should use that meaning in practice

## Why context is broader than a semantic layer

A traditional semantic layer is valuable because it gives business definitions to data. It helps define metrics, entities, and relationships in a structured way. That is an important foundation.

But for AI agents, a semantic layer alone is often not enough. Agents also need to know which definitions are current, which systems are authoritative, what exceptions exist, and what instructions should apply in ambiguous situations.

This idea aligns with the argument in a16z's article [Your Data Agents Need Context](https://a16z.com/your-data-agents-need-context/): a modern context layer should be a superset of the traditional semantic layer, adding the business and operational grounding that autonomous agents need.

## What context includes in Wren AI Core

Wren AI Core builds context from structured modeling and execution primitives, including:

- MDL definitions for models, relationships, calculations, and views
- business-facing dataset structure
- reusable analytical logic
- governed access patterns between agents and data sources
- MCP-friendly interfaces for connecting that context to AI agents
- a [memory layer](../guides/memory.md) that indexes schema context and stores confirmed NL-SQL pairs, enabling agents to retrieve relevant context per question and learn from past interactions

Together, these give agents a clearer and more durable understanding of how to reason over data. Notably, the memory layer makes context **adaptive** — it grows with usage. As more queries are confirmed and stored, the agent's ability to answer domain-specific questions improves without changes to the MDL or the underlying model.

## In short

Context is the full set of information an AI agent needs to operate reliably on top of business data. Semantics is one part of that picture, but context goes further by combining meaning with source selection, modeling logic, governance, and practical instructions.

That is the shift from semantic layer thinking to context thinking: not just defining what data means, but packaging the full business understanding that agents need to act correctly.
