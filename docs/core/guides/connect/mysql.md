---
sidebar_label: MySQL
---

# Connect MySQL

## Install the extra

```bash
pip install "wren-engine[mysql,main]"
```

### macOS note

`mysqlclient` needs system libraries before pip can build it:

```bash
brew install mysql-client pkg-config
export PKG_CONFIG_PATH="$(brew --prefix mysql-client)/lib/pkgconfig"
pip install "wren-engine[mysql,main]"
```

Verify `mysql-client` is actually installed (`brew list mysql-client`) — `brew --prefix` returns a path even when the keg is missing.

## Profile fields

```yaml
datasource: mysql
host: ${MYSQL_HOST}
port: ${MYSQL_PORT}
database: ${MYSQL_DATABASE}
user: ${MYSQL_USER}
password: ${MYSQL_PASSWORD}
ssl: true
```

| Field | Required | Description |
|---|---|---|
| `host` | yes | Hostname or IP |
| `port` | yes | Default `3306` |
| `database` | yes | Database name |
| `user` | yes | Username |
| `password` | yes | Password |
| `ssl` | no | `true` for SSL, omit for plaintext |

## Common errors

- `1044 Access denied` — user lacks privileges on the database. Grant `SELECT` (and `SHOW DATABASES` for introspection).
- `Lost connection to MySQL server during query` — long-running query or network drop; tune timeouts on the server.

See the [overview](./overview.md) for the rest of the workflow.
