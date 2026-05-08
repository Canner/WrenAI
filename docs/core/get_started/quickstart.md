# Quick Start: Wren CLI with jaffle_shop

Use natural-language questions against the **jaffle\_shop** dataset using **Wren AI Core CLI** and **Claude Code** — no cloud database, no Docker, no MCP server.

> **Time:** ~15 minutes
>
> **What you'll get:** A local semantic layer + memory system that lets an AI agent write accurate SQL by understanding your data's meaning, not just its schema.

---

## Prerequisites

- **Claude Code** — installed and authenticated ([install guide](https://docs.anthropic.com/en/docs/claude-code/overview))
- **Python 3.11+**
- **Node.js / npm** — required if using `npx` to install skills (see Step 3)
- **Git**

---

## Step 0 — Create a Python virtual environment

Create and activate a virtual environment before installing any packages. This keeps dbt and wren-engine dependencies isolated from your system Python:

```bash
python3 -m venv ~/.venvs/wren
source ~/.venvs/wren/bin/activate
```

> **Tip:** Activate this environment (`source ~/.venvs/wren/bin/activate`) in every new terminal session before running `dbt` or `wren` commands.

---

## Step 1 — Seed the jaffle_shop dataset

Clone the dbt jaffle\_shop project and build the DuckDB database:

```bash
git clone https://github.com/dbt-labs/jaffle_shop_duckdb.git
cd jaffle_shop_duckdb
pip install dbt-core dbt-duckdb
dbt build
```

Verify the database file was created:

```bash
ls jaffle_shop.duckdb
```

Note the **absolute path** to this directory — you'll need it when setting up the profile:

```bash
pwd
# e.g. /Users/you/jaffle_shop_duckdb
```

---

## Step 2 — Install wren-engine Python package

Install `wren-engine` with UI support and memory system:

```bash
pip install "wren-engine[main]"
```

DuckDB is included by default — no extra needed. For other data sources, install the corresponding extra (e.g. `pip install "wren-engine[postgres,main]"`).

> **Available extras:**
> - `postgres`, `mysql`, `bigquery`, `snowflake`, `clickhouse`, `trino`, `mssql`, `databricks`, `redshift`, `athena`, `oracle`, `spark` — data source connectors
> - `main` — memory + interactive prompts + browser-based profile UI

Verify the installation:

```bash
wren version
```

---

## Step 3 — Install CLI skills

Skills are workflow guides that tell your AI coding agent how to use the Wren CLI effectively. Install the skill bundle:

```bash
npx skills add Canner/WrenAI --skill '*'
# or:
curl -fsSL https://raw.githubusercontent.com/Canner/WrenAI/main/skills/install.sh | bash
```

The CLI auto-detects your installed agent. To target a specific one, add `--agent <name>` (e.g., `claude-code`, `cursor`, `windsurf`, `cline`).

This quickstart uses two of the installed skills:

| Skill | Purpose |
|-------|---------|
| **wren-usage** | Day-to-day workflow — gather context, recall past queries, write SQL, store results |
| **wren-generate-mdl** | One-time setup — explore database schema and generate the MDL project |

For the full skill list (including `wren-onboarding` and `wren-dlt-connector`), see [Installation](./installation.md#install-skills).

---

## Step 4 — Set up a profile

A profile stores your database connection info (like dbt profiles). Create one for the jaffle\_shop DuckDB database:

### Option A: Browser UI (recommended)

```bash
wren profile add jaffle-shop --ui
```

This opens a browser form. Fill in:

- **Data source:** `duckdb`
- **Database path:** `/Users/you/jaffle_shop_duckdb` — the **directory** containing `.duckdb` files, not the `.duckdb` file itself (your absolute path from Step 1)

### Option B: Interactive CLI

```bash
wren profile add jaffle-shop --interactive
```

Follow the prompts to enter profile name, data source, and connection fields.

### Option C: From file

Create a YAML file `jaffle-profile.yml`:

```yaml
datasource: duckdb
url: /Users/you/jaffle_shop_duckdb
format: duckdb
```

Then import it:

```bash
wren profile add jaffle-shop --from-file jaffle-profile.yml
```

---

Verify the profile is active:

```bash
wren profile list
```

You should see `jaffle-shop` marked as active. Test the connection:

```bash
wren profile debug
```

---

## Step 5 — Initialize a Wren project

Create a new directory for your project and scaffold the project structure:

```bash
mkdir -p ~/jaffle-wren && cd ~/jaffle-wren
wren context init
```

This creates:

```
~/jaffle-wren/
├── wren_project.yml        # project metadata
├── models/                 # one folder per table
├── views/                  # reusable SQL views
├── relationships.yml       # table join definitions
└── instructions.md         # business rules for the AI
```

The generated `wren_project.yml` contains default values for `catalog` and `schema`:

> **Note:** `catalog` and `schema` in `wren_project.yml` define the **Wren AI Core namespace** — they have nothing to do with your database's catalog or schema. Keep the defaults (`wren` / `public`). The actual database location of each table is specified per-model in the `table_reference` section.

Bind the profile you just created to this project:

```bash
wren context set-profile jaffle-shop
```

This writes `profile: jaffle-shop` and `data_source: duckdb` into `wren_project.yml`, locking this project to its connection. Future commands (and the SDK) use the bound profile regardless of which profile is globally active — so `wren profile switch` elsewhere can't accidentally redirect this project's queries.

---

## Step 6 — Generate MDL with Claude Code

First, remove the example model and view that `wren context init` created — they are placeholders and will be replaced by the generated models:

```bash
rm -rf models/example_model views/example_view
```

Now let Claude Code explore the database and generate the MDL project files. Open Claude Code **in the project directory**:

```bash
cd ~/jaffle-wren
claude
```

Then ask:

```
Use the wren-generate-mdl skill to explore the jaffle_shop database
and generate the MDL for all tables. The data source is DuckDB.
```

Claude Code will:

1. **Discover tables** — `customers`, `orders`, `products`, `supplies`, etc.
2. **Introspect columns and types** — using SQLAlchemy or `information_schema`
3. **Normalize types** — via `wren utils parse-type`
4. **Write model YAML files** — one folder per table under `models/`
5. **Infer relationships** — from foreign keys and naming conventions
6. **Add descriptions** — Claude may ask you to describe key tables/columns
7. **Validate and build** — `wren context validate` → `wren context build`
8. **Index memory** — `wren memory index` (generates seed NL-SQL examples)

After completion, verify the project:

```bash
wren context show
wren memory status
```

---

## Step 7 — Start asking questions

You're ready to go. In Claude Code, just ask questions in natural language:

```
How many customers placed more than one order?
```

```
What are the top 5 products by total revenue?
```

```
Show me the monthly order count trend.
```

Behind the scenes, Claude Code uses the **wren-usage** skill to:

1. **Fetch context** (`wren memory fetch`) — find relevant tables and columns for your question
2. **Recall examples** (`wren memory recall`) — find similar past queries
3. **Write SQL** — using the semantic layer (model names, not raw table names)
4. **Execute** (`wren --sql "..."`) — run through the Wren engine
5. **Store** (`wren memory store`) — save successful NL-SQL pairs for future recall

The more you ask, the smarter the system gets — each stored query improves future recall accuracy.

---

## What's in the project

After setup, your project directory looks like this:

```
~/jaffle-wren/
├── wren_project.yml
├── models/
│   ├── customers/
│   │   └── metadata.yml        # table schema + descriptions
│   ├── orders/
│   │   └── metadata.yml
│   ├── products/
│   │   └── metadata.yml
│   └── supplies/
│       └── metadata.yml
├── views/
├── relationships.yml           # e.g. orders → customers (many_to_one)
├── instructions.md             # your business rules
├── .wren/
│   └── memory/                 # LanceDB index (auto-managed)
└── target/
    └── mdl.json                # compiled manifest
```

Key files to customize:

- **`instructions.md`** — Add business rules, naming conventions, or query guidelines. Use `##` headings to organize by topic. Example:

  ```markdown
  ## Naming Conventions
  - "revenue" always means order total, not supply cost
  - "active customers" means customers with at least one order in the last 90 days

  ## Query Rules
  - Always use order_date for time-based filtering, not created_at
  ```

- **`models/*/metadata.yml`** — Add or refine `properties.description` on models and columns. Better descriptions = better memory search.

- **`relationships.yml`** — Add or fix join conditions. Wrong relationships cause silent query errors.

After editing any file, rebuild and re-index:

```bash
wren context validate
wren context build
wren memory index
```

---

## Useful commands reference

| Task | Command |
|------|---------|
| Run SQL | `wren --sql "SELECT ..." -o table` |
| Preview planned SQL | `wren dry-plan --sql "SELECT ..."` |
| Validate SQL | `wren dry-run --sql "SELECT ..."` |
| Show project context | `wren context show` |
| Show instructions | `wren context instructions` |
| Build manifest | `wren context build` |
| Fetch context for a question | `wren memory fetch --query "..."` |
| Recall similar queries | `wren memory recall --query "..."` |
| Store a NL-SQL pair | `wren memory store --nl "..." --sql "..."` |
| Check memory status | `wren memory status` |
| Re-index memory | `wren memory index` |
| Switch profile | `wren profile switch <name>` |
| List profiles | `wren profile list` |

---

## Next steps

- **Add views** for frequently asked questions — views with good descriptions become high-quality recall examples
- **Refine instructions** as you discover query patterns the AI gets wrong
