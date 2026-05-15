---
sidebar_label: SQL Server
---

# Connect SQL Server

## Install the extra

```bash
pip install "wren-engine[mssql,main]"
```

The driver depends on Microsoft's ODBC Driver for SQL Server. Install it for your OS first:

- **macOS**: `brew tap microsoft/mssql-release && brew install msodbcsql18`
- **Ubuntu/Debian**: see [Microsoft's install guide](https://learn.microsoft.com/sql/connect/odbc/linux-mac/installing-the-microsoft-odbc-driver-for-sql-server)

## Profile fields

```yaml
datasource: mssql
host: ${MSSQL_HOST}
port: ${MSSQL_PORT}
database: ${MSSQL_DATABASE}
user: ${MSSQL_USER}
password: ${MSSQL_PASSWORD}
driver: "ODBC Driver 18 for SQL Server"
encrypt: true
trust_server_certificate: false
```

| Field | Required | Description |
|---|---|---|
| `host` | yes | Hostname |
| `port` | yes | Default `1433` |
| `database` | yes | |
| `user` | yes | |
| `password` | yes | |
| `driver` | no | ODBC driver name (defaults to 18) |
| `encrypt` | no | `true` for TLS |
| `trust_server_certificate` | no | `true` only for dev/self-signed certs |

## Common errors

- `IM002 Data source name not found` — ODBC driver not installed; install msodbcsql18.
- `SSL Provider: certificate verify failed` — set `trust_server_certificate: true` for dev, or install a real certificate.

See the [overview](./overview.md) for the rest of the workflow.
