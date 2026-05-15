---
sidebar_label: Trino
---

# Connect Trino / Presto

## Install the extra

```bash
pip install "wren-engine[trino,main]"
```

## Profile fields

```yaml
datasource: trino
host: ${TRINO_HOST}
port: ${TRINO_PORT}
catalog: ${TRINO_CATALOG}
schema: ${TRINO_SCHEMA}
user: ${TRINO_USER}
password: ${TRINO_PASSWORD}
http_scheme: https
```

| Field | Required | Description |
|---|---|---|
| `host` | yes | Trino coordinator hostname |
| `port` | yes | `8080` (http) or `8443` (https) |
| `catalog` | **yes** | Required even if you plan to fully-qualify table names |
| `schema` | **yes** | Same |
| `user` | yes | |
| `password` | depending on auth | |
| `http_scheme` | no | `http` or `https` |

> `catalog` and `schema` are required even though many Trino clients let you omit them. Set both.

## Common errors

- `Catalog 'foo' does not exist` — case-sensitive; usually lowercase.
- `401 Unauthorized` — if cluster has password auth, `http_scheme` must be `https` and password must be set.

See the [overview](./overview.md) for the rest of the workflow.
