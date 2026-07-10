---
sidebar_label: Migration
---

# Migration

How to move an existing project forward when the project layout `schema_version` changes.
Each migration is forward-only, idempotent, and non-destructive — your existing files stay
in place until you've verified the result. Run `wren context upgrade` to go to the latest
version; the per-version notes below cover anything beyond the automatic restamp.

## Migrating to schema version 5

Version 5 keeps the per-folder MDL layout and adds **`knowledge/`** as a first-class home
for business rules and NL→SQL pairs — the content that previously lived in
`instructions.md`, `queries.yml`, and the Qdrant memory index.

> New projects from `wren context init` are already v5 — these steps are only for projects
> created before v5.

### 1. Upgrade the layout

```bash
wren context upgrade --dry-run   # preview created/modified files
wren context upgrade             # restamp to schema_version 5 and create knowledge/
```

For a v2–v4 project this bumps `schema_version` to 5 and creates the `knowledge/` skeleton
(`rules/`, `glossary/`, `metrics/`, `caveats/`, `sql/`, and `knowledge.yml`); a v1 project
is also restructured into the per-folder layout on the way through.

### 2. Move business rules into `knowledge/rules/`

`instructions.md` still works — `wren context build` and `wren memory index` read it
alongside `knowledge/rules/*.md` — but it is **deprecated** and prints a notice. Move its
content under `knowledge/rules/` (split by topic if you like):

```bash
mv instructions.md knowledge/rules/general.md
```

### 3. Migrate semantic memory to markdown

In v5 the markdown files under `knowledge/sql/` are the **source of truth** for NL→SQL
pairs; the Qdrant index becomes a derived artifact rebuilt from them (like
`target/mdl.json` is rebuilt from your YAML).

If you have an existing Qdrant memory at `~/.wren/memory`, export it (requires the
`memory` extra to read Qdrant):

```bash
wren memory export                 # query_history → knowledge/sql/*.md
wren memory index                  # rebuild the derived index from knowledge/sql/
wren memory recall -q "revenue"    # verify recall still works
wren memory reset                  # once verified — drops the derived index only
```

`export` preserves each pair's source and timestamp, deduplicates by question, and **never
deletes Qdrant** — you reset it yourself after verifying. Auto-generated seed pairs are
skipped (they're regenerated on `index`); pass `--include-seed` to keep them. `queries.yml`
is still loaded on `index` for the transition, but new pairs from `wren memory store` now
land in `knowledge/sql/`.

`store`, `index`, and `recall` all work **without** `wren[memory]` — pairs are written to
and searched over `knowledge/sql/` directly. Install `wren[memory]` only for semantic
(embedding) recall and schema search. See the
[CLI reference](./cli.md#wren-memory--schema--query-memory).

After migration the project is self-contained and git-friendly: MDL, `knowledge/`, and (on
SaaS) `policy/` live together, and the memory index is reproducible from committed
markdown. See the [MDL schema reference](./mdl.md) for the full layout.
