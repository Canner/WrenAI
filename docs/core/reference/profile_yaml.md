# Profile YAML reference

A **profile** stores the credentials and connection details that Wren AI uses to talk to your data source. Profiles live outside the project (typically in `~/.wren/profiles/`) so the same source can be reused across multiple projects, and credentials never end up in a Git repo.

This page lists every supported field per data source. For the higher-level concept and CLI workflow, see [Connect your database](/oss/guides/connect/overview).

---

## Common fields

Every profile has these top-level fields, regardless of data source:

```yaml
datasource: postgres          # required — type of data source
url: ...                      # required for most sources — connection string or path
format: ...                   # optional — source-specific format hint
```

| Field | Type | Required | Description |
|---|---|---|---|
| `datasource` | string | yes | One of `duckdb`, `postgres`, `mysql`, `bigquery`, `snowflake`, `clickhouse`, `trino`, `mssql`, `databricks`, `redshift`, `athena`, `oracle`, `spark`. |
| `url` | string | most | Connection target. Meaning varies per source (see below). |
| `format` | string | varies | Source-specific format hint (e.g. `duckdb` for DuckDB databases). |

---

## DuckDB

```yaml
datasource: duckdb
url: /path/to/duckdb/directory      # absolute path to a *directory* containing .duckdb files
format: duckdb
```

> **Note:** `url` is the **directory**, not the `.duckdb` file. Wren picks up all `.duckdb` files in that directory.

---

## PostgreSQL

```yaml
datasource: postgres
url: postgres://USER:PASSWORD@HOST:PORT/DATABASE
```

Or split fields:

```yaml
datasource: postgres
host: localhost
port: 5432
user: postgres
password: secret
database: my_db
sslmode: prefer                  # disable | allow | prefer | require | verify-ca | verify-full
```

---

## MySQL

```yaml
datasource: mysql
url: mysql://USER:PASSWORD@HOST:PORT/DATABASE
ssl: true
```

---

## BigQuery

```yaml
datasource: bigquery
project_id: my-gcp-project
dataset: my_dataset
credentials_path: /path/to/service-account.json
location: US
```

| Field | Type | Required | Description |
|---|---|---|---|
| `project_id` | string | yes | GCP project. |
| `dataset` | string | no | Default dataset; can be overridden in MDL `table_reference`. |
| `credentials_path` | string | yes | Path to a service-account JSON key. |
| `location` | string | no | BigQuery location (e.g. `US`, `EU`, `asia-northeast1`). |

---

## Snowflake

```yaml
datasource: snowflake
account: my-account.snowflakecomputing.com
user: WREN_USER
password: ...
warehouse: COMPUTE_WH
database: MY_DB
schema: PUBLIC
role: WREN_ROLE
authenticator: snowflake             # snowflake | externalbrowser | oauth
```

---

## Other supported sources

For ClickHouse, Trino, Databricks, Athena, Redshift, Oracle, and SQL Server, the `wren profile add --interactive` command will prompt for the right fields. The `--ui` form opens a browser-based form.

If you prefer a YAML you can commit (with credentials in `${ENV_VAR}` form), `wren profile add --from-file <path>` accepts the same shape shown in `wren profile show <name>`.

---

## Credentials and security

- Never commit profile YAML with raw credentials to a Git repository.
- Use `${ENV_VAR}` interpolation for secret fields; Wren expands them at runtime.
- The `--ui` form encrypts secrets in the profile store. Manual YAML stores secrets in plaintext at the file path you specified.

See also:

- [Connect your database](/oss/guides/connect/overview) — guided setup walkthrough.
- `wren profile --help` — full CLI reference.
