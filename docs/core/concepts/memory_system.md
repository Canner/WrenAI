# The memory system

Memory is the behavioral layer of Wren AI's context system.

MDL tells an agent what your data means. Instructions tell it how your team wants that data used. Memory tells it what has worked before: which schema items were relevant, which SQL answered a similar question, and which examples your team has already confirmed.

Without memory, every question starts from zero. With memory, each accepted answer can make the next answer easier to ground.

## Why memory matters

Business questions repeat with small variations:

- "Top customers by revenue this month"
- "Top accounts by ARR this quarter"
- "Revenue by customer segment, excluding refunds"
- "Monthly active users, but only for paid workspaces"

An agent should not rediscover the same joins, filters, and metric definitions every time. It should be able to retrieve the relevant parts of the context layer and reuse proven examples.

That is what Wren AI memory provides.

## What memory stores

Memory is local to a Wren project. It is stored under `.wren/memory/`, indexed with [LanceDB](https://lancedb.com/), and never leaves your machine unless you choose to share or commit it.

The memory layer has two main collections:

| Collection | What it stores | Why it matters |
| --- | --- | --- |
| `schema_items` | Models, columns, relationships, views, cubes, and indexed instructions | Lets the agent retrieve the right context for a question without sending the entire project into the prompt. |
| `query_history` | Confirmed natural-language-to-SQL pairs | Gives the agent few-shot examples from your actual business, not generic examples. |

Memory may include:

- schema and column descriptions extracted from MDL
- relevant content from `instructions.md`
- successful natural-language-to-SQL pairs
- imported examples from `queries.yml`
- query history stored after successful agent workflows

## How memory is used

When an agent answers a question through Wren AI, memory usually participates before SQL is written:

```text
User question
  |
  |-- wren memory recall -q "..."  -> find similar accepted questions and SQL
  |-- wren memory fetch -q "..."   -> find relevant models, columns, relationships, and instructions
  |-- Agent writes SQL against MDL objects
  |-- Wren AI plans and executes the query
  |-- wren memory store            -> save confirmed NL-SQL pair
```

This loop gives the agent two kinds of grounding:

- **Relevant context** - the parts of the model and instructions that matter for this question.
- **Proven behavior** - examples of how similar questions were answered before.

## Memory is not a replacement for MDL

Memory does not define your semantic layer. MDL does.

Memory helps agents find and reuse context, but the durable contract still lives in project files: models, relationships, views, cubes, and instructions. If a definition is important enough to govern future behavior, put it in MDL or `instructions.md`, then re-index memory.

Think of memory as the retrieval and learning layer on top of the contract.

## What improves over time

A traditional text-to-SQL prompt has a fixed ceiling: the model sees the schema and tries its best.

Wren AI memory lets the system compound:

- common questions retrieve better examples
- recurring metrics reuse accepted SQL patterns
- schema retrieval becomes more targeted on large projects
- corrections can become future grounding instead of disappearing after the chat
- teams can seed memory with known-good `queries.yml` examples

The goal is not to memorize every answer. The goal is to make the agent better at finding the right context before it reasons.

## When to re-index

`wren memory store` adds a new confirmed NL-SQL pair to query history. But the schema and instruction index is rebuilt with:

```bash
wren memory index
```

Re-index after:

- editing model descriptions, columns, relationships, views, or cubes
- changing `instructions.md`
- importing or editing seed examples in `queries.yml`
- running a major context enrichment pass

See the [Refine answer quality](/oss/guides/refine) recipe and [CLI reference](/oss/reference/cli#wren-memory--schema--query-memory) for command details.

## Sharing memory

By default, `.wren/memory/` is local runtime state and is usually gitignored.

If your team wants to share confirmed examples, prefer exporting them to `queries.yml` with `wren memory dump`, reviewing them like source files, and loading them back into memory in each environment. This keeps the useful behavioral context portable without turning binary index files into the main collaboration surface.

## In short

- **MDL** defines the business meaning.
- **Instructions** define guidance and policy.
- **Memory** retrieves relevant context and recalls proven examples.

Memory is how Wren AI gets better with use while keeping the source of truth inspectable and versionable.
