---
sidebar_label: Migrate to v5
---

# Migrate an existing project to v5

Schema version 5 is the current Wren project layout. It keeps the per-folder MDL layout you
already have and adds **`knowledge/`** as a first-class home for business rules and NL→SQL
pairs — the same content that used to live in `instructions.md`, `queries.yml`, and the
LanceDB memory index.

Migration is incremental and non-destructive: each step is forward-only, idempotent, and
leaves your existing files in place until you've verified the result.

> New projects created with `wren context init` are already v5 — this guide is only for
> projects created before v5.

## 1. Upgrade the project layout

```bash
wren context upgrade --dry-run   # preview what changes
wren context upgrade             # restamp to the latest schema_version and create knowledge/
```

`upgrade` is forward-only and idempotent. For a v2–v4 project it bumps `schema_version` to 5
and creates the `knowledge/` skeleton:

```text
knowledge/
├── rules/        # business rules (formerly instructions.md)
├── glossary/
├── metrics/
├── caveats/
├── sql/          # NL→SQL pairs (memory source of truth)
└── knowledge.yml # knowledge-axis schema_version (independent of the MDL one)
```

(A v1 project is restructured to the per-folder layout on the way through.)

## 2. Move business rules into `knowledge/rules/`

`instructions.md` still works — `wren context build` and `wren memory index` read it
alongside `knowledge/rules/*.md` — but it is **deprecated** and prints a notice. Move its
content into one or more files under `knowledge/rules/` (split by topic if you like):

```bash
mv instructions.md knowledge/rules/general.md
```

## 3. Migrate semantic memory to markdown

In v5 the **markdown files under `knowledge/sql/` are the source of truth** for NL→SQL
pairs; the LanceDB index becomes a derived artifact rebuilt from them (like
`target/mdl.json` is rebuilt from your YAML).

If you have an existing LanceDB memory at `~/.wren/memory`, export it (requires the
`memory` extra to read LanceDB):

```bash
wren memory export                 # query_history → knowledge/sql/*.md
wren memory index                  # rebuild the derived index from knowledge/sql/
wren memory recall -q "revenue"    # verify recall still works
wren memory reset                  # once verified — drops the derived index only
```

`export` preserves each pair's source and timestamp, deduplicates by question, and **never
deletes LanceDB** — you reset it yourself only after verifying. Auto-generated seed pairs
are skipped (they're regenerated on `index`); pass `--include-seed` to keep them.

`queries.yml` is still loaded on `index` for the transition, but new pairs written by
`wren memory store` now land in `knowledge/sql/`.

## Without the `memory` extra

`store`, `index`, and `recall` work **without** `wren[memory]`: pairs are written to and
searched over `knowledge/sql/` directly (token/substring matching). Install
`wren[memory]` only when you want semantic (embedding) recall and schema search
(`wren memory fetch`). See the [CLI reference](../reference/cli.md#wren-memory--schema--query-memory).

## Result

After migration your project is self-contained and git-friendly: MDL, `knowledge/`, and
(on SaaS) `policy/` live together, and the memory index is reproducible from committed
markdown. See the [MDL schema reference](../reference/mdl.md) for the full layout.
