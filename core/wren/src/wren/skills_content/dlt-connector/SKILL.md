---
name: dlt-connector
description: "Connect SaaS data (HubSpot, Stripe, Salesforce, GitHub, Slack, etc.) to Wren Engine for SQL analysis. Guides the user through the full flow: install dlt, pick a SaaS source, set up credentials, run the data pipeline into DuckDB, then auto-generate a Wren semantic project from the loaded data. Use this skill whenever the user mentions: connecting SaaS data, importing data from an API, dlt pipelines, loading HubSpot/Stripe/Salesforce/GitHub/Slack data, querying SaaS data with SQL, or setting up a new data source from a REST API. Also trigger when the user already has a dlt-produced DuckDB file and wants to create a Wren project from it."
license: Apache-2.0
metadata:
  author: wrenai
---

# wren-dlt-connector

> Reference docs (`dlt_sources`) and the `introspect_dlt` script are bundled. Pull references with `wren skills get dlt-connector --full`; fetch a script with `wren skills get dlt-connector --script <name>`.

Connect SaaS data to Wren Engine for SQL analysis — from zero to a verified, queryable project in one conversation.

## Who this is for

Data analysts who know SQL and some Python, but may not have used dlt or Wren before. Explain concepts briefly when they first appear, but don't over-explain things a SQL-literate person would already know.

## Overview

This skill walks through a four-phase workflow:

1. **Extract** — Use dlt (data load tool) to pull data from a SaaS API into a local DuckDB file
2. **Model** — Introspect the DuckDB schema and auto-generate a Wren semantic project (YAML models, relationships, profile)
3. **Build & Verify** — Build the project and run actual SQL queries to confirm everything works end-to-end
4. **Handoff** — Show the user their data and next steps

The user might enter at any phase. Ask which phase they're starting from — they may already have a `.duckdb` file and just need phases 2–4.

**The goal is a project that actually queries successfully, not just files that look correct.** Always run the verification step before declaring success.

## Critical: DuckDB catalog naming

When wren engine connects to a DuckDB file, it ATTACHes it using the filename (without `.duckdb` extension) as the catalog alias:

```
ATTACH DATABASE 'stripe_data.duckdb' AS "stripe_data" (READ_ONLY)
```

This means **every model's `table_reference.catalog` must equal the DuckDB filename stem**. If the file is `hubspot.duckdb`, the catalog is `hubspot`. If it's `my_pipeline.duckdb`, the catalog is `my_pipeline`.

Getting this wrong causes "table not found" errors at query time. The `introspect_dlt.py` script handles this automatically.

## Critical: Type normalization

Column types must be normalized using wren SDK's `type_mapping.parse_type()` function, which uses sqlglot to convert database-specific types (like DuckDB's `HUGEINT`, `TIMESTAMP WITH TIME ZONE`) into canonical SQL types that wren-core understands. Do not hardcode type mappings — always delegate to `parse_type(raw_type, "duckdb")`.

The `introspect_dlt.py` script does this automatically when wren SDK is installed.

## Phase 1: Extract — dlt Pipeline Setup

### Step 1: Pick the SaaS source

Ask the user which SaaS service they want to connect. Read `dlt_sources` for a list of popular verified sources and their auth requirements. If the source isn't listed, check whether dlt has a verified source for it by searching `dlthub.com/docs/dlt-ecosystem/verified-sources`.

### Step 2: Install dlt

```bash
pip install "dlt[duckdb]" --break-system-packages
```

### Step 3: Write the pipeline script

Create a Python script that:
1. Imports the dlt source function for the chosen SaaS
2. Configures the pipeline with `destination='duckdb'` and a local file path
3. Runs the pipeline with `pipeline.run(source)`

Here's the general pattern — adapt it per source (check `dlt_sources` for source-specific templates):

```python
import dlt

pipeline = dlt.pipeline(
    pipeline_name="<source>_pipeline",
    destination="duckdb",
    dataset_name="<source>_data",
)

# Source-specific: check the dlt_sources reference for auth patterns
source = <source_function>(api_key=dlt.secrets.value)

info = pipeline.run(source)
print(info)
```

### Step 4: Set up credentials

dlt reads credentials from environment variables or `.dlt/secrets.toml`. The simplest approach for a one-time run:

```bash
# Set the credential as an environment variable
# The exact variable name depends on the source — check the dlt_sources reference
export SOURCES__<SOURCE>__API_KEY="the-actual-key"
```

Ask the user for their API key or token. Remind them:
- Never commit credentials to git
- Environment variables are the simplest way for a one-time run
- For repeated use, they can create `.dlt/secrets.toml`

### Step 5: Run the pipeline

```bash
python <pipeline_script>.py
```

After the run, confirm:
1. The pipeline completed without errors
2. A `.duckdb` file was created (usually at `<pipeline_name>.duckdb`)
3. Print discovered tables and their column counts

```python
import duckdb

con = duckdb.connect("<pipeline_name>.duckdb", read_only=True)
for row in con.execute("""
    SELECT table_schema, table_name,
           (SELECT COUNT(*) FROM information_schema.columns c
            WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name) as col_count
    FROM information_schema.tables t
    WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
      AND table_name NOT LIKE '_dlt_%'
    ORDER BY table_schema, table_name
""").fetchall():
    print(f"  {row[0]}.{row[1]} ({row[2]} columns)")
con.close()
```

## Phase 2: Model — Generate Wren Project

Run the introspection script to auto-generate a complete Wren project from the DuckDB file:

```bash
# first fetch the script: wren skills get dlt-connector --script introspect_dlt > introspect_dlt.py
python introspect_dlt.py \
    --duckdb-path <path-to-duckdb-file> \
    --output-dir <project-directory> \
    --project-name <name>
```

This script:
- Connects to the DuckDB file (read-only)
- **Sets `table_reference.catalog` to the DuckDB filename stem** (matching wren engine's ATTACH behavior)
- Discovers all tables and columns via `information_schema`
- Filters out dlt internal tables (`_dlt_loads`, `_dlt_pipeline_state`, etc.)
- Filters out dlt metadata columns (`_dlt_id`, `_dlt_load_id`, `_dlt_list_idx`) from model definitions
- Detects parent-child relationships from `_dlt_parent_id` columns and table naming conventions
- **Normalizes column types using `wren.type_mapping.parse_type()`** (sqlglot-based)
- Generates a complete v5 YAML project (wren_project.yml, models/, relationships.yml, knowledge/rules/)

After running, show the user what was generated:

```bash
# Show project summary
cat <project-directory>/wren_project.yml
echo "---"
ls <project-directory>/models/
echo "---"
cat <project-directory>/relationships.yml
```

### Verify model correctness

Spot-check one generated model to confirm:
1. `table_reference.catalog` matches the DuckDB filename (e.g., `stripe_data` for `stripe_data.duckdb`)
2. `table_reference.schema` matches the DuckDB schema (usually `main`)
3. No `_dlt_*` columns appear in the columns list
4. Column types look reasonable (VARCHAR, BIGINT, BOOLEAN, TIMESTAMP, etc.)

### Set up the connection profile

Create a Wren profile so the user can query without specifying connection details every time. The `url` must point to the **directory containing** the `.duckdb` file (not the file itself):

```python
import yaml
from pathlib import Path

wren_home = Path.home() / ".wren"
wren_home.mkdir(exist_ok=True)
profiles_file = wren_home / "profiles.yml"

existing = (
    (yaml.safe_load(profiles_file.read_text()) or {}) if profiles_file.exists() else {}
)
existing.setdefault("profiles", {})

profile_name = "<source>_dlt"
existing["profiles"][profile_name] = {
    "datasource": "duckdb",
    "url": str(Path("<duckdb-path>").resolve().parent),
    "format": "duckdb",
}
existing["active"] = profile_name

profiles_file.write_text(yaml.dump(existing, default_flow_style=False, sort_keys=False))
```

## Phase 3: Build & Verify — The Project Must Actually Work

This phase is not optional. A project that generates YAML but fails at query time is not a success.

### Step 1: Build the MDL

```bash
cd <project-directory>
wren context build
```

This compiles the YAML models into `target/mdl.json`. If this fails, fix the issues before proceeding (see Troubleshooting below).

### Step 2: Validate with a real query

Run at least one query per generated model to confirm the project is functional:

```bash
# For each model, verify it resolves correctly
wren --sql 'SELECT COUNT(*) as total FROM "<table_name>"'
```

If any query fails, debug and fix the model before moving on. Common issues:
- Wrong catalog in table_reference → "table not found"
- Type mismatch → fix the column type in metadata.yml
- Missing profile → check `wren profile list`

### Step 3: Run interesting queries

Once basic queries pass, run 2–3 more interesting queries to show the user what their data looks like:

```bash
# Preview data
wren --sql 'SELECT * FROM "<table_name>" LIMIT 5'

# If there's a relationship, verify both models are queryable
wren --sql 'SELECT * FROM "<parent>" LIMIT 5'
wren --sql 'SELECT * FROM "<child>" LIMIT 5'
```

Show the results to the user and explain what they're seeing. This is their first look at the data through Wren — make it count.

### Step 4: Confirm success

Only after queries return real data, tell the user the setup is complete. Summarize:
- How many models were created
- What relationships were detected
- Which profile is active
- Example queries they can try next

### Next step: share it as an app

The project is now DuckDB-backed, which is exactly what GenBI snapshot mode
wants. If the user wants to turn this data into a shareable dashboard / web app
and deploy it (Vercel / Cloudflare), hand off to the GenBI workflow:
`wren skills get genbi`. Its snapshot source is the very `.duckdb` file this
pipeline produced.

## Troubleshooting

If `wren context build` fails:
- Check that `data_source: duckdb` is set in `wren_project.yml`
- Verify the DuckDB file path in the profile is correct
- Run `wren context validate` for detailed error messages

If queries fail with "table not found":
- **Most likely cause:** `table_reference.catalog` doesn't match the DuckDB filename. If the file is `pipeline.duckdb`, the catalog must be `pipeline`, not empty string.
- Check the profile's `url` points to the directory containing the `.duckdb` file
- Table names with double underscores need quoting: `"hubspot__contacts"`

If queries fail with type errors:
- Check column types in the model YAML — they should be canonical SQL types (VARCHAR, BIGINT, etc.)
- Re-run `introspect_dlt.py` with wren SDK installed to get proper type normalization

General:
- Check that the profile is active: `wren profile list`
- The DuckDB file might be locked if a dlt pipeline is running — wait for it to finish

## Important notes

- dlt's `_dlt_parent_id` / `_dlt_id` columns are kept in the actual DuckDB tables but hidden from Wren model definitions. They're only used in relationship conditions.
- DuckDB has a single-writer limitation. Don't run a dlt sync while querying. For concurrent access, dlt should write to a separate file and swap atomically.
- The generated models use `table_reference` (not `ref_sql`) since they map directly to DuckDB tables created by dlt.
- Column types are normalized using wren SDK's `parse_type()` with sqlglot's DuckDB dialect. If a type looks wrong, the user can edit the model's `metadata.yml` directly.
