# Connect Your Database

This guide walks you through connecting Wren AI Core to your own database — from creating a profile to running your first query. If you haven't installed the CLI yet, see [Installation](./installation.md) first.

---

## Step 1 — Install the data source extra

Each database requires its own connector. Install the extra for your data source:

```bash
pip install "wren-engine[postgres,main]"
```

Replace `postgres` with your data source (see [supported data sources](./installation.md#data-source-extras) for the full list). If you already installed with the correct extra, skip this step.

---

## Step 2 — Create a profile

A profile stores your database connection. The browser UI is the easiest way to create one:

```bash
wren profile add my-db --ui
```

This opens a form where you select the data source type and fill in the required connection fields.

Each data source has different fields. To see the exact fields for any data source:

```bash
wren docs connection-info postgres
```

Replace `postgres` with your data source name. The command prints all required and optional fields with descriptions, derived directly from the Pydantic schema — so it always matches the running CLI.

**Example — PostgreSQL:**

```bash
wren profile add my-db --ui
# Select "postgres", then fill in: host, port, database, user, password
```

### Other options

If you prefer not to use the browser UI:

```bash
# Interactive prompts
wren profile add my-db --interactive

# Import from a JSON/YAML file (recommended for agent-driven flows)
wren profile add my-db --from-file connection.yml
```

For the `--from-file` flow, write a flat YAML referencing `${VAR}` placeholders so secrets stay in `.env`:

```yaml
# connection.yml
datasource: postgres
host: ${POSTGRES_HOST}
port: ${POSTGRES_PORT}
database: ${POSTGRES_DATABASE}
user: ${POSTGRES_USER}
password: ${POSTGRES_PASSWORD}
```

```bash
# .env (in project root; add to .gitignore)
POSTGRES_HOST=db.example.com
POSTGRES_PORT=5432
POSTGRES_DATABASE=wren
POSTGRES_USER=alice
POSTGRES_PASSWORD=...
```

See [Profiles](../guides/profiles.md) for all options.

### Per-datasource setup notes

Most data sources only need the fields shown by `wren docs connection-info <ds>`. These need an extra step:

**BigQuery** — `credentials` must be a base64-encoded service-account JSON:

```bash
base64 -i /path/to/service-account.json | pbcopy   # macOS
base64 /path/to/service-account.json               # Linux
```

Paste the resulting string into `BIGQUERY_CREDENTIALS=` (or directly into the profile field if not using `.env`).

**Snowflake** — `account` is the account locator from your URL, e.g. `xy12345.us-east-1` (not the full hostname). `warehouse`, `database`, and `schema` must already exist and be accessible to the user.

**Trino / Presto** — `catalog` and `schema` are required even though most clients let you omit them. Set both even if you plan to fully-qualify table names in queries.

**Athena** — Requires `s3_staging_dir` (an S3 URI for query results) and AWS credentials, either via `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` env vars or the standard AWS credentials chain (`~/.aws/credentials`).

**Databricks** — Use a personal access token in `access_token`. The `http_path` is the SQL warehouse HTTP path from the workspace UI.

**MySQL on macOS** — If `pip install "wren-engine[mysql]"` fails to build `mysqlclient`, install the system dependencies first:

```bash
brew install mysql-client pkg-config
export PKG_CONFIG_PATH="$(brew --prefix mysql-client)/lib/pkgconfig"
pip install "wren-engine[mysql,main]"
```

Verify `mysql-client` is actually installed (`brew list mysql-client`) — `brew --prefix` returns a path even when the keg is missing, which is misleading.

---

## Step 3 — Verify the connection

```bash
wren profile debug    # show resolved config (secrets masked)
wren --sql "SELECT 1" # test actual connectivity
```

If the connection fails, check:

- **Credentials** — run `wren profile debug` to see what was saved (passwords are masked)
- **Network access** — can your machine reach the database host and port?
- **SSL** — some databases require SSL. Add the relevant SSL fields to your profile
- **Firewall / IP allowlist** — cloud databases (BigQuery, Snowflake, Redshift) may require your IP to be allowlisted

---

## Step 4 — Initialize a project

Create a directory for your MDL project:

```bash
mkdir ~/my-project && cd ~/my-project
wren context init
```

This scaffolds:

```
my-project/
├── wren_project.yml       # project metadata
├── models/                # one folder per model
├── views/                 # reusable SQL views
├── relationships.yml      # join definitions
└── instructions.md        # business rules for the AI
```

Remove the example placeholders:

```bash
rm -rf models/example_model views/example_view
```

---

## Step 5 — Generate MDL from your database

### With an AI agent (recommended)

Open your AI agent in the project directory and ask:

```
Use the wren-generate-mdl skill to explore my database and generate
the MDL for all tables. The data source is postgres.
```

The agent will introspect your schema, normalize types, write model files, infer relationships, and build the manifest.

### Manually

If you prefer manual control:

**a. Discover tables:**

```bash
wren --sql "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'" -o json
```

**b. Create a model file** for each table:

```yaml
# models/orders/metadata.yml
name: orders
table_reference:
  catalog: ""
  schema: public
  table: orders
primary_key: order_id
columns:
  - name: order_id
    type: INTEGER
    not_null: true
    is_primary_key: true
  - name: customer_id
    type: INTEGER
  - name: total
    type: "DECIMAL(10,2)"
  - name: status
    type: VARCHAR
    properties:
      description: "Order status: pending, shipped, delivered, cancelled"
  - name: order_date
    type: DATE
```

Use `wren utils parse-type` to normalize database-specific types:

```bash
wren utils parse-type --type "character varying(255)" --dialect postgres
# → VARCHAR(255)
```

**c. Define relationships** in `relationships.yml`:

```yaml
relationships:
  - name: orders_customers
    models:
      - orders
      - customers
    join_type: MANY_TO_ONE
    condition: orders.customer_id = customers.customer_id
```

**d. Validate and build:**

```bash
wren context validate
wren context build
```

---

## Step 6 — Index memory and start querying

```bash
wren memory index
wren memory status    # should show schema_items > 0
```

Now query your data:

```bash
wren --sql "SELECT * FROM orders LIMIT 5"
```

Or ask questions in natural language through your AI agent:

```
How many orders were placed last month?
```

---

## Adding descriptions

Good descriptions significantly improve AI query accuracy. Add them to models and columns via `properties.description`:

```yaml
name: orders
properties:
  description: "Customer orders with payment status and shipping details"
columns:
  - name: total
    type: "DECIMAL(10,2)"
    properties:
      description: "Net order total in USD after discounts, before tax"
```

After adding descriptions, rebuild and re-index:

```bash
wren context build
wren memory index
```

---

## Adding instructions

`instructions.md` contains business rules that guide the AI agent:

```markdown
## Naming conventions
- "revenue" always means net_total, not gross_total
- "active customers" = customers with at least one order in the last 90 days

## Query rules
- Always filter by status = 'completed' unless explicitly asked for all statuses
- Use order_date for time-based filtering, not created_at
```

Instructions are loaded by the agent at session start and included in memory search results.

---

## Troubleshooting

### `wren: command not found`

The package is installed but the bin directory isn't on `PATH`. Run `pip show wren-engine` to find the install location, then add the matching `bin/` directory to `PATH` — or activate the virtualenv if you used one.

### `pip install` fails with `externally-managed-environment`

PEP 668 protects system Python on Linux/macOS. Use a virtualenv:

```bash
python3 -m venv ~/.venvs/wren && source ~/.venvs/wren/bin/activate
pip install "wren-engine[<your-ds>,main]"
```

### `wren profile add` reports a missing secret

```
⚠ Cannot validate: '${POSTGRES_PASSWORD}' is not set in the environment
or any discovered .env file.
```

The profile references a `${VAR}` that isn't defined. Fill in the matching key in your `.env` and re-run `wren profile add`. The CLI looks for `.env` in:

1. `os.environ` (anything you `export`ed before running `wren`)
2. `$CWD/.env` (where you ran the command from)
3. `<project_root>/.env` (next to `wren_project.yml`)
4. `~/.wren/.env` (user-global fallback)

### Driver authentication failed

Examples: MySQL `1044 Access denied`, Postgres `password authentication failed`, BigQuery `403 Permission denied`.

`wren profile add` surfaces the driver error verbatim. Fix the credentials in `.env` (or the relevant cloud-side IAM permission) and re-run. Use `wren profile debug <name>` to see the resolved fields with secrets masked.

### `Pydantic ValidationError: Field required`

A required field is missing from the imported `--from-file`. Run `wren docs connection-info <ds>` to see the full list, add the missing key to your `.env` and the corresponding `${VAR}` to the profile YAML, then re-run.

### `unknown datasource: <name>`

Check the canonical name with `wren docs connection-info` (no argument) — it lists every supported source. Most aliases (`gcs_file`, `local_file`, etc.) are listed there too.

### Connection refused / host unreachable

```
[Errno 61] Connection refused
```

- Can your machine reach the host? `nc -zv <host> <port>` is a quick check.
- Cloud DBs (BigQuery, Snowflake, Redshift, RDS): is your egress IP allow-listed?
- VPN / corporate firewall in the way?

### `'dict' object has no attribute 'kwargs'`

You're on a wren-engine version older than 0.3.1, where validation swallowed driver errors. Upgrade:

```bash
pip install --upgrade "wren-engine[main]"
```

### `wren context validate` warnings

Warnings are grouped by category once there are more than 10 — pass `--verbose` to see each line. Common categories:

- **Missing description** — cosmetic; agents can still answer questions without it.
- **Missing `primary_key`** — not always a bug; junction / log tables legitimately have no PK.
- **Invalid relationship condition** — real bug. Regenerate via the `wren-generate-mdl` skill, or fix manually.

### "table not found" after building

Model names in SQL must match the `name` field in your YAML, not the physical table name. Run `wren context show` to see available models.

### Wrong column types

Always normalize types through `wren utils parse-type --dialect <your-datasource>`. Raw database types like `int8` or `character varying` may not be recognized.

### Memory returns irrelevant results

Re-index after every MDL change: `wren context build && wren memory index`. Add `properties.description` to improve search quality.

### Switching between databases

Create separate profiles for each database and switch with `wren profile switch <name>`. The same project can work with different profiles if the schema is compatible.
