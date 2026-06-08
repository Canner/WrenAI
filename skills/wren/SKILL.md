---
name: wren
description: "Wren CLI for AI agents — a semantic SQL layer over 22+ databases (Postgres, MySQL, BigQuery, Snowflake, Spark, …). The actual workflow guides live inside the `wren` CLI itself; this is just a discovery stub. Use whenever the user asks a data question (how many, show me, top N, compare, trend, breakdown, metric, revenue, customers, orders), wants to install / set up Wren Engine, connect a new database, connect SaaS data via dlt (HubSpot, Stripe, Salesforce, GitHub, Slack), generate or regenerate an MDL project from a database schema, enrich a project with business context (enum meanings, units, cubes like ARR / DAU / churn), or build an interactive data app / dashboard from natural language (hosted locally, returns a localhost URL). Triggers: 'install wren', 'set up wren engine', 'connect database to wren', 'connect SaaS to wren', 'load hubspot / stripe / salesforce data', 'generate mdl', 'scaffold wren project', 'enrich wren context', 'augment my project', 'add cubes', 'build a dashboard', 'make a data app', 'visualize this', 'a chart I can filter', 'switch dimensions', 'wren onboarding', 'wren usage', 'wren generate mdl', 'wren dlt connector', 'wren enrich context', 'wren genbi'."
license: Apache-2.0
allowed-tools: Bash(wren:*)
---

# Wren CLI

This is a discovery stub. The actual workflow guides and prompt helpers
live inside the `wren` CLI itself, so they always match the installed
wren-engine version (no skill cache, no version drift).

Install: `pip install wrenai`.

## Workflow guides

```bash
wren skills list                        # all available workflow guides
wren skills get onboarding              # set up Wren end-to-end
wren skills get usage                   # day-to-day querying
wren skills get generate-mdl            # generate MDL from a database schema
wren skills get dlt-connector           # connect SaaS sources via dlt
wren skills get enrich-context          # add business context (units, enums, cubes)
wren skills get data-app                # build an interactive Streamlit dashboard (needs `[genbi]` extra)
# add --full to include the skill's reference docs
# add --script <name> to fetch a bundled script (e.g. dlt-connector / introspect_dlt)
```

## Reference docs

Full reference docs live on the web: <https://github.com/Canner/WrenAI/tree/main/docs/core>

```bash
wren docs connection-info <ds>          # required + optional connection fields for a data source
```

## Prompt enhancement (wraps a user question for an agent)

```bash
wren ask "<question>" --guided          # for weaker LLMs (strict task flow)
wren ask "<question>" --direct          # for stronger LLMs (minimal wrapping)
```

## Day-to-day data commands (not a sub-app — top-level)

```bash
wren --sql '...'                        # execute SQL through the MDL layer
wren query --sql '...'                  # same, explicit
wren dry-plan --sql '...'               # transpile only, no DB hit
wren context show / build / validate    # project / MDL lifecycle
wren profile add / list / switch        # named connection profiles
wren memory index / recall / store      # semantic memory (needs `[memory]` extra)
```

Run `wren --help` for the full surface; load the matching `wren skills get
<name>` guide before driving any multi-step workflow.
