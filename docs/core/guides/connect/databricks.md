---
sidebar_label: Databricks
---

# Connect Databricks

## Install the extra

```bash
pip install "wren-engine[databricks,main]"
```

## Profile fields

```yaml
datasource: databricks
server_hostname: ${DATABRICKS_HOST}        # adb-<workspace>.azuredatabricks.net
http_path: ${DATABRICKS_HTTP_PATH}         # /sql/1.0/warehouses/<id>
access_token: ${DATABRICKS_TOKEN}          # personal access token
catalog: ${DATABRICKS_CATALOG}
schema: ${DATABRICKS_SCHEMA}
```

| Field | Required | Description |
|---|---|---|
| `server_hostname` | yes | Workspace hostname, no protocol |
| `http_path` | yes | SQL warehouse HTTP path from the workspace UI |
| `access_token` | yes | Personal access token (User Settings → Developer → Access tokens) |
| `catalog` | no | Unity Catalog name |
| `schema` | no | Schema/database |

## Finding the HTTP path

Workspace UI → SQL Warehouses → click your warehouse → **Connection details** → **HTTP path**.

## Common errors

- `403 Forbidden` — token is valid but lacks access to the warehouse. Workspace admin must grant `CAN USE`.
- `Connection failed: Warehouse is stopped` — start the warehouse first, or set it to auto-start.

See the [overview](./overview.md) for the rest of the workflow.
