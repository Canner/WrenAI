# Connection formats

The `connection_info.json` file (or `--connection-info` / `--connection-file` flags) requires a `datasource` field plus the connector-specific fields below.

## Accepted formats

**Flat format** — all fields at the top level:

```json
{
  "datasource": "postgres",
  "host": "localhost",
  "port": 5432,
  "database": "mydb",
  "user": "postgres",
  "password": "secret"
}
```

**Envelope format** — connector fields nested under `properties` (used by MCP server and Wren web):

```json
{
  "datasource": "postgres",
  "properties": {
    "host": "localhost",
    "port": 5432,
    "database": "mydb",
    "user": "postgres",
    "password": "secret"
  }
}
```

Both formats are accepted. The CLI auto-flattens the envelope format.

---

## Per-connector fields

## MySQL

```json
{
  "datasource": "mysql",
  "host": "localhost",
  "port": 3306,
  "database": "mydb",
  "user": "root",
  "password": "secret"
}
```

## PostgreSQL

```json
{
  "datasource": "postgres",
  "host": "localhost",
  "port": 5432,
  "database": "mydb",
  "user": "postgres",
  "password": "secret"
}
```

## BigQuery

```json
{
  "datasource": "bigquery",
  "project_id": "my-gcp-project",
  "dataset_id": "my_dataset",
  "credentials": "<base64-encoded-service-account-json>"
}
```

## Snowflake

```json
{
  "datasource": "snowflake",
  "user": "myuser",
  "password": "secret",
  "account": "myorg-myaccount",
  "database": "MYDB",
  "schema": "PUBLIC"
}
```

## Redshift (standard)

```json
{
  "datasource": "redshift",
  "host": "my-cluster.xxxx.us-east-1.redshift.amazonaws.com",
  "port": 5439,
  "database": "dev",
  "user": "awsuser",
  "password": "secret"
}
```

## Redshift (IAM)

```json
{
  "datasource": "redshift",
  "redshift_type": "redshift_iam",
  "cluster_identifier": "my-cluster",
  "database": "dev",
  "user": "awsuser",
  "region": "us-east-1",
  "access_key_id": "AKIA...",
  "access_key_secret": "secret"
}
```

## DuckDB (local files)

```json
{
  "datasource": "duckdb",
  "url": "/path/to/data",
  "format": "parquet"
}
```
