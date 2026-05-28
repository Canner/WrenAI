---
name: wren-generate-mdl
description: "Generate a Wren MDL project by exploring a database with available tools (SQLAlchemy, database drivers, MCP connectors, or raw SQL). Guides agents through schema discovery, type normalization, and MDL YAML generation using the wren CLI. Use when: user wants to create or set up a new MDL, onboard a new data source, or scaffold a project from an existing database."
license: Apache-2.0
---

# wren-generate-mdl — moved into the `wren` CLI

This skill's content now lives inside the `wren` CLI itself, so it always
matches the installed wren-engine version. Fetch it with:

```bash
wren skills get generate-mdl
```

Add `--full` to include the reference docs, or `--script <name>` for any
bundled scripts. Run `wren skills list` to see everything available.
