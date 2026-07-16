---
sidebar_label: Pre-aggregate with cubes
---

# Pre-aggregate with cubes

Cubes are pre-aggregated semantic objects: a base model or view plus declared measures, dimensions, time dimensions, and hierarchies. They give agents a **structured aggregation API** instead of asking them to hand-write `GROUP BY`, `DATE_TRUNC`, and metric arithmetic — the SQL surface where small and local models fail most often.

## What you'll end up with

- A `cubes/<name>/metadata.yml` per cube, declaring its measures and dimensions
- A queryable cube name in MDL — `wren cube query --cube revenue --measures total --time-dimension "order_date:month"`
- An agent that picks structured cube queries instead of inventing aggregation SQL

## Why this primitive matters

The most common failure mode for agents writing analytical SQL is:

- Joining wrong because they reconstructed the join from raw FKs
- Double-counting because they aggregated on the wrong grain
- Mis-truncating dates because the time grain was ambiguous
- Inventing a metric that does not match the team's accepted definition

A cube collapses all four problems. The measures, dimensions, time grains, and join paths are declared once. The agent supplies a structured input. The engine produces correct SQL.

This is the **highest-leverage correctness primitive** for smaller models, where the gap between "knows what to ask" and "can write SQL correctly" is widest.

## Define a cube

Cubes live under `cubes/<name>/metadata.yml`. A simple cube over an existing `orders` model looks like:

```yaml
name: revenue
base_object: orders
measures:
  - name: total
    expression: SUM(amount)
    type: DOUBLE
  - name: order_count
    expression: COUNT(*)
    type: BIGINT
dimensions:
  - name: status
    expression: status
    type: VARCHAR
time_dimensions:
  - name: order_date
    expression: order_date
    type: DATE
hierarchies:
  time: [order_date]
```

`hierarchies` is a map from a hierarchy name to an ordered list of declared
dimension or time-dimension names. The level names must match entries in
`dimensions` or `time_dimensions`.

See the [MDL schema reference](/oss/reference/mdl) for every cube field.

## Query a cube

The `wren cube query` CLI takes a structured input:

```bash
wren cube query \
  --cube revenue \
  --measures total,order_count \
  --dimensions status \
  --time-dimension "order_date:month" \
  --filter "status:eq:completed"
```

`--time-dimension` takes `<name>:<granularity>`, and `--filter` takes
`<dimension>:<operator>:<value>`. See the
[CLI reference](/oss/reference/cli#wren-cube--pre-aggregation-queries) for the
full list of granularities and filter operators.

No hand-written `GROUP BY`. No `DATE_TRUNC`. No join inference.

## When to add a cube

Add a cube when:

- A metric is queried often (revenue, retention, MAU)
- The metric has a clear team-agreed definition (don't model unsettled metrics)
- Small or local models in your agent stack struggle with the aggregation
- You want a stable interface that survives schema drift in the base model

Do **not** add a cube when:

- The metric is exploratory or one-off (a SQL query is fine)
- The metric definition is still under debate (write it in `knowledge/rules/` first)
- There is no clear grain (cubes need explicit measures + dimensions)

## When to come back here

- A small or local model in your stack starts hallucinating aggregations
- You promote a metric from "agreed on Slack" to "in the MDL"
- A new business KPI gets formal sign-off
- You want to expose a metric to a customer-facing app via the SDK

## See also

- [MDL schema reference](/oss/reference/mdl) — full cube field reference, including hierarchies and pre-aggregations
- [How does Wren AI keep agents from hallucinating?](/oss/concepts/correctness) — why cubes matter as a correctness primitive
- [Model your business](./model.md) — the modeling step that precedes cubes
