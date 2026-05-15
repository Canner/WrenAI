---
sidebar_label: Athena
---

# Connect Athena

## Install the extra

```bash
pip install "wren-engine[athena,main]"
```

## Profile fields

```yaml
datasource: athena
region_name: ${AWS_REGION}                 # e.g. us-east-1
s3_staging_dir: ${ATHENA_S3_STAGING_DIR}   # s3://my-bucket/athena-results/
schema_name: ${ATHENA_SCHEMA}              # Glue database
work_group: primary
```

| Field | Required | Description |
|---|---|---|
| `region_name` | yes | AWS region |
| `s3_staging_dir` | yes | S3 URI for query results |
| `schema_name` | yes | Glue / Athena database name |
| `work_group` | no | Defaults to `primary` |

## AWS credentials

Wren picks up credentials from the standard AWS chain:

1. `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` env vars
2. `~/.aws/credentials` profile (set `AWS_PROFILE` if not `default`)
3. EC2/ECS/Lambda instance role

For local dev, the simplest path is to add the credentials to your project `.env`:

```bash
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
```

## Required IAM permissions

The principal needs:

- `athena:StartQueryExecution`, `athena:GetQueryExecution`, `athena:GetQueryResults`
- `glue:GetDatabase`, `glue:GetTable`, `glue:GetTables`
- `s3:GetBucketLocation`, `s3:GetObject`, `s3:ListBucket`, `s3:PutObject` on the staging-dir bucket

## Common errors

- `Insufficient permissions to execute the query` — missing one of the IAM permissions above.
- `Output location not specified` — `s3_staging_dir` missing or unreachable.

See the [overview](./overview.md) for the rest of the workflow.
