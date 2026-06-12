# Wren Enrich Context — Cube Proposals

When raw documents define a named aggregation metric (`ARR = MRR × 12`, `weekly active users`, `quarterly churn`), the right sink is almost always a **cube**. Cubes give agents a structured aggregation API (`wren cube query --cube X --measures Y --dimensions Z`) instead of asking them to hand-write `GROUP BY` and `DATE_TRUNC` — the place where small models fail most often.

This reference covers when to propose a cube, what to write, and how to validate.

## Sink decision tree

```
Raw mentions a named metric / aggregation pattern
├── Same base model has multiple measure-shaped columns + at least one group-by dimension
│   → propose CUBE  (cubes/<name>/metadata.yml)
├── Pure row-level expression (amount_with_tax = amount * 1.1, no grouping)
│   → propose CALCULATED COLUMN  (is_calculated: true, expression: ...)
├── Needs JOIN across multiple models, window function, or CTE
│   → propose VIEW  (views/<name>/metadata.yml)
└── Old-style MDL `metrics:` already covers it
    → surface on "please fix manually" — do not propose a duplicate cube alongside
```

**Why cube is the default**: the Wren docs call cubes the "highest-leverage correctness primitive" for smaller models. Agents pick wrong joins, double-count, and mis-truncate dates when forced to write aggregation SQL by hand. Cubes pre-declare those decisions once.

## Before proposing — duplication guard

Run these once at the start of any cube-proposing turn:

```bash
wren cube list                       # all existing cube names
wren cube describe <cube_name>       # measures + expressions per cube
```

For each measure you're about to propose:

- **Same expression already exists in another cube** (e.g. `SUM(amount)` for the same `base_object`) → do **not** propose a new cube. Add a `queries.yml` example pointing at the existing cube instead, so the agent learns to reach for it.
- **Same name in `wren cube list`** but different `base_object` → name collision. Either fall back to `<name>_v2` (auto-pilot) or grill the user for a better name (grill mode).
- **Old MDL `metrics:` already defines this** (visible in `wren context show --output json` under each model's `metrics:` array) → do not propose. Surface on the Step 9 "please fix manually" list with the note "old metrics: entry — consider migrating to a cube".

## Naming policy

Agent drafts the name from raw's term, then validates / escalates:

| Raw term | Draft cube name |
|---|---|
| `ARR` / `Annual Recurring Revenue` | `arr` |
| `Weekly Active Users` / `WAU` | `weekly_active_users` |
| `Quarterly Churn` | `quarterly_churn` |
| `Net Revenue Retention` / `NRR` | `nrr` |

Rules:

- snake_case, lowercase
- Use the most specific term raw uses (`net_revenue_retention` over `nrr` if raw spells it out elsewhere)
- Singular ("revenue" not "revenues") — measures inside the cube carry the plural sense
- **Grill mode**: show the draft name; let user accept / edit
- **Auto-pilot**: use the draft; log the chosen name in the Step 9 audit ("cube name auto-picked: `arr` from raw/finance.pdf §2")

## YAML template

```yaml
# cubes/<name>/metadata.yml
name: <name>                  # snake_case, must match the file's directory
base_object: <model_or_view>  # MUST already exist in the project — verify with wren context show
measures:
  - name: total
    expression: SUM(<column>)
    type: DOUBLE
  - name: count
    expression: COUNT(*)
    type: BIGINT
dimensions:
  - name: <dim_name>
    expression: <column>      # column on base_object
    type: VARCHAR             # use the column's actual type
time_dimensions:
  - name: <td_name>           # e.g. "order_date" — semantic column name, not the grain
    expression: <ts_column>   # e.g. "created_at"
    type: TIMESTAMP           # granularity (day/week/month/…) is set at query time via --time-dimension
hierarchies:
  - name: time
    levels: [year, quarter, month]   # only if multiple time grains are declared
properties:
  description: |
    <one-line summary from raw — e.g. "Annual Recurring Revenue, defined as MRR × 12 per the finance handbook §2.">
```

### Measure expression patterns

| Pattern | Expression | Type |
|---|---|---|
| Sum a column | `SUM(<col>)` | `DOUBLE` or `BIGINT` matching `<col>` |
| Row count | `COUNT(*)` | `BIGINT` |
| Distinct count | `COUNT(DISTINCT <col>)` | `BIGINT` |
| Average | `AVG(<col>)` | `DOUBLE` |
| Ratio (named in raw) | `SUM(<num>) / NULLIF(SUM(<den>), 0)` | `DOUBLE` |
| Derived multiplier (e.g. ARR = MRR × 12) | `SUM(<mrr_col>) * 12` | `DOUBLE` |

Whenever `raw` gives an explicit formula ("ARR = MRR × 12"), use it verbatim in the measure expression rather than improvising. Quote the source in `properties.description`.

### `base_object` selection

The `base_object` must already exist as a model name or view name. Check with `wren context show --output summary`. If raw's metric crosses multiple tables (e.g. "revenue per customer segment" needs `orders ↔ customers`), the correct path is:

1. If a relationship already exists → cube can still use one base model and the related column is reachable via the relationship's calculated column on that model. Verify by inspecting `wren context show --output json`.
2. If no relationship → propose a VIEW that pre-joins the tables, then a cube `base_object: <that view>`. (Cubes can sit on views.)
3. If neither is viable → surface on the manual-fix list — the project needs a relationship before the cube can land.

## Validation flow

After writing `cubes/<name>/metadata.yml`:

```bash
# 1. Structural validation — checks referenced base_object, unique cube name, well-formed measures
wren context validate

# 2. Semantic validation — confirms measure / dimension expressions compile to real SQL
wren cube query --cube <name> --measures <first_measure> --sql-only
```

**On failure:**

- `wren context validate` error → revert the cube YAML file (delete it), log the error to the audit, move on.
- `wren cube query --sql-only` error → revert, surface the specific measure / dimension that won't compile, and either grill (grill mode) or skip (auto-pilot).

Never leave a project with a cube YAML that doesn't pass both checks. A broken cube poisons `wren cube list` for every future agent session.

## Auto-pilot escalation

Cubes are **always** high-blast-radius — a new cube YAML becomes a public name in `wren cube list` that every future agent sees. In auto-pilot, treat every cube proposal as a Universal Rule 7(b) escalation: drop into grill, ask the user, then either apply or skip. This holds even when the cube comes from a Lane 2 NEW claim (raw explicitly defined the metric) — the artifact's blast radius doesn't depend on inference confidence.

## Examples

### Example 1 — raw defines ARR explicitly (Lane 2 NEW → escalate to grill)

Raw `finance.pdf §2`: *"ARR (Annual Recurring Revenue) is calculated as MRR × 12 from the subscriptions table, filtered to status = 'active'."*

Existing project: `subscriptions` model with `mrr`, `status` columns. No cube covers this. No old `metrics:` entry.

Draft to grill:

```yaml
# cubes/arr/metadata.yml
name: arr
base_object: subscriptions
measures:
  - name: total
    expression: SUM(mrr) * 12
    type: DOUBLE
dimensions:
  - name: status
    expression: status
    type: VARCHAR
properties:
  description: "Annual Recurring Revenue = MRR × 12, filtered to active subscriptions. Source: raw/finance.pdf §2."
```

Note no `time_dimensions` because raw didn't ask for time-bucketing. Add one when raw also says "monthly ARR trend" or similar.

### Example 2 — raw mentions a measure already covered (skip, write queries.yml)

Raw `support_handbook.md`: *"DAU = distinct active users per day."*

Existing cube `daily_engagement` already has measure `dau` with expression `COUNT(DISTINCT user_id)`.

Action: skip the cube proposal. Add to `queries.yml`:

```yaml
- nl: "daily active users for last week"
  sql: |
    -- via cube
    SELECT day, dau FROM (
      <result of: wren cube query --cube daily_engagement --measures dau --time-dimension "day:day:2024-01-01,2024-01-08">
    )
  source: enrich
```

(Or simpler — log it in the Step 9 audit and let the agent reach for `wren cube query` directly at usage time.)

### Example 3 — old MDL `metrics:` exists (manual fix)

Existing `orders/metadata.yml`:

```yaml
metrics:
  - name: revenue
    expression: SUM(amount)
    type: DOUBLE
```

Raw mentions revenue widely.

Action: do **not** write `cubes/revenue/metadata.yml` — that would create two competing definitions. Surface on Step 9 manual-fix:

```text
Please fix manually:
- models/orders/metadata.yml has old-style `metrics: revenue`. Consider migrating to cubes/revenue/ for better agent ergonomics; this skill won't do it because it would mean modifying existing.
```

## Things not to do

- Do not write a cube whose `base_object` doesn't exist — `wren context validate` will fail and you'll revert anyway.
- Do not invent measure / dimension columns that aren't on `base_object` (or reachable via its relationships). Cube YAML doesn't auto-create columns.
- Do not add `time_dimensions` when raw didn't ask for time bucketing. An empty list is fine; a wrong grain is worse than no grain.
- Do not write a `metrics:` entry on a model when proposing the same logic as a cube. Cube replaces metric, doesn't supplement.
- Do not modify an existing cube YAML even if raw contradicts it — Universal Rule 1. Surface the conflict on the manual-fix list.
