---
sidebar_label: Apache Ossie (formerly OSI)
---

# Apache Ossie semantic models: build from, or export to

[Apache Ossie](https://github.com/apache/ossie) (incubating) — formerly **Open Semantic Interchange (OSI)** — is a vendor-neutral specification for semantic models, backed by Snowflake, Salesforce, dbt Labs, Databricks, Cube, AtScale, and others. Wren reads and writes it, so an Ossie file can be the source of truth for Wren, or Wren can be the source of truth for every other Ossie consumer:

```bash
# Ossie → Wren: build target/mdl.json straight from an Ossie file
wren context build --from-ossie semantic_model.yaml --data-source postgres

# Wren → Ossie: publish the project as an Ossie file
wren context export-ossie --output semantic_model.yaml
```

The export is readable by `--from-ossie`, so the two directions round-trip — see [Export a wren project as Ossie](#export-a-wren-project-as-ossie).

:::note Renamed from OSI
The project was renamed from OSI to Apache Ossie when it entered the Apache Incubator. Wren's flags followed: `--from-ossie` and `export-ossie` are the current names. `--from-osi` still works as a deprecated alias of `--from-ossie` and prints a warning each time it is used; it will be removed in a future release.
:::

## Supported spec versions

| Version | Status | Document layout | Wren |
|---|---|---|---|
| `0.1.1` | Released (2025-12) | `semantic_model: [...]` wrapper, one or more models per file; no `datatype` on fields | Read **and** written (default for `export-ossie`) |
| `0.2.0.dev0` | Draft on `main` | One model per file: `name` / `datasets` / `relationships` / `metrics` at the document root; `datatype` enum on fields and metrics | Read **and** written (`export-ossie --spec-version 0.2.0.dev0`) |

Wren detects the layout from the document itself (`semantic_model:` present → wrapper; root-level `datasets:` → draft), so `--from-ossie` takes either without a flag. Everything below is written against the wrapper layout; with the draft layout, read "`semantic_model[i].…`" as "the document root".

## Ossie project vs. wren project

|  | Wren project (native) | Ossie project, kept as source | Ossie project, migrated once |
|---|---|---|---|
| **Source files** | `wren_project.yml` + `models/<name>/metadata.yml` + `views/` + `relationships.yml` | A single `*.yaml` Ossie file | After migration: wren project layout |
| **Author** | You (or the `generate-mdl` agent guide) | Ossie tooling / vendor / external team | You take ownership after `init` |
| **Wren commands** | `wren context init` → edit → `build` | `wren context build --from-ossie <file>` | `wren context init --from-ossie <file>` → edit → `build` |
| **Editable inside Wren?** | Yes — that's the point | No — Wren reads the file as-is | Yes after migration |
| **Where wren-specific hints live** | Each model's YAML | Ossie's `custom_extensions[vendor_name=WREN]` block | Each model's YAML (lifted from Ossie at migration time) |
| **Stays in sync with Ossie?** | Publish with `wren context export-ossie` | Yes — every build re-reads Ossie | No — one-way snapshot (re-export with `export-ossie` if other tools need it) |

Three places you might land:

- **You own the semantic model from day one** → use the native wren project flow.
- **The Ossie file is shared with other tools (Snowflake Cortex, Salesforce, Cube, …) and you want Wren to be one of many consumers without forking** → use `wren context build --from-ossie`. Every build re-reads the Ossie file.
- **You started with an Ossie file but now want full control inside Wren (cubes, views, RLAC, custom calculations Ossie doesn't model)** → use `wren context init --from-ossie` to migrate once, then edit the generated YAML directly. See [Migrate to a native wren project](#migrate-to-a-native-wren-project).

All three paths produce the same `target/mdl.json` shape — Wren doesn't care how you got there.

## Quick start

Suppose you have this Ossie file (excerpted from a TPC-DS retail example):

```yaml
# semantic_model.yaml
version: "0.1.1"
semantic_model:
  - name: tpcds_retail
    ai_context:
      instructions: "Retail analytics. Revenue is in USD."
    datasets:
      - name: store_sales
        source: tpcds.public.store_sales
        primary_key: [ss_item_sk, ss_ticket_number]
        fields:
          - name: ss_item_sk
            expression: ss_item_sk
          - name: ss_ext_sales_price
            expression: ss_ext_sales_price
      - name: customer
        source: tpcds.public.customer
        primary_key: [c_customer_sk]
        fields:
          - name: c_customer_sk
            expression: c_customer_sk
          - name: full_name
            expression:
              dialects:
                - dialect: ANSI_SQL
                  expression: c_first_name || ' ' || c_last_name
    relationships:
      - name: sales_to_customer
        from: store_sales
        to: customer
        from_columns: [ss_item_sk]
        to_columns: [c_customer_sk]
```

Run:

```bash
wren context build --from-ossie semantic_model.yaml --data-source postgres
```

Wren reads the file, converts each dataset to a model, synthesizes relationship join conditions, packs Ossie's `ai_context.instructions` into the manifest, and writes `./target/mdl.json` — ready for `wren --sql` or any agent skill.

You'll also see warnings telling you what's missing for an ideal manifest — see [What needs a `WREN` block](#what-needs-a-wren-block) below.

## The `WREN` extension block

Ossie has no file-system convention for vendor extensions. Its [only sanctioned extension mechanism](https://github.com/apache/ossie/blob/main/core-spec/spec.md) is the in-document `custom_extensions: [{vendor_name, data}]` field, present at every level of the document. Wren reads `vendor_name: WREN` entries and ignores everything else.

A typical extension block at the Ossie document root:

```yaml
custom_extensions:
  - vendor_name: WREN
    data: |
      {
        "dialect": "SNOWFLAKE",
        "metrics": "note"
      }
```

Per-dataset overrides, for the things Ossie cannot express (most importantly: column types):

```yaml
datasets:
  - name: store_sales
    source: tpcds.public.store_sales
    custom_extensions:
      - vendor_name: WREN
        data: |
          {
            "column_types": {
              "ss_sold_date_sk": "DATE",
              "ss_ext_sales_price": "DECIMAL(18,2)",
              "ss_quantity": "INTEGER"
            },
            "primary_key": "ss_ticket_number"
          }
    fields:
      - name: amount_eur
        expression: { dialects: [{dialect: ANSI_SQL, expression: amount * 0.92}] }
        custom_extensions:
          - vendor_name: WREN
            data: '{"type": "DECIMAL(18,2)", "not_null": true}'
```

The `data` field is per spec a JSON string. Wren also tolerates a raw YAML dict for hand-authored files.

### Supported keys

| Key | Scope | Effect |
|---|---|---|
| `dialect` | root, semantic_model | Which Ossie dialect to extract from `expression.dialects[]`. Default: `ANSI_SQL`, with auto-inference for `snowflake` / `databricks` data sources. |
| `metrics` | root, semantic_model | How to handle Ossie top-level `metrics`: `note` (default, append as instructions) or `skip`. |
| `default_semantic_model` | root | When the file has multiple `semantic_model[]` entries, which one to build. |
| `column_types` | semantic_model: `{dataset: {field: type}}`<br/>dataset: `{field: type}` | Column types — Ossie has no native type system. |
| `primary_key` | semantic_model: `{dataset: column}`<br/>dataset: `column` | Pick one column when Ossie defines a composite primary key. |
| `type`, `not_null` | field | Per-field overrides. |

## Precedence

Resolution order, highest to lowest:

1. CLI flag (`--data-source`, `--semantic-model`, `--dialect`, …)
2. `semantic_model[i].custom_extensions[vendor_name=WREN]`
3. `custom_extensions[vendor_name=WREN]` at the document root
4. Dataset / field `custom_extensions[vendor_name=WREN]` (for per-dataset / per-field keys only)
5. Built-in defaults

Two-level support (root + semantic_model) means you can write a global default once and only add overrides on individual `semantic_model` entries that need to differ — for example, when the file contains multiple semantic models.

## Mapping summary

| Ossie | Wren MDL |
|---|---|
| `dataset.source: a.b.c` | `model.table_reference: {catalog: a, schema: b, table: c}` |
| `dataset.source` containing `SELECT`/`FROM`/newlines | `model.ref_sql` |
| `dataset.fields[*].name` + `expression` | `model.columns[]` — dialect-picked expression; type from the WREN block, else `datatype` (0.2.0.dev0), else the `is_time` hint |
| `field.datatype` (0.2.0.dev0) | `column.type` via `String→VARCHAR`, `Integer→BIGINT`, `Decimal→DECIMAL`, `Float→DOUBLE`, `Boolean→BOOLEAN`, `Date→DATE`, `Time→TIME`, `DateTime→TIMESTAMP`, `DateTimeTz→TIMESTAMP WITH TIME ZONE`; `Opaque` counts as untyped. A WREN `type` / `column_types` entry always wins, so precision (`DECIMAL(18,2)`) still comes from the WREN block |
| `dataset.primary_key: [x]` | `model.primary_key: x` (composite arrays warn + take the first column unless overridden) |
| `relationships[]` (always many-to-one in Ossie) | wren `relationships` with synthesized `condition` and `MANY_TO_ONE` |
| `field.dimension.is_time: true` | `column.type: TIMESTAMP` (when no explicit type override) |
| `semantic_model.ai_context.instructions` | MDL `_instructions` |
| `metrics[]` (top-level Ossie) | Rendered as markdown notes appended to instructions |
| `unique_keys` | _Not converted_ — Wren has no equivalent |
| `custom_extensions` for other vendors | _Ignored_ |

## What needs a `WREN` block

For each of these cases, `validate --from-ossie` emits a warning with a **copy-pasteable YAML snippet** you can paste straight into your Ossie file.

### Untyped fields

Ossie 0.1.1 doesn't carry column types, and 0.2.0.dev0's `datatype` is a coarse portable enum (no precision, no length). Without a `WREN` override or a usable `datatype`, every field defaults to `VARCHAR` (or `TIMESTAMP` if `dimension.is_time: true`). Validate prints, per dataset:

```text
[WARNING] dataset 'store_sales': 8 field(s) have no type — defaulted to VARCHAR.
  Add to dataset 'store_sales' in the Ossie file:

    custom_extensions:
      - vendor_name: WREN
        data: |
          {
            "column_types": {
              "ss_sold_date_sk": "DATE",
              "ss_ext_sales_price": "DECIMAL(18,2)",
              ...
            }
          }
```

### Composite primary keys

Ossie allows `primary_key: [col_a, col_b]`; Wren MDL takes one column. Wren picks the first column and emits a snippet so you can override:

```text
[WARNING] dataset 'store_sales': composite primary_key
  ['ss_item_sk', 'ss_ticket_number'] — Wren MDL takes one column.
  Wren picked 'ss_item_sk'. To override, add to dataset 'store_sales':

    custom_extensions:
      - vendor_name: WREN
        data: '{"primary_key": "<one of: ss_item_sk, ss_ticket_number>"}'
```

### Cross-dataset metrics

Wren cubes are bound to a single base object, so Ossie top-level metrics that aggregate across multiple datasets cannot become first-class cubes. They are rendered as markdown notes appended to `instructions`, available to the LLM but not as queryable measures:

```text
[WARNING] metric 'customer_lifetime_value': expression references 2 datasets
  (customer, store_sales) — emitted as instruction note only.
```

Metrics that reference a single dataset get the same treatment by default (`metrics: note`); set `metrics: skip` in the WREN block to drop them entirely.

### Multiple `semantic_model` entries

Ossie 0.1.1 allows multiple `semantic_model[]` entries in one file (the 0.2.0.dev0 layout is one model per file, so this cannot arise there). Wren builds one MDL per invocation, so an ambiguous file is a hard error:

```text
[ERROR] Ossie file has 2 semantic_models: model_a, model_b.
  Pass --semantic-model <name> or add at the Ossie document root:

    custom_extensions:
      - vendor_name: WREN
        data: '{"default_semantic_model": "<name>"}'
```

## CLI commands

```bash
# Build (writes ./target/mdl.json by default)
wren context build --from-ossie semantic_model.yaml --data-source postgres
wren context build --from-ossie semantic_model.yaml --data-source snowflake \
  --output build/mdl.json

# Migrate to a native wren project (one-way)
wren context init --from-ossie semantic_model.yaml --data-source postgres \
  --path my_project

# Validate — lints the conversion and prints actionable snippets
wren context validate --from-ossie semantic_model.yaml --data-source postgres
wren context validate --from-ossie semantic_model.yaml --data-source postgres --strict
wren context validate --from-ossie semantic_model.yaml --data-source postgres --verbose

# Show — preview the resulting manifest without writing it
wren context show --from-ossie semantic_model.yaml --data-source postgres
wren context show --from-ossie semantic_model.yaml --data-source postgres --output json
wren context show --from-ossie semantic_model.yaml --data-source postgres --output yaml

# Export — the other direction: wren project (or mdl.json) → Ossie YAML
wren context export-ossie --output semantic_model.yaml
wren context export-ossie --from-mdl target/mdl.json --output semantic_model.yaml

# Deprecated spelling — same behaviour as --from-ossie plus a warning on stderr
wren context build --from-osi semantic_model.yaml --data-source postgres
```

`--data-source` is required because Ossie deliberately does not carry connection or dialect environment information. Pair `--from-ossie` with `--semantic-model` if the file contains more than one model.

## Migrate to a native wren project

When Ossie's surface area isn't enough — you need cubes, views, RLAC/CLAC, or calculated columns Ossie doesn't model — convert the Ossie file into a native wren project once and edit the YAML from there:

```bash
wren context init --from-ossie semantic_model.yaml --data-source postgres --path my_project
```

This reuses the same converter as `build --from-ossie`, then scaffolds the standard wren layout:

```text
my_project/
├── wren_project.yml          # name lifted from Ossie semantic_model.name
├── models/
│   ├── customers/metadata.yml
│   └── orders/metadata.yml
├── relationships.yml
├── instructions.md           # Ossie ai_context.instructions + metrics notes
└── AGENTS.md
```

After migration:

- The Ossie file is **no longer referenced**. You can delete it, archive it, or keep it for diffing — Wren never reads it again.
- Edit the generated YAML directly. Add cubes under `cubes/`, views under `views/`, RLAC under each model's `properties`, etc.
- Use the standard flow: `wren context validate` → `wren context build`.

Any warnings the Ossie conversion would normally emit (untyped fields, composite primary keys, cross-dataset metrics) are printed once during init so you know which spots in the generated YAML need a human review.

### When *not* to migrate

If your Ossie file is updated by an upstream team and you want Wren to stay in sync, **do not** migrate — use `build --from-ossie` instead. A migrated project is a snapshot; later Ossie edits won't reach Wren without manually merging or re-running `init --from-ossie --force` (which loses your post-migration edits).

## Export a wren project as Ossie

`wren context export-ossie` is the inverse of `--from-ossie`: it turns a native wren project (or an already-built `mdl.json`) into one Ossie YAML document that Snowflake Cortex, Cube, dbt, or any other Ossie consumer can read — and that `wren context build --from-ossie` reads back.

```bash
# From the current project (auto-discovered like every other context command)
wren context export-ossie --output semantic_model.yaml

# Print to stdout instead
wren context export-ossie --path my_project

# From a built manifest instead of a project
wren context export-ossie --from-mdl target/mdl.json --output semantic_model.yaml

# Options
wren context export-ossie --name sales_model      # semantic_model name (default: project name)
wren context export-ossie --dialect SNOWFLAKE     # dialect label on every expression
wren context export-ossie --spec-version 0.2.0.dev0   # draft layout (root-level model + datatype)
wren context export-ossie --strict                # treat warnings as errors
```

By default the exporter writes the released `0.1.1` layout (`version: "0.1.1"`, one `semantic_model[]` entry) — the one every shipping Ossie consumer reads. `--spec-version 0.2.0.dev0` writes the draft layout instead: the model's keys at the document root and an OSI-portable `datatype` on every field and metric whose Wren type maps to the enum. In both cases everything Ossie cannot express goes into the same `WREN` extension blocks the importer looks for, so `export-ossie` → `build --from-ossie` reproduces the same models, column types, expressions and relationships whichever layout you pick. Without `--dialect`, expressions are labelled `ANSI_SQL` (or `SNOWFLAKE` / `DATABRICKS` when the project's `data_source` is one of those, matching the importer's inference).

### Export mapping

| Wren MDL | Ossie |
|---|---|
| `wren_project.yml: name` (or `--name`) | `semantic_model[0].name` (`name` at the root with `--spec-version 0.2.0.dev0`) |
| `knowledge/rules/*.md` (or `_instructions` in `mdl.json`) | `semantic_model.ai_context.instructions` |
| `model.table_reference: {catalog, schema, table}` | `dataset.source: catalog.schema.table` (empty leading parts dropped) |
| `model.ref_sql` | `dataset.source` as the inline SQL |
| `model.primary_key` (string or list) | `dataset.primary_key: [..]` |
| `model.properties.description` | `dataset.description` |
| `column.name` + `column.expression` (calculated) | `dataset.fields[]` with `expression.dialects[{dialect, expression}]` |
| `column.type` | The exact type in the dataset's `WREN.column_types` block; with `--spec-version 0.2.0.dev0` also `field.datatype` (Ossie's portable enum: `String`, `Integer`, `Decimal`, `Float`, `Boolean`, `Date`, `Time`, `DateTime`, `DateTimeTz`) |
| `column.type` date/time | `field.dimension.is_time: true` |
| `column.not_null` (non-PK) | field-level `WREN: {"not_null": true}` |
| `column.properties.description` | `field.description` |
| `relationship` (`models`, `join_type`, `condition`) | `relationships[]` with `from`/`to` and `from_columns`/`to_columns` parsed from the condition; `ONE_TO_MANY` is flipped so `from` is always the many side |
| `relationship.properties.description` | `relationship.ai_context.instructions` |
| `cube.measures[]` | top-level `metrics[]` — the expression is qualified with the cube's `base_object` (`SUM(amount)` → `SUM(orders.amount)`); duplicate measure names across cubes get a `<cube>_` prefix |
| `measure.type` / `description` | `metric.datatype` (0.2.0.dev0 only) / `metric.description` |
| Columns with `relationship:` (navigation columns) | _Not exported_ — the `relationships[]` entry carries the join |
| `views` | _Not exported_ (warning) — Ossie has no view concept |
| `cube.dimensions` / `time_dimensions` / `hierarchies` | _Not exported_ (warning) — Ossie metrics carry only the aggregate |
| Row- / column-level access controls | _Not exported_ (warning) |
| Relationships whose `condition` is not `a.x = b.y [AND ...]` | _Not exported_ (warning) — Ossie relationships are column lists |
| `ONE_TO_ONE` / `MANY_TO_MANY` relationships | Exported as many-to-one with a warning |

Warnings go to stderr so the YAML on stdout stays clean to redirect; `--strict` turns them into a non-zero exit for CI.

### Round-trip caveats

- The export is lossless for what Ossie models (datasets, fields, types, relationships, instructions). The rows marked _Not exported_ above are gone after a round trip — keep the wren project if you depend on them.
- `build --from-ossie` renders Ossie `metrics` as a markdown note appended to instructions. Exporting that project again carries the note inside `ai_context.instructions` **and** emits the cube metrics as `metrics[]`, so a project that is repeatedly round-tripped accumulates the note once per pass. Trim `knowledge/rules/` if that matters.
- Model order in the export follows the project loader (alphabetical by model directory), not the original file.

## Limitations

- **No cubes on import.** Ossie metrics map to instruction notes, not Wren cubes. If you need first-class cubes, model them in a native wren project instead. (Export goes the other way: cube measures become Ossie metrics.)
- **No views.** Ossie has no view concept; the generated MDL has an empty `views` array, and views are dropped on export.
- **No `unique_keys`, no row/column-level access controls.** Neither Ossie 0.1.1 nor the 0.2.0.dev0 draft models these; if you need them, either author them in a sidecar wren project or wait for an upcoming Ossie spec version.

For features Ossie doesn't yet cover, the suggested pattern is to use the Ossie file for what it does well (datasets, fields, relationships, instructions) and add a small wren-native overlay on top for the gaps. This is currently a manual merge — there is no automatic union of two sources.

## See also

- [Apache Ossie specification](https://github.com/apache/ossie/blob/main/core-spec/spec.md) — the upstream schema and field reference (`main` tracks the 0.2.0.dev0 draft; the 0.1.1 release is tagged `osi-0.1.1-rc1`)
- [Manage project](./manage_project.md) — the native wren-project flow
- [MDL reference](/oss/reference/mdl) — what Wren produces on the other side of the conversion
- [Connect your database](./connect.md) — choosing and binding a profile
