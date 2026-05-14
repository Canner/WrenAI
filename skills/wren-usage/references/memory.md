# Wren Memory — When to index, context, store, and recall

This reference covers the decision logic for each memory command. The main workflow is in the parent SKILL.md.

**Prerequisite:** every command in this file requires the `memory` extra (`pip install "wren-engine[memory]"`) and therefore only applies when `MEMORY_AVAILABLE = true` from Preflight Step 3a. If memory isn't installed, the entire `wren memory` subcommand group is missing — see the no-memory paths in SKILL.md.

For exact flags, prefer `wren memory <subcommand> --help` over memorizing this file.

---

## Schema context: `fetch` and `describe`

| Command | When to use |
|---------|-------------|
| `wren memory fetch -q "..."` | Default. Auto-selects full text (small schema) or embedding search (large schema) based on a 30K-char threshold. |
| `wren memory fetch -q "..." --type T --model M` | When you need filtering (forces search strategy on large schemas). |
| `wren memory describe` | When you want the full schema text and know it is small. |

The hybrid strategy works like this:
- Below 30K characters (~8K tokens): returns the entire schema as structured plain text — the LLM sees complete model-to-column relationships, join paths, and primary keys
- Above 30K characters: returns embedding search results — only the most relevant fragments

CJK-heavy schemas switch to search sooner (~1.5 chars per token vs 4 for English), which is the safe direction.

Override with `--threshold`:
```bash
wren memory fetch -q "revenue" --threshold 50000   # raise for larger context windows
```

---

## Indexing: `wren memory index`

**When to index:**
- After updating model YAML files and rebuilding (`wren context build`)
- When `wren memory status` shows `schema_items: 0 rows`
- When `wren memory fetch` returns stale results (references deleted models)

**When NOT to index:**
- Before every query — indexing is expensive, do it once per MDL change
- When only using `describe` or `fetch` with full strategy — those read the MDL directly

```bash
wren memory index
```

---

## Storing queries: `wren memory store`

**Store by default** when a query executes successfully and there is a clear natural language question. The default is to store, not to wait for explicit confirmation.

**Store (default):**
- Query executed successfully, user confirmed the result is correct
- Query executed successfully, user continued with a follow-up (implicit confirmation)
- Query executed successfully, user said nothing but the question had a clear NL description

**Do NOT store when:**
- The query failed or returned an error
- The user said the result is wrong or asked to fix it
- The query is exploratory / throwaway (`SELECT * FROM orders LIMIT 5`) — the CLI auto-detects these
- There is no natural language question — just raw SQL
- The user explicitly asked not to store it

```bash
wren memory store \
  --nl "top 5 customers by revenue last quarter" \
  --sql "SELECT c_name, SUM(o_totalprice) AS revenue ..." \
  --datasource postgres
```

The `--nl` value should be the user's original question, not a paraphrase.

---

## Recalling queries: `wren memory recall`

**When to recall:**
- Before writing SQL for a new question, especially complex ones
- When the user asks something similar to a past question

```bash
wren memory recall -q "monthly revenue by category" --limit 3
```

Use results as few-shot examples: adapt the SQL pattern to the current question.

---

## Full lifecycle example

```
Session start:
  1. wren memory status → if schema_items is 0: wren memory index

User asks a question:
  2. wren memory recall -q "<question>" --limit 3
  3. wren memory fetch -q "<question>"
  4. Write SQL using recalled examples + schema context
  5. wren --sql "..."

After execution:
  6. Show results to user
  7. Store by default → wren memory store --nl "..." --sql "..."
     User says wrong → fix SQL, do NOT store
     Query failed → do NOT store
     Exploratory query → do NOT store (CLI auto-detects)
```

---

## Managing stored pairs

Pair management commands exist for inspection, sharing, and pruning. Don't use them in the default question-answering flow.

| Command | When to use |
|---------|-------------|
| `wren memory list [--source seed\|user\|view] [-n N] [--offset N]` | Browse what's currently stored. Useful for debugging "did my store call land?" or auditing seed quality. |
| `wren memory forget --id <ID> [--id <ID> ...] --force` | Remove specific bad pairs. **`--force` is required for headless agents** — without it the CLI still asks for confirmation, which hangs non-TTY callers. Pass row IDs from `list`. |
| `wren memory forget --source seed --force` | Drop all pairs of one source (e.g. wipe outdated seed pairs before re-indexing). |
| `wren memory forget` (no flags) | Interactive checkbox UI — requires `wren-engine[interactive]`. Headless agents should prefer `--id ... --force`. |
| `wren memory dump [--source S] [-o file]` | Export pairs to YAML. Default target is `<project>/queries.yml` if inside a project, otherwise stdout. Use to commit curated pairs to a repo. |
| `wren memory load <file> [--upsert] [--overwrite] [--dry-run]` | Import pairs from YAML. `--dry-run` validates without writing. `index` already auto-loads `queries.yml`, so explicit `load` is for ad-hoc imports. |

## Housekeeping

```bash
wren memory status              # path, table names, row counts
wren memory reset --force       # drop everything, start fresh
```

All memory commands accept `--path DIR` to override the default storage directory (`<project>/.wren/memory/`, falling back to `~/.wren/memory/` outside a project).

---

## Common misuse to avoid

- **Re-indexing every query.** `wren memory index` is expensive. Run it once after MDL changes, not before every question. The skill's Workflow 4 covers when it's actually needed.
- **Echoing the stderr store hint.** After `wren --sql ...`, the CLI prints `# To save this query: wren memory store --nl '...' --sql '...'` to stderr. The NL there is a placeholder. Construct the `store` call yourself using the user's actual question.
- **Storing exploratory queries manually.** The CLI auto-classifies queries like `SELECT * FROM t LIMIT N` as exploratory and skips the store hint. Don't try to "rescue" them by calling `store` directly — they're not worth few-shot retrieval.
- **Repeated `fetch` + `recall` for the same question.** One `fetch` per question covers schema context; one `recall` covers few-shot examples. Calling them three times each before writing SQL is wasted tokens.
- **Calling `wren memory <anything>` after Preflight returned `MEMORY_AVAILABLE = false`.** Every call will fail with "No such command 'memory'". Switch to `wren context show` for schema, and don't try to recall/store at all.
- **Using `forget` in interactive mode from a non-TTY agent.** Use `--id <ID> --force` for headless removal — `--id` alone still triggers a confirmation prompt. The interactive checkbox UI also needs the `interactive` extra to be installed.
- **Re-`load`ing `queries.yml` after `index`.** `wren memory index` already auto-loads `queries.yml` from the project root (unless `--no-queries`). Manual `load` is only for files outside the project.
