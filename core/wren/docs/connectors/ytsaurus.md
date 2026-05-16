# YTsaurus connector

Connects Wren Engine to a [YTsaurus](https://ytsaurus.tech/en) cluster through
its **CHYT** clique (ClickHouse-over-YT). CHYT exposes a ClickHouse HTTP
protocol on the YT HTTP proxy, so this connector reuses Wren's existing
ClickHouse / Ibis path with YT-flavored auth (`Authorization: OAuth <YT_TOKEN>`
and a clique alias as the ClickHouse `database`).

The sqlglot dialect is `clickhouse`, so all CHYT-compatible ClickHouse SQL —
including `toUnixTimestamp`, `startsWith`, `now() - INTERVAL N DAY`,
`COUNT(DISTINCT ...)` — works as-is.

## Install

```bash
pip install "wren-engine[ytsaurus]"
```

The `ytsaurus` extra pulls `ibis-framework[clickhouse]`.

## Connection info

```python
from wren.model import YTsaurusConnectionInfo
from wren.model.data_source import DataSource
from wren.connector.factory import get_connector

info = DataSource.ytsaurus.get_connection_info({
    "proxy":  "yt-proxy.example.com",  # YT HTTP proxy host
    "clique": "*ch_public",            # CHYT clique alias incl. leading "*"
    # "token": "y0_AgAA...",           # optional — falls back to YT_TOKEN env
    # "secure": True,                  # default
    # "port":   443,                   # default 443 / 80 by secure flag
    # "settings": {"max_threads": "8"},
    # "kwargs":   {"connect_timeout": "30"},
})

connector = get_connector(DataSource.ytsaurus, info)
table = connector.query("SELECT now()", limit=1)
print(table.to_pandas())
```

| Field | Type | Default | Meaning |
|---|---|---|---|
| `proxy` | str (required) | — | YT HTTP proxy host (no scheme). |
| `clique` | str (required) | — | CHYT clique alias including the `*` prefix. |
| `token` | SecretStr | env `YT_TOKEN` | YT OAuth token. |
| `secure` | bool | `True` | HTTPS vs HTTP. |
| `port` | int | 443 / 80 | Override proxy port. |
| `settings` | dict | `None` | ClickHouse session settings (e.g. `max_execution_time`). |
| `kwargs` | dict | `None` | Passed to `clickhouse_connect.get_client()`. Supports `http_headers` (the connector merges `Authorization` in automatically). |

JSON form for use with `--connection-info` / `--connection-file`:

```json
{
  "datasource": "ytsaurus",
  "proxy": "yt-proxy.example.com",
  "clique": "*ch_public",
  "token": "y0_AgAA..."
}
```

## Auth

The connector resolves the YT OAuth token in this order:

1. `connection_info.token` if provided
2. `YT_TOKEN` environment variable

The token is sent both as `Authorization: OAuth <token>` (current CHYT auth)
and as the ClickHouse `password` (legacy). Either works on any modern YT
proxy.

If neither source produces a token, the connector raises
`WrenError(INVALID_CONNECTION_INFO)`.

## Statement timeout

Like the ClickHouse connector, the YTsaurus connector honors the
`x-wren-db-statement-timeout` header by setting the CHYT session's
`max_execution_time` (defaults to 180 seconds).

## Limitations

- **CHYT only**: the connector targets the ClickHouse-over-YT engine.
  Query-Tracker-only features (raw YQL, SPYT) are not exposed. If you need a
  YT-native YQL path, fork the connector and replace
  `get_ytsaurus_connection` with a Query Tracker REST client; the rest of
  the Wren plumbing (factory, enum, connection info) stays the same.
- **Clique availability**: queries fail if the named CHYT clique is not
  running. Cliques are managed in the YT UI under "CHYT cliques".
- **Schema discovery**: `system.tables` works for CHYT-attached tables.
  Static YT tables outside the clique's exposed schema must be referenced
  by their full YT path (`"//home/.../table"`) inside CHYT queries.
