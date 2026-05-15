---
sidebar_label: PostgreSQL
---

# Connect PostgreSQL

## Install the extra

```bash
pip install "wren-engine[postgres,main]"
```

## Profile fields

```yaml
datasource: postgres
host: ${POSTGRES_HOST}
port: ${POSTGRES_PORT}
database: ${POSTGRES_DATABASE}
user: ${POSTGRES_USER}
password: ${POSTGRES_PASSWORD}
sslmode: prefer            # disable | allow | prefer | require | verify-ca | verify-full
```

Or use a single connection string:

```yaml
datasource: postgres
url: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DATABASE}
```

| Field | Required | Description |
|---|---|---|
| `host` | yes | Hostname or IP |
| `port` | yes | Default `5432` |
| `database` | yes | Database name |
| `user` | yes | Username |
| `password` | yes | Password |
| `sslmode` | no | TLS verification mode |
| `schema` | no | Default search-path schema |

## `.env` template

```bash
POSTGRES_HOST=db.example.com
POSTGRES_PORT=5432
POSTGRES_DATABASE=wren
POSTGRES_USER=alice
POSTGRES_PASSWORD=...
```

## Create the profile

```bash
wren profile add my-postgres --from-file connection.yml
```

## Common errors

- `password authentication failed` — credentials wrong; re-run after fixing `.env`.
- `connection refused` — host/port unreachable. Verify with `nc -zv $POSTGRES_HOST 5432`.
- Cloud Postgres (RDS, Supabase, Neon) typically requires `sslmode: require`.

See the [overview](./overview.md) for the rest of the workflow.
