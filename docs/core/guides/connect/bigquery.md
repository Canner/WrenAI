---
sidebar_label: BigQuery
---

# Connect BigQuery

## Install the extra

```bash
pip install "wren-engine[bigquery,main]"
```

## Profile fields

```yaml
datasource: bigquery
project_id: ${BIGQUERY_PROJECT_ID}
dataset_id: ${BIGQUERY_DATASET}
credentials: ${BIGQUERY_CREDENTIALS}    # base64-encoded service-account JSON
```

| Field | Required | Description |
|---|---|---|
| `project_id` | yes | GCP project |
| `dataset_id` | yes | Default dataset; can be overridden per model |
| `credentials` | yes | Base64-encoded service-account JSON key |

## Encoding the credentials

The `credentials` field is the base64-encoded contents of a service-account JSON key file:

```bash
# macOS
base64 -i /path/to/service-account.json | pbcopy

# Linux
base64 -w 0 /path/to/service-account.json
```

Paste the resulting string into `BIGQUERY_CREDENTIALS=` in your `.env`.

## Required IAM roles

The service account needs at minimum:

- `roles/bigquery.dataViewer` on the project or dataset
- `roles/bigquery.jobUser` on the project (to run queries)

For schema introspection across multiple datasets, also grant `roles/bigquery.metadataViewer`.

## Common errors

- `403 Permission denied` — the service account is missing one of the IAM roles above.
- `404 Not found: Dataset` — `dataset_id` is wrong, or the SA doesn't have access to that dataset.
- `Invalid grant: account not found` — the service-account key was rotated/deleted; download a new key and re-encode.

See the [overview](./overview.md) for the rest of the workflow.
