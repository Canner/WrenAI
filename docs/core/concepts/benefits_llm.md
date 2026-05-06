# Why Wren AI Core helps AI agents

Wren AI Core gives AI agents a reliable way to understand business data before they generate SQL or answer questions. Instead of asking an LLM to infer meaning directly from raw tables and column names, Wren AI Core provides structured business context through MDL, relationships, metrics, and governed access patterns.

This matters because most failures in text-to-SQL systems do not come from SQL syntax alone. They come from missing context: unclear business definitions, ambiguous joins, inconsistent metric logic, and access to the wrong data. Wren AI Core reduces those failures by acting as an open context layer between AI agents and your data sources.

## What Wren AI Core provides to LLM workflows

### 1. Shared business context

MDL captures the meaning of your data in a form that both humans and AI agents can use. It defines:

- business entities
- relationships between models
- reusable calculations and aggregations
- curated dataset structure

With that context in place, an agent has a better chance of mapping a question like "top customers by revenue" to the right models, joins, and metrics.

### 2. More reliable planning for text-to-SQL

LLMs are good at pattern matching, but they are weaker when a query depends on domain-specific modeling rules. Wren AI Core improves planning by giving the agent explicit structure instead of forcing it to reconstruct business logic from raw schema alone.

This helps reduce:

- incorrect joins
- misuse of similarly named columns
- duplicated metric definitions
- brittle query generation based on incomplete schema interpretation

### 3. Better context for RAG and agent memory

RAG systems work best when the retrieved context is structured, relevant, and grounded in how the business actually defines data. Wren AI Core gives retrieval systems higher-quality context by exposing modeled entities, documented relationships, and reusable logic instead of only raw database metadata.

This makes it easier for an agent to retrieve the right context for:

- question answering
- SQL generation
- follow-up analysis
- multi-step agent workflows

### 4. Consistent answers across tools and agents

When multiple AI agents, MCP clients, or applications access the same modeled context, they can reason from the same definitions. That consistency is important for teams that want a single place to define how metrics, dimensions, and relationships should behave.

Instead of each agent inventing its own interpretation, Wren AI Core helps standardize the context they operate on.

### 5. Governed access to data

AI systems should not have unlimited freedom to reference every object in a warehouse. Wren AI Core helps narrow and structure what an agent can work with by operating against modeled data definitions rather than arbitrary warehouse exploration alone.

That improves safety and governance by:

- limiting the working surface area
- making approved objects explicit
- preserving business logic in a reviewable form
- supporting controlled query generation between agents and data sources

### 6. Memory and self-learning

Most text-to-SQL systems treat every question as if it were the first. Wren AI Core breaks that pattern with a built-in [memory layer](../guides/memory.md) that learns from successful queries and gets better over time.

The memory system works at two levels:

- **Schema context retrieval** — instead of dumping the full schema into every prompt, the memory layer indexes your MDL and retrieves only the relevant models, columns, and relationships for each question. For small schemas it returns the full text; for large schemas it uses embedding search to find the right fragments.

- **Query recall** — every confirmed NL-SQL pair is stored as a few-shot example. When a similar question comes in later, the agent retrieves past queries as patterns to adapt rather than generating SQL from scratch. This turns user interactions into training data — the more questions you ask, the more accurate future answers become.

This self-learning loop is what separates a static semantic layer from an adaptive one. A traditional text-to-SQL pipeline has a fixed accuracy ceiling determined by the LLM's ability to interpret schema. With memory, that ceiling rises with usage: domain-specific vocabulary, unusual join patterns, and business-specific aggregation rules all get captured as confirmed examples that guide future generation.

The practical effect is fewer wrong answers over time — without retraining a model or writing custom prompts.

## Why this is important for AI agents

AI agents need more than schema access. They need context they can plan with.

Wren AI Core is designed for that layer of the stack: it turns raw warehouse structure into usable business context, exposes that context through MCP-friendly workflows, and helps agents generate more accurate, explainable, and governable data interactions.

If you are building AI-native analytics, text-to-SQL experiences, or agent workflows over enterprise data, Wren AI Core helps bridge the gap between raw data systems and trustworthy agent behavior.
