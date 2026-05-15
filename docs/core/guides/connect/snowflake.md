---
sidebar_label: Snowflake
---

# Connect Snowflake

## Install the extra

```bash
pip install "wren-engine[snowflake,main]"
```

## Profile fields

```yaml
datasource: snowflake
account: ${SNOWFLAKE_ACCOUNT}              # e.g. xy12345.us-east-1
user: ${SNOWFLAKE_USER}
password: ${SNOWFLAKE_PASSWORD}
warehouse: ${SNOWFLAKE_WAREHOUSE}
database: ${SNOWFLAKE_DATABASE}
schema: ${SNOWFLAKE_SCHEMA}
role: ${SNOWFLAKE_ROLE}
authenticator: snowflake                   # snowflake | externalbrowser | oauth
```

| Field | Required | Description |
|---|---|---|
| `account` | yes | Account locator from the URL (e.g. `xy12345.us-east-1`). **Not** the full hostname. |
| `user` | yes | Username |
| `password` | required for `snowflake` authenticator | |
| `warehouse` | yes | Must exist and be accessible to the user |
| `database` | yes | |
| `schema` | yes | |
| `role` | no | Defaults to user's default role |
| `authenticator` | no | `snowflake` (default), `externalbrowser` for SSO, `oauth` for OAuth |

## Required Snowflake privileges

The user/role needs:

- `USAGE` on the warehouse, database, and schema
- `SELECT` on the tables/views you want Wren to query
- `MONITOR` is helpful for introspection but not required

## Common errors

- `Incorrect username or password was specified` — verify, then check if MFA is required (use `externalbrowser`).
- `Object does not exist` — warehouse / database / schema name is wrong, or the role can't see it. List with `SHOW WAREHOUSES;` etc. as the same user.
- Hangs on connect — likely the account locator is wrong. Use just the part before `.snowflakecomputing.com`.

See the [overview](./overview.md) for the rest of the workflow.
