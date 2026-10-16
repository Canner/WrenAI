# OpenMetadata Integration

Bootstrap a Wren project from an [OpenMetadata](https://open-metadata.org) catalog instead of
introspecting the live database.

## Why import from OpenMetadata

When a team already catalogs its warehouse in OpenMetadata, the catalog holds context the raw
database schema does not:

- **Curated descriptions** for tables and columns, written by data owners — usually better than
  database comments.
- **Tags and owners** (for example `PII.Sensitive`, `Tier.Tier1`).
- **Foreign-key constraints**, which become explicit Wren join paths in `relationships.yml`.
  Join inference is the step an agent is most likely to get wrong when it only sees table and
  column names.

## What Wren imports

| OpenMetadata input | Wren output |
|--------------------|-------------|
| Table entities in the selected service / database / schema | `models/<table>/metadata.yml` |
| Column name, `dataTypeDisplay`, `NOT_NULL` / `PRIMARY_KEY` constraint | Column `type` (normalized for the datasource dialect) and `not_null` |
| `PRIMARY_KEY` table constraint | Model `primary_key` (a list for composite keys) |
| `FOREIGN_KEY` table constraints | `relationships.yml` entries (`properties.source: openmetadata_foreign_key`) |
| Table / column descriptions | `properties.description` |
| Table / column tags | `properties.om_tags` (list of tag FQNs) |
| Table owners | `properties.om_owners` (list of user or team names) |
| Table type | `properties.om_table_type` |
| Fully-qualified names | `properties.om_fqn` on every model and column |
| Database service type | `data_source` in `wren_project.yml` |

`properties.om_fqn` makes the mapping between a Wren object and its OpenMetadata entity
deterministic, so later tooling can look the entity up without guessing.

The generated `wren_project.yml` records where the project came from:

```yaml
openmetadata:
  service: shop_pg
  database: shop
  schema: shop
  server_version: 2.0.5
```

### What is not imported

- **Lineage is not turned into relationships.** OpenMetadata lineage records how data is derived
  (table B is computed from table A), not how tables join. Only foreign-key constraints produce
  relationships, so tables with no foreign keys get no relationships.
- **Connection settings.** Only the datasource type comes from OpenMetadata. Host, port, user and
  database are not imported (the address OpenMetadata ingests through is often not reachable from
  where Wren runs) and OpenMetadata masks passwords, so bind a Wren profile separately.
- Glossary terms, metrics and other knowledge assets, and incremental re-sync, are not covered by
  this command.

Foreign keys that point at a table outside the selection are skipped and listed in the command
output. Widen the selection (for example drop `--schema`) to include the referenced table.

## Prerequisites

- An OpenMetadata server. Tested against **2.0.x** (verified on 2.0.5). Other versions run, but
  the command prints a warning.
- A database service already ingested into OpenMetadata, with **table constraints** enabled in
  the metadata ingestion so foreign keys are present.
- A token with read access to the catalog: an OpenMetadata bot token (**Settings → Bots**) or a
  personal access token (**Profile → Access Tokens**).

## Import

Pass the connection with flags or environment variables:

```bash
export OPENMETADATA_HOST=http://localhost:8585
export OPENMETADATA_TOKEN=<token>

wren context import openmetadata \
  --service shop_pg --database shop --schema shop \
  --path ./wren-shop --dry-run

wren context import openmetadata \
  --service shop_pg --database shop --schema shop \
  --path ./wren-shop
```

| Flag | Meaning |
|------|---------|
| `--host` / `OPENMETADATA_HOST` | OpenMetadata server URL (`/api/v1` is appended if missing) |
| `--token` / `OPENMETADATA_TOKEN` | Bot or personal access token |
| `--service` | Database service name as shown in OpenMetadata (required) |
| `--database` | Only import tables from this database |
| `--schema` | Only import tables from this schema (requires `--database`) |
| `--table` | Only import this table; repeat for several |
| `--data-source` | Wren datasource to use when the service type has no automatic mapping |
| `--dry-run` | List the files that would be written |
| `--force` | Regenerate from OpenMetadata (see below) |

Service types mapped automatically: Athena, BigQuery, ClickHouse, Databricks, Doris, DuckDB,
MariaDB, MySQL, Mssql, Oracle, Postgres, Redshift, Snowflake, Trino.

Then bind a connection profile and finish the project:

```bash
wren profile add shop --datasource postgres --interactive
wren context validate --path ./wren-shop
wren context build --path ./wren-shop
```

## Re-importing

OpenMetadata is the source of truth for the import, in the same way dbt is for
`wren context import dbt`:

- **Without `--force`** the command only adds. Files that already exist are never modified, so
  descriptions or relationships you edited locally survive. Every collision is listed — models
  that already exist, relationships that were not added, and relationships whose local
  definition differs from OpenMetadata. Use this to pull newly cataloged tables into an existing
  project. If there is nothing new to write, the command exits with status 1.
- **With `--force`** the generated files (`models/`, `views/`, `relationships.yml`,
  `wren_project.yml`, `AGENTS.md`) are deleted and regenerated from OpenMetadata. **Local edits to
  those files are discarded.** Make durable description changes in OpenMetadata itself.
