---
sidebar_label: ClickHouse
---

# Connect ClickHouse

## Install the extra

```bash
pip install "wren-engine[clickhouse,main]"
```

## Profile fields

```yaml
datasource: clickhouse
host: ${CLICKHOUSE_HOST}
port: ${CLICKHOUSE_PORT}
database: ${CLICKHOUSE_DATABASE}
user: ${CLICKHOUSE_USER}
password: ${CLICKHOUSE_PASSWORD}
secure: true
```

| Field | Required | Description |
|---|---|---|
| `host` | yes | Hostname |
| `port` | yes | Default `9000` for native, `8443` for HTTPS |
| `database` | yes | |
| `user` | yes | |
| `password` | yes | |
| `secure` | no | `true` for TLS (typical for ClickHouse Cloud) |

## Common errors

- `Connection refused on port 9000` — ClickHouse Cloud uses HTTPS on port 8443; native protocol is not exposed externally.
- `Code 516: Authentication failed` — credentials or wrong database.

See the [overview](./overview.md) for the rest of the workflow.
