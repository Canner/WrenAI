# wren-engine

[![PyPI version](https://img.shields.io/pypi/v/wren-engine.svg)](https://pypi.org/project/wren-engine/)
[![Python](https://img.shields.io/pypi/pyversions/wren-engine.svg)](https://pypi.org/project/wren-engine/)
[![License](https://img.shields.io/pypi/l/wren-engine.svg)](https://github.com/Canner/wren-engine/blob/main/LICENSE)

Wren Engine CLI and Python SDK — semantic SQL layer for 20+ data sources.

Translate natural SQL queries through an [MDL (Modeling Definition Language)](https://docs.getwren.ai/) semantic layer and execute them against your database. Powered by [Apache DataFusion](https://datafusion.apache.org/) and [Ibis](https://ibis-project.org/).

## Installation

```bash
pip install wren-engine              # Core (DuckDB included)
pip install wren-engine[postgres]    # PostgreSQL
pip install wren-engine[mysql]       # MySQL
pip install wren-engine[bigquery]    # BigQuery
pip install wren-engine[snowflake]   # Snowflake
pip install wren-engine[clickhouse]  # ClickHouse
pip install wren-engine[trino]       # Trino
pip install wren-engine[mssql]       # SQL Server
pip install wren-engine[databricks]  # Databricks
pip install wren-engine[redshift]    # Redshift
pip install wren-engine[spark]       # Spark
pip install wren-engine[athena]      # Athena
pip install wren-engine[oracle]      # Oracle
pip install 'wren-engine[memory]'    # Schema & query memory (LanceDB)
pip install 'wren-engine[ui]'        # Browser-based profile form (starlette + uvicorn)
pip install 'wren-engine[main]'      # memory + interactive prompts + ui
pip install 'wren-engine[all]'       # All connectors + main
```

Requires Python 3.11+.

## Quick start

**1. Initialize a project** — scaffolds a YAML-based MDL project:

```bash
mkdir my-project && cd my-project
wren context init
```

This creates `wren_project.yml`, `models/`, and `views/`. Edit `wren_project.yml` to set your `data_source` and add models under `models/`:

```yaml
# wren_project.yml
schema_version: 2
name: my_project
catalog: wren
schema: public
data_source: postgres
```

```yaml
# models/orders/metadata.yml
name: orders
table_reference:
  schema: mydb
  table: orders
columns:
  - name: order_id
    type: integer
  - name: customer_id
    type: integer
  - name: total
    type: double
  - name: status
    type: varchar
primary_key: order_id
```

> **Already have an MDL JSON?** Import it directly:
> `wren context init --from-mdl path/to/mdl.json`

**2. Configure a connection profile:**

```bash
# Browser form (recommended, requires wren-engine[ui])
wren profile add my-db --ui

# Interactive terminal prompts
wren profile add my-db --interactive

# Import from an existing connection file
wren profile add my-db --from-file connection_info.json
```

**3. Build the manifest:**

```bash
wren context build
```

This compiles YAML files into `target/mdl.json`. The CLI auto-discovers this file when you run queries from within the project directory.

**4. Run queries:**

```bash
wren --sql 'SELECT order_id FROM "orders" LIMIT 10'
```

`wren` walks up from the current directory to find `wren_project.yml` and uses `target/mdl.json`. You can also pass `--mdl path/to/mdl.json` explicitly.

For the full CLI reference and per-datasource connection field reference, see [`docs/cli.md`](docs/cli.md) and [`docs/connections.md`](docs/connections.md).

**4a. (Optional) Aggregation queries with cubes** — define cubes under `cubes/`,
then query them with a structured input instead of writing `GROUP BY` SQL by hand:

```bash
wren cube list
wren cube describe order_metrics
wren cube query --cube order_metrics --measures revenue --time-dimension "created_at:month"
```

The translator produces `DATE_TRUNC` / `GROUP BY` / `WHERE` clauses for you and
runs them through the same engine path as `wren --sql`. See the
[Cube guide](../../docs/core/guides/modeling/cube.md) for full YAML structure
and the [CLI reference](../../docs/core/reference/cli.md#wren-cube--pre-aggregation-queries) for all
flags.

**5. (Optional) Configure security policy** — create `~/.wren/config.json`:

```json
{
  "strict_mode": true,
  "denied_functions": ["pg_read_file", "dblink", "lo_import"]
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `strict_mode` | `false` | When `true`, every table in a query must be defined in the MDL. Queries referencing undeclared tables are rejected before execution. |
| `denied_functions` | `[]` | List of function names (case-insensitive) that are forbidden in queries. |

**6. (Optional) Index schema for semantic search** (requires `wren-engine[memory]`):

```bash
wren memory index                              # index MDL schema
wren memory fetch -q "customer order price"    # fetch relevant schema context
wren memory store --nl "top customers" --sql "SELECT ..."  # store NL→SQL pair
wren memory recall -q "best customers"         # retrieve similar past queries
```

---

## Connection profiles

Profiles let you store named connection configurations in `~/.wren/profiles.yml` and switch between them easily — useful when working across multiple databases or environments.

```bash
# Add a profile (browser form, interactive prompts, or file import)
wren profile add prod --ui                        # opens http://localhost:<port>
wren profile add staging --interactive            # terminal prompts
wren profile add local --from-file conn.json      # import existing file

# List and switch profiles
wren profile list                                 # * marks the active profile
wren profile switch prod

# Inspect a profile (sensitive fields masked)
wren profile debug prod

# Remove a profile
wren profile rm old-profile --force
```

The `--ui` flag opens a browser-based form that auto-derives fields from each datasource's schema — including file upload for BigQuery credentials, variant selection for Databricks/Redshift, and sensible defaults for all 20+ supported sources. Requires `pip install 'wren-engine[ui]'`.

Once a profile is active, `wren` uses it automatically:

```bash
wren profile switch prod
wren --sql 'SELECT COUNT(*) FROM "orders"'        # connects using prod profile
```

---

## Python SDK

```python
import base64, orjson
from wren import WrenEngine, DataSource

manifest = { ... }  # your MDL dict
manifest_str = base64.b64encode(orjson.dumps(manifest)).decode()

with WrenEngine(manifest_str, DataSource.mysql, {"host": "...", ...}) as engine:
    result = engine.query('SELECT * FROM "orders" LIMIT 10')
    print(result.to_pandas())
```

---

## Development

```bash
just install-dev    # Install with dev dependencies
just lint           # Ruff format check + lint
just format         # Auto-fix
```

| Command | What it runs | Docker needed |
|---------|-------------|---------------|
| `just test-unit` | Unit tests (engine, CTE rewriter, field registry, profiles) | No |
| `just test-duckdb` | DuckDB connector tests | No |
| `just test-postgres` | PostgreSQL connector tests | Yes |
| `just test-mysql` | MySQL connector tests | Yes |
| `just test` | All tests | Yes |

Profile web tests (`test_profile_web.py`) require `wren-engine[ui]`:

```bash
uv sync --extra dev --extra ui --find-links ../wren-core-py/target/wheels/
uv run pytest tests/test_profile_web.py -v
```

## Publishing

```bash
./scripts/publish.sh            # Build + publish to PyPI
./scripts/publish.sh --test     # Build + publish to TestPyPI
./scripts/publish.sh --build    # Build only
```

## License

Apache-2.0
