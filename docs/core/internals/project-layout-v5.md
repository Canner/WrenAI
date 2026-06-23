# Wren project layout (v5)

> **Internal engineering doc.** Lives in `docs/core/internals/` and is not published to the
> docs site. It describes the on-disk structure of a Wren project at `schema_version: 5`
> for contributors working on the project reader/writer (`core/wren/src/wren/context.py`)
> and the GenBI app tooling (`core/wren/src/wren/genbi/`).
>
> For the user-facing field surface of each YAML artifact, see the
> [MDL schema reference](../reference/mdl.md).

A Wren project is a directory of YAML/SQL source plus a few generated artifacts. v5 is the
current layout: per-model and per-view folders, `cubes/` as pre-aggregated semantic
objects, a first-class `knowledge/` base, and GenBI `apps/` as generated front-ends.

## Version axes

A project carries two **independent** version numbers:

| Axis | File | What it versions |
|------|------|------------------|
| `schema_version` | `wren_project.yml` | the **project layout shape** — file paths, directory structure, required fields |
| `layoutVersion` | `target/mdl.json` (generated) | the **engine wire format** of the compiled manifest |

`schema_version` is the source of truth; `layoutVersion` is derived at build time from it.

**v5 → `layoutVersion: 3`.** `schema_version 4` (composite primary keys) already moved the
engine wire format to `layoutVersion 3`. v5 adds only on-disk project content
(`knowledge/`, per-folder layout) that is **not** part of the compiled engine MDL, so it
reuses `layoutVersion 3` — `models` / `views` / `relationships` / `cubes` still compile to
the same JSON shape. See `_LAYOUT_VERSION_MAP` in `context.py`.

## Directory structure

```text
<project>/
├── wren_project.yml                # schema_version: 5 + name / catalog / schema / data_source
│
├── models/<name>/                  # MDL — one folder per model
│   ├── metadata.yml                #   columns, primary_key, table_reference, …
│   └── ref_sql.sql                 #   optional — SQL-defined model body (overrides inline ref_sql)
├── views/<name>/                   # MDL — one folder per view
│   ├── metadata.yml                #   view definition
│   └── sql.yml                     #   optional — statement in a separate file
├── relationships.yml               # MDL — all relationships
├── cubes/<name>/                   # MDL — pre-aggregated semantic objects
│   └── metadata.yml                #   base_object, measures, dimensions, time_dimensions, hierarchies
│
├── knowledge/                      # knowledge base (committed)
│   ├── rules/                      #   business rules (absorbs the legacy instructions.md)
│   ├── glossary/<term>.md
│   ├── metrics/
│   ├── caveats/
│   ├── sql/<slug>.md               #   NL→SQL pairs — source of truth for semantic memory
│   └── knowledge.yml               #   schema_version (knowledge axis — decoupled from MDL)
│
├── apps/<name>/                    # GenBI apps — generated front-ends (see below)
│   ├── index.html                  #   entry point
│   ├── mdl.json                    #   compiled MDL copied into the app
│   └── *.parquet | *.duckdb        #   snapshot data assets (snapshot mode only)
│
├── instructions.md                 # business / operational guidance for agents (legacy; see knowledge/rules/)
├── AGENTS.md                       # agent guidance for this project
│
├── .wren/                          # runtime state (gitignored)
│   ├── apps.yml                    #   GenBI app index — machine-written by `wren genbi register`
│   └── memory/                     #   LanceDB semantic-memory index
└── target/
    └── mdl.json                    # build artifact (gitignored) — `wren context build` output
```

## MDL — `models/`, `views/`, `relationships.yml`, `cubes/`

The data model. Each model and view is a folder with a `metadata.yml` and an optional
sidecar SQL file (`ref_sql.sql` for models, `sql.yml` for views); the sidecar, when
present, takes precedence over any inline SQL in `metadata.yml`. Relationships live in a
single top-level `relationships.yml`.

`cubes/<name>/metadata.yml` declares a pre-aggregated semantic object over a base model or
view — its measures, dimensions, time dimensions, and hierarchies. Cubes are queried
structurally via `wren cube query`.

All four compile into `target/mdl.json` via `wren context build`. The reader dispatches on
`schema_version`: v1 used flat files (`models/*.yml`, `views.yml`, `cubes/*.yml`); v2
onward — including v5 — uses the per-folder layout above. See the
[MDL schema reference](../reference/mdl.md) for every field.

## knowledge/

The knowledge base carries everything the database schema cannot: business rules
(superseding the older single-file `instructions.md`), glossary terms, named metrics,
caveats, and the NL→SQL pairs under `sql/` that are the source of truth for semantic
memory. It has its **own** `schema_version` in `knowledge.yml`, decoupled from the MDL
axis because knowledge and the data model evolve on different cadences.

## GenBI apps — `apps/` and `.wren/apps.yml`

`wren genbi` scaffolds, builds, and deploys small front-end apps generated from the
project. Each app is a self-contained folder under `apps/<name>/`:

- `index.html` — the app entry point.
- `mdl.json` — a copy of the compiled MDL the app queries against.
- snapshot data assets (`*.parquet` / `*.duckdb`) — in **snapshot** data mode the data is
  bundled with the app and queried client-side via wasm. (Other data modes query a live
  source and ship no data asset.)

Because an app ships to a public static host, the build verifies each `apps/<name>/`
folder — entry point present, `mdl.json` valid and non-empty, snapshot apps carry a data
asset, and no secrets are bundled.

The app **index** lives at `.wren/apps.yml` — a machine-written registry (status state
machine: `scaffolded → built → deployed`), mirroring how `~/.wren/profiles.yml` indexes
connection profiles. It is never hand-edited and lives in the gitignored `.wren/` runtime
directory.

## Generated vs. committed

| Path | Nature |
|------|--------|
| `models/`, `views/`, `relationships.yml`, `cubes/` | committed MDL source |
| `knowledge/` | committed knowledge base |
| `instructions.md`, `AGENTS.md` | committed agent guidance |
| `apps/<name>/` | generated front-ends (committed when you want to track/deploy them) |
| `.wren/` (`apps.yml`, `memory/`) | runtime state — gitignored |
| `target/mdl.json` | build artifact — gitignored |

## Constants (`core/wren/src/wren/context.py`)

```python
_SUPPORTED_SCHEMA_VERSIONS = {1, 2, 3, 4, 5}
_LATEST_SCHEMA_VERSION      = 5                       # = max(_SUPPORTED_SCHEMA_VERSIONS)
_LAYOUT_VERSION_MAP         = {1: 1, 2: 1, 3: 2, 4: 3, 5: 3}
```

A worked example of the full v5 layout ships at
[`examples/v5-jaffle/`](https://github.com/Canner/WrenAI/tree/main/examples/v5-jaffle).
