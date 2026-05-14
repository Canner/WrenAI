# CLI Reference

## Default command — query

Running `wren --sql '...'` executes a query and prints the result. This is the same as `wren query --sql '...'`.

```bash
wren --sql 'SELECT COUNT(*) FROM "orders"'
wren --sql 'SELECT * FROM "orders" LIMIT 5' --output csv
wren --sql 'SELECT * FROM "orders"' --limit 100 --output json
```

Output formats: `table` (default), `csv`, `json`.

## `wren query`

Execute SQL and return results.

```bash
wren query --sql 'SELECT order_id, total FROM "orders" ORDER BY total DESC LIMIT 5'
```

## `wren dry-plan`

Translate MDL SQL to the native dialect SQL for your data source. No database connection required.

```bash
wren dry-plan --sql 'SELECT order_id FROM "orders"'
wren dry-plan --sql 'SELECT order_id FROM "orders"' -d postgres  # explicit datasource, no connection file needed
```

## `wren dry-run`

Dry-run SQL against the live database without returning rows. Prints `OK` on success, `Error: <reason>` on failure.

```bash
wren dry-run --sql 'SELECT * FROM "orders" LIMIT 1'
# OK

wren dry-run --sql 'SELECT * FROM "NonExistent"'
# Error: table not found ...
```

## Overriding defaults

All flags are optional when `~/.wren/mdl.json` and `~/.wren/connection_info.json` exist.

The data source is always read from the `datasource` field in `connection_info.json` (or the inline `--connection-info` value). Only `dry-plan` accepts `--datasource` / `-d` as an override for transpile-only use without a connection file.

```bash
wren --sql '...' \
  --mdl /path/to/other-mdl.json \
  --connection-file /path/to/prod-connection_info.json
```

Or pass connection info inline:

```bash
wren --sql 'SELECT COUNT(*) FROM "orders"' \
  --connection-info '{"datasource":"mysql","host":"localhost","port":3306,"database":"mydb","user":"root","password":"secret"}'
```

Both flat and MCP/web envelope formats are accepted:

```bash
# Flat format
{"datasource": "postgres", "host": "localhost", "port": 5432, ...}

# Envelope format (auto-unwrapped)
{"datasource": "duckdb", "properties": {"url": "/data", "format": "duckdb"}}
```

---

## `wren docs` — Connection Info Reference

Print the required and optional connection fields for a data source.

```bash
wren docs connection-info --datasource postgres
wren docs connection-info --datasource bigquery
wren docs connection-info --datasource snowflake
```

Use this to check which fields are needed before creating a profile.

---

## `wren memory` — Schema & Query Memory

LanceDB-backed semantic memory for MDL schema search and NL-SQL retrieval. Install with the `main` extra bundle (includes `memory`, `interactive`, `ui`):

```bash
pip install 'wren-engine[main]'   # includes memory, interactive, ui
```

All `memory` subcommands accept `--path DIR` to override the default storage location (`~/.wren/memory/`).

### Hybrid strategy: full text vs. embedding search

When providing schema context to an LLM, there is a trade-off:

- **Small schemas** — the full plain-text description fits easily in the LLM context window and gives better results because the LLM sees the complete structure (model-column relationships, join paths, primary keys) rather than isolated fragments from a vector search.
- **Large schemas** — the full text exceeds what is practical to send in a single prompt, so embedding search is needed to retrieve only the relevant fragments.

`wren memory fetch` automatically picks the right strategy based on the **character length** of the generated plain-text description:

| Schema size | Threshold | Strategy |
|---|---|---|
| Below 30,000 chars (~8K tokens) | Default | Returns full plain text |
| Above 30,000 chars | Default | Returns embedding search results |

The threshold is measured in characters (not tokens) because character length is free to compute, while accurate token counting requires a tokeniser. The 4:1 chars-to-tokens ratio holds for English; CJK text compresses less (~1.5:1), so a CJK-heavy schema switches to embedding search sooner — which is the conservative direction.

The default threshold (30,000 chars) can be overridden with `--threshold`.

### `wren memory index`

Parse the MDL manifest and index all schema items (models, columns, relationships, views) into LanceDB with local embeddings.

```bash
wren memory index                          # uses ~/.wren/mdl.json
wren memory index --mdl /path/to/mdl.json  # explicit MDL file
```

### `wren memory describe`

Print the full schema as structured plain text. No embedding or LanceDB required — this is a pure transformation of the MDL manifest into a human/LLM-readable format.

```bash
wren memory describe                          # uses ~/.wren/mdl.json
wren memory describe --mdl /path/to/mdl.json
```

### `wren memory fetch`

Get schema context for an LLM. Automatically chooses the best strategy based on schema size: full plain text for small schemas, embedding search for large schemas.

When using the search strategy, optional `--type` and `--model` filters narrow the results.

```bash
wren memory fetch -q "customer order price"
wren memory fetch -q "revenue" --type column --model orders
wren memory fetch -q "order date" --threshold 50000 --output json
```

| Flag | Description |
|------|-------------|
| `-q, --query` | Search query (required) |
| `--mdl` | Path to MDL JSON file |
| `-l, --limit` | Max results for search strategy (default: 5) |
| `-t, --type` | Filter: `model`, `column`, `relationship`, `view` (search strategy only) |
| `--model` | Filter by model name (search strategy only) |
| `--threshold` | Character threshold for full vs search (default: 30,000) |
| `-o, --output` | Output format: `table` (default), `json` |

### `wren memory store`

Store a natural-language-to-SQL pair for future few-shot retrieval.

```bash
wren memory store \
  --nl "show top customers by revenue" \
  --sql "SELECT c_name, sum(o_totalprice) FROM orders JOIN customer GROUP BY 1 ORDER BY 2 DESC" \
  --datasource postgres
```

### `wren memory recall`

Search stored NL-SQL pairs by semantic similarity to a query.

```bash
wren memory recall -q "best customers"
wren memory recall -q "monthly revenue" --datasource mysql --limit 5 --output json
```

| Flag | Description |
|------|-------------|
| `-q, --query` | Search query (required) |
| `-l, --limit` | Max results (default: 3) |
| `-d, --datasource` | Filter by data source |
| `-o, --output` | Output format: `table` (default), `json` |

### `wren memory status`

Show index statistics: storage path, table names, and row counts.

```bash
wren memory status
# Path: /Users/you/.wren/memory
#   schema_items: 47 rows
#   query_history: 12 rows
```

### `wren memory reset`

Drop all memory tables and start fresh.

```bash
wren memory reset          # prompts for confirmation
wren memory reset --force  # skip confirmation
```

---

## `wren cube` — Pre-aggregation Queries

For aggregation queries where the MDL defines cubes, use `wren cube` instead
of writing raw SQL. The translator produces correct `GROUP BY`, `DATE_TRUNC`,
and `WHERE` clauses from a structured input.

### `wren cube list`

List all cubes in the loaded MDL with their measures and dimensions.

```bash
wren cube list
```

### `wren cube describe <name>`

Pretty-print the full cube schema as JSON: `baseObject`, measures (with
expressions), dimensions, time dimensions, hierarchies.

```bash
wren cube describe order_metrics
```

### `wren cube query`

Build a CubeQuery and translate it to SQL via wren-core, then execute through
the same path as `wren --sql`. Two input modes:

**CLI flags:**

```bash
wren cube query \
  --cube order_metrics \
  --measures revenue,order_count \
  --dimensions status \
  --time-dimension "created_at:month:2024-01-01,2025-01-01" \
  --filter "status:eq:completed" \
  --limit 100
```

**JSON input** (`--from <file|->`):

```bash
cat query.json | wren cube query --from -
```

| Flag | Description |
|------|-------------|
| `--cube` | Cube name (required unless using `--from`) |
| `--measures` | Comma-separated measure names (required unless using `--from`) |
| `--dimensions` | Comma-separated dimension names |
| `--time-dimension` | `<name>:<granularity>[:start,end]` — one time dimension with optional date range |
| `--filter` | Repeatable. `<dimension>:<operator>[:value]`. For `in` / `not_in`, value is comma-separated. |
| `--limit` / `--offset` | Pagination |
| `--from <file\|->` | Load CubeQuery as JSON from a file or stdin |
| `--sql-only` | Print the generated SQL and exit without executing |
| `--mdl` | Path to MDL JSON (defaults to `<project>/target/mdl.json`) |
| `--output` | `table` (default), `json`, `csv` |

**Supported granularities:** `year`, `quarter`, `month`, `week`, `day`, `hour`, `minute`.

**Supported filter operators:** `eq`, `neq`, `in`, `not_in`, `gt`, `gte`, `lt`,
`lte`, `contains`, `starts_with`, `is_null`, `is_not_null`.

See the [Cube guide](../guides/modeling/cube.md) for YAML structure and
validation rules.
