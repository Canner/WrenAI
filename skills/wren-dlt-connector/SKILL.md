---
name: wren-dlt-connector
description: "Connect SaaS data (HubSpot, Stripe, Salesforce, GitHub, Slack, etc.) to Wren Engine for SQL analysis. Guides the user through the full flow: install dlt, pick a SaaS source, set up credentials, run the data pipeline into DuckDB, then auto-generate a Wren semantic project from the loaded data. Use this skill whenever the user mentions: connecting SaaS data, importing data from an API, dlt pipelines, loading HubSpot/Stripe/Salesforce/GitHub/Slack data, querying SaaS data with SQL, or setting up a new data source from a REST API. Also trigger when the user already has a dlt-produced DuckDB file and wants to create a Wren project from it."
license: Apache-2.0
---

# wren-dlt-connector — moved into the `wren` CLI

This skill's content now lives inside the `wren` CLI itself, so it always
matches the installed wren-engine version. Fetch it with:

```bash
wren skills get dlt-connector
```

Add `--full` to include the reference docs, or `--script <name>` for any
bundled scripts. Run `wren skills list` to see everything available.
