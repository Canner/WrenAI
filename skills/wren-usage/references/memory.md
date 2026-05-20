# Wren Memory — When to index, context, store, and recall

This reference covers the decision logic for each memory command. The main workflow is in the parent SKILL.md.

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

### Cube schema items

When the MDL defines cubes, `wren memory index` emits these additional schema items:

- `cube:<cube_name>` — cube overview (base object, measure list, dimension list)
- `measure:<cube>.<measure_name>` — each measure (with expression and type)
- `cube_dimension:<cube>.<dimension_name>` — each dimension
- `time_dimension:<cube>.<time_dim_name>` — each time dimension

These items are reachable via `wren memory fetch "<question>"`. For aggregation
questions like "revenue by month", cube schema items typically rank higher than
model columns because they match the aggregation intent more directly — then
the agent should follow up with `wren cube describe <cube>` and `wren cube query`
rather than hand-writing `GROUP BY` SQL.

`wren memory describe` also adds a cube section that lists each cube's measures,
dimensions, time dimensions, and hierarchies in markdown.

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

## Housekeeping

```bash
wren memory status              # path, table names, row counts
wren memory reset --force       # drop everything, start fresh
```

All memory commands accept `--path DIR` to override the default storage directory (`<project>/.wren/memory/`, falling back to `~/.wren/memory/` outside a project).
