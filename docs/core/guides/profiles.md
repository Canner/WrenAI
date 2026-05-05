# Profiles

A **profile** is a named database connection configuration stored in `~/.wren/profiles.yml`. Profiles work like dbt profiles — they separate connection credentials from project definitions so the same MDL project can connect to different databases in dev, staging, and production.

## Why profiles

Without profiles, every `wren` command needs explicit connection flags:

```bash
wren --sql "SELECT 1" --connection-info '{"datasource":"postgres","host":"localhost","port":5432,...}'
```

With profiles, you configure the connection once and every command uses it automatically:

```bash
wren profile add my-db --ui
wren --sql "SELECT 1"
```

Profiles also keep credentials out of shell history and command-line arguments.

## How profiles work

Profiles are stored in `~/.wren/profiles.yml` with `0600` permissions (readable only by the owner). The file structure:

```yaml
active: my-db
profiles:
  my-db:
    datasource: postgres
    host: localhost
    port: 5432
    database: analytics
    user: analyst
    password: secret
  prod:
    datasource: bigquery
    project_id: my-gcp-project
    dataset_id: production
    credentials: <base64-encoded service account key>
```

Only one profile can be **active** at a time. All `wren` commands use the active profile unless overridden with explicit flags.

### Resolution order

When you run a `wren` command, the CLI resolves connection info in this order:

1. **Explicit flags** — `--connection-info` or `--connection-file` (highest priority)
2. **Active profile** — from `~/.wren/profiles.yml`
3. **Legacy fallback** — `~/.wren/connection_info.json` (for backward compatibility)

If none are found, the command fails with a connection error.

## Creating a profile

### Option A: Browser UI (recommended)

```bash
wren profile add my-db --ui
```

Opens a browser form with data-source-specific fields. Select the data source type, fill in the fields, and submit. Requires the `ui` extra:

```bash
pip install "wren-engine[main]"   # recommended: includes ui + memory + interactive
```

### Option B: Interactive CLI

```bash
wren profile add my-db --interactive
```

Walks through prompts for data source type and all required fields. Sensitive fields (passwords, tokens) are hidden during input.

### Option C: From file

Import from an existing JSON or YAML connection file:

```bash
wren profile add my-db --from-file connection.json
```

Both flat and envelope formats are accepted:

```json
// Flat format
{"datasource": "postgres", "host": "localhost", "port": 5432, "database": "mydb", "user": "root", "password": "secret"}

// Envelope format (auto-unwrapped)
{"datasource": "duckdb", "properties": {"url": "/data", "format": "duckdb"}}
```

### Option D: Minimal (datasource only)

```bash
wren profile add my-db --datasource postgres
```

Creates a profile with only the datasource field. Edit `~/.wren/profiles.yml` manually to add connection fields.

## Managing profiles

```bash
wren profile list                  # list all profiles (* = active)
wren profile switch prod           # change active profile
wren profile debug                 # show resolved config (secrets masked)
wren profile debug prod            # debug a specific profile
wren profile rm old-db             # remove a profile
wren profile rm old-db --force     # remove without confirmation
```

### Activating on creation

Add `--activate` to set the profile as active immediately:

```bash
wren profile add prod --from-file prod.json --activate
```

If no profile is active when you add the first one, it becomes active automatically.

## Supported data sources

| Data source | Datasource value | Extra to install |
|-------------|-----------------|------------------|
| PostgreSQL | `postgres` | `wren-engine[postgres]` |
| MySQL | `mysql` | `wren-engine[mysql]` |
| BigQuery | `bigquery` | `wren-engine[bigquery]` |
| Snowflake | `snowflake` | `wren-engine[snowflake]` |
| DuckDB | `duckdb` | _(included by default)_ |
| ClickHouse | `clickhouse` | `wren-engine[clickhouse]` |
| Trino | `trino` | `wren-engine[trino]` |
| SQL Server | `mssql` | `wren-engine[mssql]` |
| Databricks | `databricks` | `wren-engine[databricks]` |
| Redshift | `redshift` | `wren-engine[redshift]` |
| Oracle | `oracle` | `wren-engine[oracle]` |
| Athena | `athena` | `wren-engine[athena]` |
| Apache Spark | `spark` | `wren-engine[spark]` |

Install the extra for your data source before creating a profile:

```bash
pip install "wren-engine[postgres,main]"
```

## Secrets: `${VAR}` references and `.env` files

Any profile value can contain `${VAR_NAME}` placeholders that are
resolved from the environment at connection time.  The stored
profile keeps the placeholder, so `profiles.yml` (and `wren profile
debug`) never shows a plaintext secret:

```yaml
# ~/.wren/profiles.yml
profiles:
  prod:
    datasource: postgres
    host: db.example.com
    port: '5432'
    database: wren
    user: ${POSTGRES_USER}
    password: ${POSTGRES_PASSWORD}
```

wren looks for values in this order (first match wins; process env
wins over any `.env`):

1. `os.environ` — variables already exported in your shell.
2. `$CWD/.env` — the directory you run `wren` from (typical agent
   workflow drops the file here).
3. `<project_root>/.env` — co-located with `wren_project.yml`.
4. `~/.wren/.env` — user-global fallback for operators running many
   projects against the same secret bundle.

### Rules

- Names must be **UPPERCASE** (`[A-Z_][A-Z0-9_]*`).  Lowercase
  `${foo}` is treated as a literal string so it doesn't collide with
  real passwords or URL encodings.
- `$$` escapes a literal dollar sign (`a$$b` stores as `a$b`).
- Missing vars fail **early** with a clear error referencing the
  variable name — no cryptic driver-level auth errors.

### `.env` example

```bash
# .env — add to .gitignore
POSTGRES_USER=paul
POSTGRES_PASSWORD=s3cr3t
```

### Agents and secrets

AI coding agents should **never** ask for passwords in chat.  See
[Installation](../get_started/installation.md) for the recommended
agent flow: the agent writes a profile referencing `${POSTGRES_PASSWORD}`
and instructs the user to put the actual value in `.env` via their
editor.

## Profile vs project

Profiles and projects serve different purposes and are stored separately:

| | Profile | Project |
|-|---------|---------|
| **What** | Database connection credentials | MDL model definitions |
| **Where** | `~/.wren/profiles.yml` | `<project>/wren_project.yml` + `models/` |
| **Scope** | Global — shared across all projects | Per-project — version controlled |
| **Secrets** | Contains passwords, tokens, keys | No secrets — safe to commit |
| **Switching** | `wren profile switch <name>` | `cd <project>` or `--path` flag |

This separation means:
- The same project can connect to dev, staging, or prod by switching profiles
- Projects are safe to commit to git without leaking credentials
- Credentials are centralized in one file with restricted permissions

## Security

- `profiles.yml` is written with `0600` permissions (owner-only read/write)
- Writes are atomic (temp file + rename) to prevent corruption
- `wren profile debug` masks sensitive fields (`password`, `credentials`, `secret`, `token`)
- Credentials never appear in CLI output, shell history (when using profiles), or MDL manifests
