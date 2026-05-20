# What is context?

Your AI agent does not know what your data means. It reads schemas. It catches column names. It even reads your semantic-layer YAML. But it misses the things that actually decide whether an answer is right — that `status = 4` means refunded, that `loyalty_v3` is the table your team actually uses, that "monthly active users" excludes service accounts, that "Project Lighthouse" was renamed to `campaign_id = 4172` six months ago in a doc nobody linked to the warehouse.

So it picks the wrong table. It writes confident, plausible, wrong SQL. The demo looks fine. The pilot looks fine. Production is where it breaks.

**AI agents over business data are bottlenecked on context, not on intelligence.** Wren AI exists to close that gap.

## The five layers of context

For an AI agent to answer real business questions on real company data, it needs five layers of knowledge — not one.

1. **Structured business semantics.** What your schema means in business terms — display names, descriptions, synonyms, enum labels, relationships, metrics, business rules. Today this lives in MDL.

2. **Examples and memory.** The successful NL-SQL pairs, prior interactions, user feedback, and pinned business questions that teach the agent what *correct* looks like in your specific environment. Today this lives in the memory layer.

3. **Governance and skills.** Access control, read-only enforcement, audit, query gating, agent skills, default query patterns. What makes context safe to expose to an autonomous system. Today this lives in profiles, skills, and the CLI's safety primitives.

4. **Unstructured corporate knowledge.** The docs, emails, chat threads, wikis, and SOPs where business definitions and project codenames live before they ever appear in a table. *(Actively in development — `wren-enrich-context` skill in auto-pilot mode.)*

5. **Cross-modal alignment.** The bridge between layer 4 and layer 1 — mappings from "Project Lighthouse" to `campaign_id = 4172`, from "Northstar metric" to a CTE the analytics team agreed on last quarter. *(Actively in development.)*

Layers 1–3 ship today. Layers 4–5 are gated by a synthetic-corpus validation experiment before they reach alpha.

## Context vs. semantic layer

The traditional **semantic layer** was the industry's answer to text-to-SQL for *dashboards*. The audience was a human — or a BI tool that tolerated a slow setup because the payoff lived in long-lived charts.

In an AI-native world the audience is different: an agent, a coding assistant, an application that needs structured context in real time. Agents do not click buttons. Agents do not consult a metric catalogue. They need context delivered as primitives they can reason over — and they need it fast enough that the journey from "connect a database" to "first correct answer" is minutes, not weeks.

**Wren AI is a context layer.** The distinction from a semantic layer is small in words and large in consequence: a context layer is a *superset* of a semantic layer, adding the four other layers an autonomous system needs to act correctly.

## What Wren AI gives AI workflows

The five layers above turn into concrete benefits for any agent built on top of them:

### Shared business context (layer 1)

MDL captures the meaning of your data in a form both humans and AI agents can use — business entities, relationships, reusable calculations, curated dataset structure. An agent can map "top customers by revenue" to the right models, joins, and metrics without reconstructing logic from raw schema.

### More reliable text-to-SQL planning (layers 1 + 5)

LLMs are good at pattern matching, weak at domain-specific modeling rules. Explicit structure cuts incorrect joins, misuse of similarly named columns, duplicated metric definitions, and brittle query generation based on incomplete schema interpretation.

### Better RAG context (layers 1 + 2)

RAG works when retrieved context is structured, relevant, and grounded in how the business actually defines data. Wren exposes modeled entities, documented relationships, and reusable logic — higher-quality fuel for retrieval than raw database metadata.

### Consistent answers across tools and agents (layer 1)

When multiple AI agents or applications access the same modeled context, they reason from the same definitions. One place to define how metrics, dimensions, and relationships behave; consistency by design.

### Governed access to data (layer 3)

AI systems should not have unlimited freedom over every object in a warehouse. Operating against modeled data definitions instead of arbitrary warehouse exploration limits the working surface area, makes approved objects explicit, and keeps business logic in a reviewable form.

### Memory and self-learning (layer 2)

Most text-to-SQL systems treat every question as if it were the first. Wren AI breaks that pattern with a built-in [memory layer](/oss/concepts/memory_system) that learns from successful queries:

- **Schema context retrieval** — the memory layer indexes your MDL and retrieves only the relevant models, columns, and relationships for each question. Embedding search for large schemas; full text for small.
- **Query recall** — every confirmed NL-SQL pair is stored as a few-shot example. The more questions you ask, the more accurate future answers become — without retraining a model or writing custom prompts.

A traditional text-to-SQL pipeline has a fixed accuracy ceiling determined by the LLM. With memory, that ceiling rises with usage.

## Why this cannot be solved one feature at a time

The temptation is to treat correctness like a setting. Add a metadata field. Add 100 examples. Flip a switch.

That does not work. Correctness is the result of [six pieces working together](/oss/concepts/architecture): schema linking, value profiling, ambiguity detection, generation trace, retry and repair, and eval. Miss any one of them and the agent fails in that exact gap.

That is why we build context as a system, not as a feature — and why Wren AI exposes **primitives**, not a closed product. The agent does the orchestration. The trace lives where the agent's reasoning lives.

## In short

- **Context** = the full set of information an AI agent needs to operate reliably on business data.
- **Semantic layer** = one slice of that picture (layer 1).
- **Context layer** = all five layers, designed for autonomous agents instead of humans clicking buttons.

That is the shift Wren AI is built around.
