---
sidebar_label: Connect your database
---

# Connect your database

Wren AI talks to your database through a **profile** — credentials and connection details stored in `~/.wren/profiles.yml`. Once a profile is bound to a project, every CLI command and SDK call uses it.

The flow is the same regardless of which database you use:

1. **Install the connector extra** for your data source.
2. **Create a profile** with `wren profile add` (or let the `wren-onboarding` skill do it).
3. **Bind the profile** to your project with `wren context set-profile`.
4. **Generate the MDL** with the `wren-generate-mdl` skill (or manually).
5. **Start querying.**

If you have an AI coding agent installed, the `wren-onboarding` skill drives the whole thing — see [Installation](/oss/get_started/installation).

## Supported data sources

| Data source | Connector extra |
|---|---|
| DuckDB | _(included)_ |
| PostgreSQL | `postgres` |
| MySQL | `mysql` |
| BigQuery | `bigquery` |
| Snowflake | `snowflake` |
| ClickHouse | `clickhouse` |
| Trino / Presto | `trino` |
| SQL Server | `mssql` |
| Databricks | `databricks` |
| Redshift | `redshift` |
| Oracle | `oracle` |
| Athena | `athena` |
| Spark | `spark` |

Install one or more extras together:

```bash
pip install "wren-engine[postgres,bigquery,main]"
```

## Inspecting connection fields

To see the exact fields required and accepted by a connector, run:

```bash
wren docs connection-info <ds>
```

The output is generated directly from the engine's connection schema, so it always matches the version of `wren-engine` you have installed. Examples:

```bash
wren docs connection-info postgres
wren docs connection-info bigquery
wren docs connection-info snowflake
```

Use this instead of memorizing field names — the CLI is the source of truth.

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
