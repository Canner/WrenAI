---
sidebar_label: Oracle
---

# Connect Oracle

## Install the extra

```bash
pip install "wren-engine[oracle,main]"
```

The driver depends on Oracle's Instant Client. Install for your OS — see the [python-oracledb install guide](https://python-oracledb.readthedocs.io/en/latest/user_guide/installation.html).

## Profile fields

```yaml
datasource: oracle
host: ${ORACLE_HOST}
port: ${ORACLE_PORT}                       # 1521
service_name: ${ORACLE_SERVICE_NAME}
user: ${ORACLE_USER}
password: ${ORACLE_PASSWORD}
```

| Field | Required | Description |
|---|---|---|
| `host` | yes | Hostname |
| `port` | yes | Default `1521` |
| `service_name` | yes | TNS service name (`ORCLCDB`, `XEPDB1`, etc.) |
| `user` | yes | |
| `password` | yes | |
| `mode` | no | `SYSDBA` for admin connections; usually unset |

## Common errors

- `ORA-12541 TNS: no listener` — host/port unreachable or listener not running.
- `ORA-01017 invalid username/password` — credentials wrong or account locked.
- `DPI-1047: Cannot locate a 64-bit Oracle Client library` — Instant Client not installed or not on `LD_LIBRARY_PATH`.

See the [overview](./overview.md) for the rest of the workflow.
