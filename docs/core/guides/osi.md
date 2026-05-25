---
sidebar_label: OSI (Open Semantic Interchange)
---

# Build MDL from an OSI semantic model

[Open Semantic Interchange](https://github.com/open-semantic-interchange/OSI) (OSI) is a vendor-neutral specification for semantic models, backed by Snowflake, Salesforce, dbt Labs, Databricks, Cube, AtScale, and others. If your team already publishes one OSI YAML as the single source of truth for analytics definitions, Wren can read it directly and build `target/mdl.json` without forking the model into a parallel wren project.

```bash
wren context build --from-osi semantic_model.yaml --data-source postgres
# → ./target/mdl.json
```

## OSI project vs. wren project

|  | Wren project (native) | OSI project, kept as source | OSI project, migrated once |
|---|---|---|---|
| **Source files** | `wren_project.yml` + `models/<name>/metadata.yml` + `views/` + `relationships.yml` | A single `*.yaml` OSI file | After migration: wren project layout |
| **Author** | You (or `wren-generate-mdl` agent skill) | OSI tooling / vendor / external team | You take ownership after `init` |
| **Wren commands** | `wren context init` → edit → `build` | `wren context build --from-osi <file>` | `wren context init --from-osi <file>` → edit → `build` |
| **Editable inside Wren?** | Yes — that's the point | No — Wren reads the file as-is | Yes after migration |
| **Where wren-specific hints live** | Each model's YAML | OSI's `custom_extensions[vendor_name=WREN]` block | Each model's YAML (lifted from OSI at migration time) |
| **Stays in sync with OSI?** | n/a | Yes — every build re-reads OSI | No — one-way snapshot |

Three places you might land:

- **You own the semantic model from day one** → use the native wren project flow.
- **The OSI file is shared with other tools (Snowflake Cortex, Salesforce, Cube, …) and you want Wren to be one of many consumers without forking** → use `wren context build --from-osi`. Every build re-reads the OSI file.
- **You started with an OSI file but now want full control inside Wren (cubes, views, RLAC, custom calculations OSI doesn't model)** → use `wren context init --from-osi` to migrate once, then edit the generated YAML directly. See [Migrate to a native wren project](#migrate-to-a-native-wren-project).

All three paths produce the same `target/mdl.json` shape — Wren doesn't care how you got there.

## Quick start

Suppose you have this OSI file (excerpted from a TPC-DS retail example):

```yaml
# semantic_model.yaml
version: "0.2.0"
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
wren context build --from-osi semantic_model.yaml --data-source postgres
```

Wren reads the file, converts each dataset to a model, synthesizes relationship join conditions, packs OSI's `ai_context.instructions` into the manifest, and writes `./target/mdl.json` — ready for `wren --sql` or any agent skill.

You'll also see warnings telling you what's missing for an ideal manifest — see [What needs a `WREN` block](#what-needs-a-wren-block) below.

## The `WREN` extension block

OSI has no file-system convention for vendor extensions. Its [only sanctioned extension mechanism](https://github.com/open-semantic-interchange/OSI/blob/main/core-spec/spec.md) is the in-document `custom_extensions: [{vendor_name, data}]` field, present at every level of the document. Wren reads `vendor_name: WREN` entries and ignores everything else.

A typical extension block at the OSI document root:

```yaml
custom_extensions:
  - vendor_name: WREN
    data: |
      {
        "dialect": "SNOWFLAKE",
        "metrics": "note"
      }
```

Per-dataset overrides, for the things OSI cannot express (most importantly: column types):

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
| `dialect` | root, semantic_model | Which OSI dialect to extract from `expression.dialects[]`. Default: `ANSI_SQL`, with auto-inference for `snowflake` / `databricks` data sources. |
| `metrics` | root, semantic_model | How to handle OSI top-level `metrics`: `note` (default, append as instructions) or `skip`. |
| `default_semantic_model` | root | When the file has multiple `semantic_model[]` entries, which one to build. |
| `column_types` | semantic_model: `{dataset: {field: type}}`<br/>dataset: `{field: type}` | Column types — OSI has no native type system. |
| `primary_key` | semantic_model: `{dataset: column}`<br/>dataset: `column` | Pick one column when OSI defines a composite primary key. |
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

| OSI | Wren MDL |
|---|---|
| `dataset.source: a.b.c` | `model.table_reference: {catalog: a, schema: b, table: c}` |
| `dataset.source` containing `SELECT`/`FROM`/newlines | `model.ref_sql` |
| `dataset.fields[*].name` + `expression` | `model.columns[]` — dialect-picked expression, type from WREN block or `is_time` hint |
| `dataset.primary_key: [x]` | `model.primary_key: x` (composite arrays warn + take the first column unless overridden) |
| `relationships[]` (always many-to-one in OSI) | wren `relationships` with synthesized `condition` and `MANY_TO_ONE` |
| `field.dimension.is_time: true` | `column.type: TIMESTAMP` (when no explicit type override) |
| `semantic_model.ai_context.instructions` | MDL `_instructions` |
| `metrics[]` (top-level OSI) | Rendered as markdown notes appended to instructions |
| `unique_keys` | _Not converted_ — Wren has no equivalent |
| `custom_extensions` for other vendors | _Ignored_ |

## What needs a `WREN` block

For each of these cases, `validate --from-osi` emits a warning with a **copy-pasteable YAML snippet** you can paste straight into your OSI file.

### Untyped fields

OSI doesn't carry column types. Without a `WREN` override, every field defaults to `VARCHAR` (or `TIMESTAMP` if `dimension.is_time: true`). Validate prints, per dataset:

```text
[WARNING] dataset 'store_sales': 8 field(s) have no type — defaulted to VARCHAR.
  Add to dataset 'store_sales' in the OSI file:

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

OSI allows `primary_key: [col_a, col_b]`; Wren MDL takes one column. Wren picks the first column and emits a snippet so you can override:

```text
[WARNING] dataset 'store_sales': composite primary_key
  ['ss_item_sk', 'ss_ticket_number'] — Wren MDL takes one column.
  Wren picked 'ss_item_sk'. To override, add to dataset 'store_sales':

    custom_extensions:
      - vendor_name: WREN
        data: '{"primary_key": "<one of: ss_item_sk, ss_ticket_number>"}'
```

### Cross-dataset metrics

Wren cubes are bound to a single base object, so OSI top-level metrics that aggregate across multiple datasets cannot become first-class cubes. They are rendered as markdown notes appended to `instructions`, available to the LLM but not as queryable measures:

```text
[WARNING] metric 'customer_lifetime_value': expression references 2 datasets
  (customer, store_sales) — emitted as instruction note only.
```

Metrics that reference a single dataset get the same treatment by default (`metrics: note`); set `metrics: skip` in the WREN block to drop them entirely.

### Multiple `semantic_model` entries

OSI allows multiple `semantic_model[]` entries in one file. Wren builds one MDL per invocation, so an ambiguous file is a hard error:

```text
[ERROR] OSI file has 2 semantic_models: model_a, model_b.
  Pass --semantic-model <name> or add at the OSI document root:

    custom_extensions:
      - vendor_name: WREN
        data: '{"default_semantic_model": "<name>"}'
```

## CLI commands

```bash
# Build (writes ./target/mdl.json by default)
wren context build --from-osi semantic_model.yaml --data-source postgres
wren context build --from-osi semantic_model.yaml --data-source snowflake \
  --output build/mdl.json

# Migrate to a native wren project (one-way)
wren context init --from-osi semantic_model.yaml --data-source postgres \
  --path my_project

# Validate — lints the conversion and prints actionable snippets
wren context validate --from-osi semantic_model.yaml --data-source postgres
wren context validate --from-osi semantic_model.yaml --data-source postgres --strict
wren context validate --from-osi semantic_model.yaml --data-source postgres --verbose

# Show — preview the resulting manifest without writing it
wren context show --from-osi semantic_model.yaml --data-source postgres
wren context show --from-osi semantic_model.yaml --data-source postgres --output json
wren context show --from-osi semantic_model.yaml --data-source postgres --output yaml
```

`--data-source` is required because OSI deliberately does not carry connection or dialect environment information. Pair `--from-osi` with `--semantic-model` if the file contains more than one model.

## Migrate to a native wren project

When OSI's surface area isn't enough — you need cubes, views, RLAC/CLAC, or calculated columns OSI doesn't model — convert the OSI file into a native wren project once and edit the YAML from there:

```bash
wren context init --from-osi semantic_model.yaml --data-source postgres --path my_project
```

This reuses the same converter as `build --from-osi`, then scaffolds the standard wren layout:

```text
my_project/
├── wren_project.yml          # name lifted from OSI semantic_model.name
├── models/
│   ├── customers/metadata.yml
│   └── orders/metadata.yml
├── relationships.yml
├── instructions.md           # OSI ai_context.instructions + metrics notes
└── AGENTS.md
```

After migration:

- The OSI file is **no longer referenced**. You can delete it, archive it, or keep it for diffing — Wren never reads it again.
- Edit the generated YAML directly. Add cubes under `cubes/`, views under `views/`, RLAC under each model's `properties`, etc.
- Use the standard flow: `wren context validate` → `wren context build`.

Any warnings the OSI conversion would normally emit (untyped fields, composite primary keys, cross-dataset metrics) are printed once during init so you know which spots in the generated YAML need a human review.

### When *not* to migrate

If your OSI file is updated by an upstream team and you want Wren to stay in sync, **do not** migrate — use `build --from-osi` instead. A migrated project is a snapshot; later OSI edits won't reach Wren without manually merging or re-running `init --from-osi --force` (which loses your post-migration edits).

## Limitations

- **No round-trip.** Wren reads OSI but never writes back. Edits to the OSI file are made in your OSI tooling; Wren re-reads on the next `build`.
- **No cubes / measures.** OSI metrics map to instruction notes, not Wren cubes. If you need first-class cubes, model them in a native wren project instead.
- **No views.** OSI has no view concept; the generated MDL has an empty `views` array.
- **No `unique_keys`, no row/column-level access controls.** OSI 0.2.x doesn't model these; if you need them, either author them in a sidecar wren project or wait for an upcoming OSI spec version.

For features OSI doesn't yet cover, the suggested pattern is to use the OSI file for what it does well (datasets, fields, relationships, instructions) and add a small wren-native overlay on top for the gaps. This is currently a manual merge — there is no automatic union of two sources.

## See also

- [OSI specification](https://github.com/open-semantic-interchange/OSI/blob/main/core-spec/spec.md) — the upstream schema and field reference
- [Manage project](./manage_project.md) — the native wren-project flow
- [MDL reference](/oss/reference/mdl) — what Wren produces on the other side of the conversion
- [Connect your database](./connect.md) — choosing and binding a profile
