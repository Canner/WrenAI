# Memory

Wren Engine includes a **memory layer** — a LanceDB-backed semantic index that gives AI agents the context they need to write accurate SQL. Instead of sending the entire schema to an LLM on every question, the memory layer provides targeted context: relevant tables, columns, and past query examples.

## Why memory matters

Without memory, an AI agent must either:

- Receive the **full schema** in every prompt — works for small databases but quickly exceeds context limits
- Guess which tables are relevant — leads to hallucinated column names and wrong joins

The memory layer solves both problems by indexing the MDL schema and storing confirmed NL-SQL pairs. At query time it retrieves only what the agent needs.

## What gets indexed

The memory layer manages two collections:

| Collection | Contents | Source | Rebuildable? |
|------------|----------|--------|-------------|
| **schema_items** | Models, columns, relationships, views, instructions | MDL manifest + `instructions.md` | Yes — `wren memory index` |
| **query_history** | Natural-language → SQL pairs | Stored after successful queries | No — built up over time |

Both collections live in `<project>/.wren/memory/` (or `~/.wren/memory/` outside a project).

## Installation

The memory system requires the `memory` extra (included in `main`):

```bash
pip install "wren-engine[main]"    # recommended: memory + interactive + ui
pip install "wren-engine[memory]"  # memory only
```

## Indexing the schema

After creating or updating your MDL project, index the schema:

```bash
wren memory index
```

This parses the compiled `target/mdl.json`, generates local embeddings for every schema item, and stores them in LanceDB. Re-index whenever you change models, columns, relationships, or instructions:

```bash
wren context build
wren memory index
```

Check the index status:

```bash
wren memory status
# Path: /Users/you/my-project/.wren/memory
#   schema_items: 47 rows
#   query_history: 12 rows
```

## Fetching schema context

`wren memory fetch` is the primary way agents get schema context. It automatically picks the best retrieval strategy based on schema size:

| Schema size | Strategy | What the agent sees |
|-------------|----------|---------------------|
| Below 30,000 chars (~8K tokens) | **Full text** | Complete schema with all model-column relationships, join paths, and primary keys |
| Above 30,000 chars | **Embedding search** | Top-k most relevant fragments for the query |

```bash
wren memory fetch -q "customer order price"
wren memory fetch -q "revenue" --type column --model orders
wren memory fetch -q "日期" --threshold 50000 --output json
```

### Why hybrid?

Small schemas give better results as full text — the LLM sees the complete structure rather than isolated fragments. Large schemas don't fit in a single prompt, so embedding search retrieves only what's relevant.

The threshold is measured in characters (not tokens) because character counting is free. The 4:1 chars-to-tokens ratio holds for English; CJK text compresses less (~1.5:1), so CJK-heavy schemas switch to search sooner — the conservative direction.

Override with `--threshold`:

```bash
wren memory fetch -q "revenue" --threshold 50000   # raise for larger context windows
```

### Full schema without search

`wren memory describe` prints the entire schema as structured plain text — no embeddings or LanceDB required:

```bash
wren memory describe
```

## Storing and recalling queries

Every successful query can be stored as a natural-language → SQL pair. These pairs serve as **few-shot examples** for future questions — the more you store, the better the agent gets at writing SQL for your domain.

### Storing a query

```bash
wren memory store \
  --nl "top 5 customers by revenue last quarter" \
  --sql "SELECT c.first_name, SUM(o.amount) AS revenue FROM customers c JOIN orders o ON c.customer_id = o.customer_id WHERE o.order_date >= '2024-10-01' GROUP BY 1 ORDER BY 2 DESC LIMIT 5" \
  --datasource duckdb
```

**When to store:**
- Query executed successfully and the result is correct
- There is a clear natural-language question behind the query

**When NOT to store:**
- The query failed or returned wrong results
- The query is exploratory / throwaway (`SELECT * FROM orders LIMIT 5`)
- There is no natural-language question — just raw SQL

### Recalling similar queries

Before writing new SQL, search for similar past queries:

```bash
wren memory recall -q "best customers"
wren memory recall -q "月度營收" --datasource mysql --limit 5 --output json
```

Results are returned ranked by semantic similarity. Use them as few-shot examples — adapt the SQL pattern to the current question.

## Browsing and managing pairs

### Listing pairs

Browse all stored NL-SQL pairs with `wren memory list`:

```bash
wren memory list                        # default: 20 rows, table format
wren memory list --source seed          # filter by source tag
wren memory list --limit 50 --offset 20 # pagination
wren memory list --output json          # JSON output (includes _row_id)
```

| Flag | Default | Description |
|------|---------|-------------|
| `--source` / `-s` | (all) | Filter by source: `seed`, `user`, `view` |
| `--limit` / `-n` | 20 | Max rows to show |
| `--offset` | 0 | Skip first N rows (pagination) |
| `--output` / `-o` | `table` | Output format: `json` or `table` |

### Forgetting pairs

Remove incorrect or outdated NL-SQL pairs with `wren memory forget`. Three modes:

| Mode | Flags | Behavior |
|------|-------|----------|
| **Interactive** | (none) or `--source` | Checkbox UI — browse, select, confirm |
| **By ID** | `--id N [--id M ...]` | Delete specific rows (from `list --output json`) |
| **Batch** | `--source TAG --force` | Delete all pairs matching a source tag |

```bash
# Interactive: checkbox UI (requires wren-engine[interactive])
wren memory forget
wren memory forget --source seed

# Non-interactive: delete by ID
wren memory forget --id 3 --force
wren memory forget --id 3 --id 7 --id 12 --force

# Batch: delete all seed pairs (re-index will regenerate)
wren memory forget --source seed --force
```

The interactive mode requires the `interactive` extra (included in `main`):

```bash
pip install "wren-engine[main]"          # recommended
pip install "wren-engine[interactive]"   # interactive only
```

If InquirerPy is not installed, the command prints a hint and suggests using `--id` mode instead.

**Note on `_row_id`:** Row IDs come from `wren memory list --output json`. They are positional indices and may change after deletions — always re-list before using them.

## Exporting and importing pairs

### Dump: export to YAML

Export NL-SQL pairs to a human-readable YAML file:

```bash
wren memory dump                        # write to project queries.yml (or stdout)
wren memory dump --source user          # only user-confirmed pairs
wren memory dump -o queries.yml         # explicit output path
wren memory dump -o -                   # force stdout (for piping)
```

Output format:

```yaml
version: 1
exported_at: "2026-04-08T10:30:00+00:00"
pairs:
  - nl: "monthly revenue by product category"
    sql: |
      SELECT category, SUM(revenue)
      FROM orders
      GROUP BY category
    source: user
    datasource: postgres-prod
    created_at: "2026-04-01T08:15:00+00:00"
```

When run inside a project directory without `-o`, dump defaults to writing `<project>/queries.yml`.

### Load: import from YAML

Import NL-SQL pairs from a YAML file:

```bash
wren memory load queries.yml                # skip duplicates (idempotent)
wren memory load queries.yml --upsert       # update sql for existing nl_query
wren memory load queries.yml --overwrite    # clear same-source pairs first
wren memory load queries.yml --dry-run      # validate only, don't write
```

| Mode | Flag | On duplicate | Use case |
|------|------|-------------|----------|
| **Skip** | (default) | Same `(nl, sql)` → skip | Safe idempotent load |
| **Upsert** | `--upsert` | Same `nl_query` → replace sql | Iterating on SQL quality |
| **Overwrite** | `--overwrite` | Clear same-source pairs first | Full sync from file |

`--upsert` and `--overwrite` are mutually exclusive.

Embeddings are recalculated on import — the YAML file only stores text, not vectors.

## Project integration: `queries.yml`

NL-SQL pairs can be managed as part of your project, alongside models, views, and instructions:

```text
project_root/
├── wren_project.yml
├── models/
├── views/
├── relationships.yml
├── instructions.md
├── queries.yml              ← curated NL-SQL pairs
└── target/
    └── mdl.json
```

### Scaffolding

`wren context init` creates an empty `queries.yml`:

```yaml
# Curated NL-SQL pairs for this project.
# These are auto-loaded into memory on `wren memory index`.
# Use `wren memory dump` to export pairs from memory to this file.
# Format: same as `wren memory dump` output.
version: 1
pairs: []
```

### Auto-loading on index

`wren memory index` automatically loads `queries.yml` from the project root after indexing the schema and generating seeds. Duplicate pairs are skipped (idempotent).

```bash
wren memory index               # indexes schema + seeds + loads queries.yml
wren memory index --no-queries   # skip auto-loading queries.yml
```

### Typical workflow

```bash
# 1. Agent accumulates pairs during usage
wren memory store --nl "..." --sql "..."

# 2. Export user-confirmed pairs to project
wren memory dump --source user

# 3. Review, edit SQL, commit
git add queries.yml && git commit -m "curate query pairs"

# 4. New environment: index loads everything
wren memory index
```

## Agent workflow

The memory layer fits into the agent's query workflow like this:

```
User asks a question
  │
  ├── 1. wren memory recall -q "..."     → find similar past queries (few-shot examples)
  ├── 2. wren memory fetch -q "..."      → get relevant schema context
  ├── 3. Write SQL using examples + context
  ├── 4. wren --sql "..."                → execute
  │
  └── 5. wren memory store --nl "..." --sql "..."   → save for future recall
```

Each stored query improves future recall accuracy — the system learns from usage.

### Memory hygiene (for agents)

Agents should use non-interactive mode (`--id` + `--force`) for memory management:

```bash
# Review stored pairs
wren memory list --output json

# After confirming a query is WRONG: forget then store corrected version
wren memory forget --id <id> --force
wren memory store --nl "..." --sql "..."

# Batch cleanup: remove all seed pairs (re-index will regenerate)
wren memory forget --source seed --force

# Backup before destructive ops
wren memory dump -o /tmp/backup.yml
```

## Housekeeping

```bash
wren memory status              # show index stats
wren memory reset               # drop all tables (prompts for confirmation)
wren memory reset --force       # drop without confirmation
```

## Command reference

| Command | Purpose |
|---------|---------|
| `memory index` | Index MDL schema + seeds + auto-load `queries.yml` |
| `memory fetch` | Get schema context (full text or embedding search) |
| `memory describe` | Print full schema as plain text (no LanceDB needed) |
| `memory store` | Store a single NL-SQL pair |
| `memory recall` | Search past pairs by semantic similarity |
| `memory list` | Browse all pairs with filtering and pagination |
| `memory forget` | Delete pairs (interactive, by ID, or by source) |
| `memory dump` | Export pairs to YAML |
| `memory load` | Import pairs from YAML |
| `memory status` | Show index statistics |
| `memory reset` | Drop all memory tables |

## Storage and version control

Memory files are binary (LanceDB format) and stored in `<project>/.wren/memory/`. By default this directory is gitignored.

- **schema_items** — fully rebuildable from `wren memory index`, safe to delete
- **query_history** — accumulated NL-SQL pairs, exportable via `wren memory dump`

Use `queries.yml` to version-control curated pairs instead of committing binary LanceDB files. The dump/load workflow avoids merge conflicts and enables code review of NL-SQL pairs.
