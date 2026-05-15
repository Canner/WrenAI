---
sidebar_label: Overview
---

# Connect your database

Wren AI talks to your database through a **profile** — a single YAML file with credentials and connection details. Once a profile is bound to a project, every CLI command and SDK call uses it.

The flow is the same regardless of which database you use:

1. **Install the connector extra** for your data source.
2. **Create a profile** with `wren profile add` (or let the `wren-onboarding` skill do it).
3. **Bind the profile** to your project with `wren context set-profile`.
4. **Generate the MDL** with the `wren-generate-mdl` skill (or manually).
5. **Start querying.**

If you have an AI coding agent installed, the `wren-onboarding` skill drives the whole thing — see [Installation](/oss/get_started/installation). The per-database pages below cover only the fields and quirks specific to each connector.

## Supported data sources

| Data source | Connector extra | Page |
|---|---|---|
| DuckDB | _(included)_ | [DuckDB](./duckdb.md) |
| PostgreSQL | `postgres` | [PostgreSQL](./postgresql.md) |
| MySQL | `mysql` | [MySQL](./mysql.md) |
| BigQuery | `bigquery` | [BigQuery](./bigquery.md) |
| Snowflake | `snowflake` | [Snowflake](./snowflake.md) |
| ClickHouse | `clickhouse` | [ClickHouse](./clickhouse.md) |
| Trino / Presto | `trino` | [Trino](./trino.md) |
| SQL Server | `mssql` | [SQL Server](./sqlserver.md) |
| Databricks | `databricks` | [Databricks](./databricks.md) |
| Redshift | `redshift` | [Redshift](./redshift.md) |
| Oracle | `oracle` | [Oracle](./oracle.md) |
| Athena | `athena` | [Athena](./athena.md) |

Install one or more extras together:

```bash
pip install "wren-engine[postgres,bigquery,main]"
```

## Creating a profile

The browser UI is the easiest way:

```bash
wren profile add my-db --ui
```

Or use the interactive flow:

```bash
wren profile add my-db --interactive
```

Or import from a YAML file (recommended for agent-driven setups so secrets live in `.env`):

```bash
wren profile add my-db --from-file connection.yml
```

To see the exact fields for any data source:

```bash
wren docs connection-info postgres
```

For the full YAML schema of every connector, see the [Profile YAML reference](/oss/reference/profile_yaml).

## Verifying the connection

```bash
wren profile debug   # show resolved config (secrets masked)
wren --sql "SELECT 1"
```

If the connection fails, check credentials, network reachability, SSL settings, and IP allowlists on the cloud-database side.

## Binding the profile to a project

```bash
cd ~/my-project
wren context set-profile my-db
```

This writes `profile: my-db` and `data_source: <ds>` into `wren_project.yml`. Future commands in this project always use this profile, regardless of which profile is globally active.

## Next steps

- [Generate MDL](/oss/guides/modeling/overview) — let the agent introspect your schema
- [Memory](/oss/guides/memory) — how the index keeps your queries accurate
- [Profiles](/oss/guides/profiles) — managing multiple profiles
