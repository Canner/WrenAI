---
sidebar_label: Model your business
---

# Model your business

Turn your warehouse schema into an agent-readable MDL project that captures your business logic.

## What you'll end up with

- A Wren project directory with `wren_project.yml`, `models/`, `views/`, `relationships.yml`, and `instructions.md`
- A compiled `target/mdl.json` ready for the engine
- A memory index over the modeled schema, so agents can fetch relevant context per question
- A first query that runs through MDL — not against raw tables

## The flow

1. **Connect your data source.** See [Connect your data](./connect.md) for profile setup.
2. **Open your agent in a fresh project directory and ask:**
   > Use the `wren-generate-mdl` skill to scaffold an MDL project for this database.
3. **Review the scaffold.** The agent introspects schema, normalizes types, detects relationships, and writes one model per table. It will ask one focused question whenever it cannot decide alone — naming, canonical tables, ambiguous foreign keys.
4. **Build and index.** The skill finishes with:
   ```bash
   wren context build
   wren memory index
   ```
5. **Run a first modeled query.**
   ```bash
   wren --sql "SELECT * FROM customers LIMIT 5"
   ```

## What scaffolding gives you

The first pass is rough but functional. The agent produces:

- **One model per physical table** with explicit column declarations (no `SELECT *` ambiguity)
- **Type normalization** through `wren utils parse-type` so the manifest types are canonical
- **Primary keys and relationships** inferred from foreign-key metadata where the connector exposes them
- **Empty `instructions.md`** for you to fill with business rules

Everything is YAML you can review and version. Nothing is locked behind a UI.

## What scaffolding cannot give you

The hard meaning lives outside the database. Scaffolding cannot tell you:

- Which of `customers` / `customers_v3` / `loyalty_v3` is canonical
- Why `status = 4` means refunded
- Whether `active customer` excludes service accounts
- That "Project Lighthouse" maps to `campaign_id = 4172`

Bring those in with [Refine answer quality](./refine.md) — the grill / auto-pilot loop that fills the semantic gaps.

## Enrich as you go

Once you have a baseline, add depth incrementally:

- **Descriptions and business names** on models and columns — memory uses these for retrieval
- **Calculated fields** for metrics the team agrees on (`revenue = net_total - refunds`)
- **Relationship columns** so agents can write `orders.customer.first_name` without manual joins
- **Views** for stable, pre-built query shapes (`completed_orders`, `monthly_revenue`)
- **Cubes** for governed aggregations — see [Pre-aggregate with cubes](./cubes.md)
- **Selective column exposure** to keep PII columns invisible to agents — omit them from the model and they cannot be queried

Each time you edit, rebuild and re-index:

```bash
wren context build
wren memory index
```

## When to come back here

- A new table or domain enters your warehouse
- Schema drift breaks an existing model
- Your team agrees on a new metric definition worth promoting from `instructions.md` into a calculated field
- An AI coding agent suggests a structural change worth reviewing

## See also

- [MDL schema reference](/oss/reference/mdl) — every field accepted in MDL files
- [Refine answer quality](./refine.md) — close the loop with memory and instructions
- [What does MDL do for the agent?](/oss/concepts/what_is_mdl) — the design idea behind MDL
