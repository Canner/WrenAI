# dbt Integration

Import a dbt project into Wren AI to query dbt models through the Wren context layer.

## What Wren Imports

dbt already contains the context an agent needs to query modeled data safely:
model and column descriptions, refs, source definitions, test metadata,
compiled SQL, adapter profile settings, and the physical column list in
`catalog.json`. Wren imports that context so agents do not have to infer model
purpose, join paths, or trusted constraints from table and column names alone.

Wren stores imported dbt context in regular Wren project files:

| dbt input | Wren output | Why it matters |
|-----------|-------------|----------------|
| Active dbt target | Wren connection profile | Reuses the same warehouse connection target dbt uses |
| Model and source nodes | `models/*/metadata.yml` | Preserves model names, table references, descriptions, layers, and columns |
| `relationships` tests | `relationships.yml` | Turns tested dbt refs into explicit Wren join paths |
| `not_null`, `unique`, `accepted_values` tests | Model and column metadata | Gives agents verified constraints and useful filter values |
| Test results | `instructions.md` | Surfaces verified constraints and warnings for agent workflows |
| Model graph and metadata | `queries.yml` | Seeds memory with dbt-aware example questions and SQL |

The generated `wren_project.yml` also keeps a `dbt` binding:

```yaml
dbt:
  project_dir: ../your-dbt-project
  profile: your_dbt_profile
  target: dev
```

`project_dir` points back to the imported dbt project, while `profile` and
`target` record the dbt profile target used for the import. This makes the
Wren project traceable to its dbt source and gives future tooling enough
context to refresh or inspect the original dbt artifacts.

The `dbt` binding stores only project metadata. Credentials stay in Wren
profiles and any environment variables referenced by those profiles.

## Prerequisites

- A dbt project with `dbt_project.yml`
- A dbt profile in `~/.dbt/profiles.yml`, or a custom `profiles.yml`
- Generated dbt artifacts:

```bash
cd your-dbt-project
dbt build
dbt docs generate
```

`dbt docs generate` is required because Wren imports the authoritative column list and types from `target/catalog.json`.

## Import the dbt Profile

Convert the active dbt target into a Wren connection profile:

```bash
wren profile import dbt --project-dir ./your-dbt-project
```

Useful options:

| Flag | Description |
|------|-------------|
| `--project-dir` | dbt project root. Defaults to `.` |
| `--profiles-path` | Custom path to dbt `profiles.yml` |
| `--profile` | dbt profile name override |
| `--target` | dbt target name override |
| `--name` | Destination Wren profile name |
| `--no-activate` | Save the profile without making it active |

Supported adapters include `postgres`, `bigquery`, `snowflake`, `databricks`, `trino`, `clickhouse`, `duckdb`, `mysql`, `redshift`, `spark`, `athena`, `mssql`, and `doris`.

## Import the dbt Project

Generate a Wren project from dbt artifacts:

```bash
wren context import dbt \
  --project-dir ./your-dbt-project \
  --path ./wren-project
```

Preview generated files first:

```bash
wren context import dbt \
  --project-dir ./your-dbt-project \
  --path ./wren-project \
  --dry-run
```

Use `--force` to overwrite files managed by the importer.

Generated files:

| File | Description |
|------|-------------|
| `wren_project.yml` | Project metadata, data source, and dbt binding |
| `models/*/metadata.yml` | Imported dbt models and sources |
| `relationships.yml` | Joins inferred from dbt `relationships` tests |
| `instructions.md` | dbt test summary, verified constraints, and warnings |
| `AGENTS.md` | Agent workflow guidance |
| `queries.yml` | dbt-derived seed NL-SQL pairs for memory indexing |

The importer skips ephemeral models, nodes without catalog columns, and manifest-only columns that are not present in `catalog.json`.

## dbt Test Mapping

Wren imports dbt tests as semantic metadata:

| dbt test | Wren output |
|----------|-------------|
| `not_null` | `not_null: true` on the column |
| `unique` + `not_null` | `is_primary_key: true` and model `primary_key` |
| `accepted_values` | `properties.accepted_values` |
| `relationships` | An entry in `relationships.yml` |

Relationship tests stay in `relationships.yml`; the importer does not stamp relationship dereferences onto FK columns.

## Build and Query

Compile the Wren project:

```bash
wren context build --path ./wren-project
```

Run SQL against imported model names:

```bash
wren --sql "SELECT * FROM fct_orders LIMIT 5"
```

## Memory

If memory is installed, index the imported project:

```bash
wren memory index --path ./wren-project
```

The memory index includes dbt descriptions, layers, test status, accepted values, and seed pairs from `queries.yml`.

## Complete DuckDB Example

```bash
cd jaffle_shop_duckdb
dbt build
dbt docs generate

wren profile import dbt --project-dir .
wren context import dbt --project-dir . --path ../wren-jaffle
wren context build --path ../wren-jaffle
wren --sql "SELECT * FROM fct_orders LIMIT 5"
```

## Troubleshooting

`dbt project file not found`: make sure `--project-dir` points to the directory containing `dbt_project.yml`.

`dbt manifest file not found`: run `dbt build` or `dbt compile`.

`dbt catalog file not found`: run `dbt docs generate`.

`Environment variable 'X' is required`: export variables referenced by `env_var()` in your dbt profile before importing.

Models skipped without columns: regenerate `catalog.json` with `dbt docs generate`, then re-run `wren context import dbt --force`.
