# The memory system

Memory is the behavioral layer of Wren AI's context system.

MDL tells an agent what your data means. Instructions tell it how your team wants that data used. Memory tells it what has worked before: which schema items were relevant, which SQL answered a similar question, and which examples your team has already confirmed.

Without memory, every question starts from zero. With memory, each accepted answer can make the next answer, and the next dashboard, easier to ground. It is the retrieval half of the [learning loop](/oss/concepts/agent_learning): the loop writes knowledge down; memory finds it again when a similar question arrives.

## Why memory matters

Business questions repeat with small variations:

- "Top customers by revenue this month"
- "Top accounts by ARR this quarter"
- "Revenue by customer segment, excluding refunds"
- "Monthly active users, but only for paid workspaces"

An agent should not rediscover the same joins, filters, and metric definitions every time. It should be able to retrieve the relevant parts of the context layer and reuse proven examples.

That is what Wren AI memory provides.

## What memory stores

The **source of truth is markdown in your project**: confirmed natural-language-to-SQL
pairs live in `knowledge/sql/*.md`, and business rules in `knowledge/rules/`. These are
plain files you commit and review like any other source.

On top of that markdown, Wren builds a **derived index** for retrieval. With the optional
`memory` extra it's a [LanceDB](https://lancedb.com/) embedding index under `.wren/memory/`
(gitignored, rebuildable any time); without it, a dependency-free grep backend searches the
markdown directly. Either way the index is disposable — `knowledge/` is the durable layer.

The index covers two kinds of content:

| Content | Source | Why it matters |
| --- | --- | --- |
| Schema items — models, columns, relationships, views, cubes, business rules | MDL + `knowledge/rules/` | Lets the agent retrieve the right context for a question without sending the entire project into the prompt. |
| NL→SQL pairs | `knowledge/sql/*.md` | Gives the agent few-shot examples from your actual business, not generic examples. |

## With and without the `memory` extra

The source of truth is the same either way — only the retrieval engine differs:

| | With `memory` extra (LanceDB) | Without it (grep, default) |
| --- | --- | --- |
| NL→SQL `recall` | **Semantic** — embedding similarity, so paraphrases match (store *"monthly revenue"*, recall *"sales per month"*) | **Lexical** — token overlap + substring over `knowledge/sql/*.md`, read directly at query time. Paraphrases with no shared words won't match |
| Persistent index | LanceDB under `.wren/memory/` (built by `index`/`store`) | None — the markdown *is* the index, so `index` is a no-op |
| Schema search (`fetch`) | Available (embedding retrieval over schema items) | **Not available** — needs embeddings; large schemas should install the extra |

The grep backend is the zero-dependency fallback: it works out of the box and keeps
`store`/`recall` available, at lower recall quality. Install the extra (or set
`WREN_MEMORY_BACKEND=lancedb`) for semantic recall and schema search; nothing about your
`knowledge/` files changes when you switch.

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

Memory does not define your semantics. MDL does.

Memory helps agents find and reuse context, but the durable contract still lives in project files: models, relationships, views, cubes, and `knowledge/`. If a definition is important enough to govern future behavior, put it in MDL or `knowledge/rules/`, then re-index memory.

Think of memory as the retrieval and learning layer on top of the contract.

## What improves over time

A traditional text-to-SQL prompt has a fixed ceiling: the model sees the schema and tries its best. Memory removes that ceiling — each accepted answer becomes a retrievable example, schema retrieval grows more targeted as the project grows, and corrections persist instead of dying with the chat session. The full compounding loop, and where each artifact fits in it, is covered in [How does the agent learn from your context?](/oss/concepts/agent_learning).

The goal is not to memorize every answer. The goal is to make the agent better at finding the right context before it reasons.

## When to re-index

`wren memory store` writes the confirmed NL→SQL pair to `knowledge/sql/` and indexes it. The
schema/rules side of the index is rebuilt with:

```bash
wren memory index
```

Re-index after:

- editing model descriptions, columns, relationships, views, or cubes
- changing `knowledge/rules/`
- adding or editing pairs in `knowledge/sql/`
- running a major context enrichment pass

See the [Refine answer quality](/oss/guides/refine) recipe and [CLI reference](/oss/reference/cli#wren-memory--schema--query-memory) for command details.

## Sharing memory

Sharing is just committing `knowledge/`. The NL→SQL pairs in `knowledge/sql/*.md` are
plain, reviewable files — commit them and every environment picks them up; the next
`wren memory index` rebuilds the local index from them. The derived index under
`.wren/memory/` stays gitignored, because it's reproducible from the markdown rather than
the collaboration surface itself.

(Have an older project whose history is still in a LanceDB index? `wren memory export`
writes it out to `knowledge/sql/*.md` — see [Migration](/oss/reference/migration).)

## In short

- **MDL** defines the business meaning.
- **`knowledge/`** captures business rules and confirmed NL→SQL pairs — committed and reviewable.
- **Memory** is the derived index that retrieves relevant context and recalls proven examples.

Memory is how Wren AI gets better with use while keeping the source of truth inspectable and versionable.
