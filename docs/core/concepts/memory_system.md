# The memory system

Wren AI's memory layer is the second of five layers of context — the place where successful natural-language-to-SQL pairs, prior interactions, and user feedback accumulate so the agent gets better at querying your data the more it is used.

Memory is local. It is stored under `.wren/memory/` in your project directory, indexed with [LanceDB](https://lancedb.com/), and never leaves your machine unless you commit it to a shared Git repository.

## What lives in memory

- **NL-SQL pairs** — `("How many customers placed more than one order?", "SELECT ... FROM customers ...")` — stored when an agent runs a query that succeeds.
- **Pinned business questions** — questions you mark as canonical examples; these are weighted higher during recall.
- **Schema and column descriptions** — extracted from your MDL so retrieval can match both questions and structure.
- **Instructions** — content from `instructions.md` is indexed alongside the rest so retrieval can surface relevant rules.

## How recall works

When the agent needs to answer a new question, it first asks the memory layer for the most relevant context:

1. `wren memory fetch --query "..."` returns the most likely tables, columns, and relationships
2. `wren memory recall --query "..."` returns the most similar past NL-SQL pairs
3. The agent reads both and uses them as the grounding for its SQL generation

The more queries you and your team run, the more reliable recall becomes.

## When to re-index

Memory is automatically updated when you store a new pair (`wren memory store`), but the full LanceDB index is only rebuilt when you run `wren memory index`. Re-index after:

- bulk-editing `instructions.md`
- changing model descriptions in `models/*/metadata.yml`
- importing a large batch of seed NL-SQL examples

See `wren memory --help` for the full set of commands.
