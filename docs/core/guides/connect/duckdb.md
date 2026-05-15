---
sidebar_label: DuckDB
---

# Connect DuckDB

## Install

DuckDB support is included by default — no connector extra needed:

```bash
pip install wren-engine
```

Add `memory` and `main` for the semantic memory layer and the browser-based profile UI / interactive prompts (both optional):

```bash
pip install "wren-engine[memory,main]"
```

## Profile fields

```yaml
datasource: duckdb
url: /absolute/path/to/duckdb/directory
format: duckdb
```

| Field | Required | Description |
|---|---|---|
| `url` | yes | Absolute path to a **directory** containing `.duckdb` files |
| `format` | yes | `duckdb` |

> **Important:** `url` is the **directory**, not the `.duckdb` file itself. Wren picks up all `.duckdb` files in that directory.

## Example

```yaml
datasource: duckdb
url: /Users/alice/jaffle_shop_duckdb
format: duckdb
```

## Common errors

- `directory not found` — `url` must be an absolute path that exists. Relative paths and `~` shortcuts are not expanded.
- `no .duckdb files in directory` — point `url` at the directory containing the files, not at the file itself.

See the [overview](./overview.md) for the rest of the workflow.
