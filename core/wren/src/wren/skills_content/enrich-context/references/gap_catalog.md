# Wren Enrich Context — Gap Catalog

Ten business-semantic categories that the schema alone cannot carry. The main `SKILL.md` sweeps these every session — Lane 1 uses them as type-aware mechanical checks, Lane 2 maps raw claims onto them, Lane 3 proposes them when raw is silent.

## How to use this catalog

| Lane | How the catalog is used |
|---|---|
| **Lane 1** (structural) | For each model/column, check the *Trigger* column below. A trigger that fires → a gap candidate for that category. |
| **Lane 2** (claim-diff) | For each atomic claim extracted from raw, classify it under one of the 10 categories before deciding the sink. |
| **Lane 3** (inference) | If raw is silent but a trigger from this catalog fires AND the slot is empty, propose an inference (open with "I'm guessing — " in grill mode, tag `agent inference` in auto-pilot). |

Categories 1, 2, 3, 5, 7 write to **column `properties.description`** (prose + `[tag]` line). Categories 4, 6, 8, 9, 10 write to **`instructions.md`** (new `##` section appended). All sinks are append-only — never modify what's there.

## Description write format (column-local categories)

Prose first, then one `[tag]` line per category. Tags are greppable for re-enrichment audits.

```yaml
- name: status
  type: VARCHAR
  properties:
    description: |
      Customer subscription status snapshot at row creation time.
      [enum] free=unpaid trial, pro=paid monthly, enterprise=contracted SLA
      [null] NULL = signup not yet completed
```

Use lowercase tag names exactly as listed below — Lane 1 greps these for re-enrichment dedup.

## The catalog

### 1. Enum value semantics

- **Trigger:** `column.type ∈ {VARCHAR, CHAR, TEXT, INTEGER, SMALLINT}` AND distinct count ≤ 30 (from raw OR Step 4.5 probe) AND description does not contain `[enum]`.
- **Name hints:** `status`, `state`, `type`, `kind`, `category`, `tier`, `level`, `flag`, `*_code`.
- **Raw keyword scan:** "enum", "values", "code", "constant", "0 =", "A =", "must be one of".
- **Sink:** column `properties.description`.
- **Tag:** `[enum] A=active, B=banned, C=churned`.
- **Why it matters:** schema describe shows the raw code only; agent guesses meanings and ships wrong filters.

### 2. Unit / scale

- **Trigger:** column name matches `*_amount|*_price|*_cost|*_value|*_total|*_qty|*_count|*_duration|*_size|*_bytes|*_ratio|*_rate` AND description does not contain `[unit]`.
- **Raw keyword scan:** "USD", "cents", "ms", "milliseconds", "seconds", "bytes", "KB", "%", "basis points", "decimal", "fraction".
- **Sink:** column `properties.description`.
- **Tag:** `[unit] cents (multiply by 0.01 for USD)` / `[unit] ms` / `[unit] basis points (10000 = 100%)`.
- **Why it matters:** off-by-100x bugs in revenue / latency / percentage queries are silent until someone manually spot-checks.

### 3. NULL semantics

- **Trigger:** `column.not_null = false` AND description does not contain `[null]` AND raw or pattern suggests NULL has business meaning (not just "missing data").
- **Name hints:** `*_at`, `last_*_at`, `deleted_at`, optional FK columns (`*_id` with low fill rate).
- **Raw keyword scan:** "not yet", "never", "n/a", "missing means", "absent", "uninitialized".
- **Sink:** column `properties.description`.
- **Tag:** `[null] NULL = user never logged in` / `[null] NULL = lifetime row (no expiry)`.
- **Why it matters:** `WHERE last_login_at IS NULL` vs `WHERE last_login_at < X` produce wildly different rows.

### 4. Soft-delete / active filters

- **Trigger:** model has any of `deleted_at`, `is_deleted`, `archived_at`, `is_active`, `is_internal`, `tombstone_at` column OR raw mentions "soft delete", "tombstone", "active rows only", "exclude internal".
- **Sink:** `instructions.md` under heading `## Default filters` (create if absent, append rule if present).
- **Write format:**
  ```markdown
  ## Default filters
  - `orders` queries exclude rows where `deleted_at IS NOT NULL` unless the user asks about deletions.
  - `users` queries default to `is_active = true AND is_internal = false`.
  ```
- **Why it matters:** invisible from schema; the agent produces "right SQL, wrong rows" — silent bug class.

### 5. Magic sentinels

- **Trigger:** numeric column AND probe / raw shows distinct values include outliers far from the body (-1, 0 in an otherwise positive column, 9999, 99999999) AND description does not contain `[magic]`.
- **Raw keyword scan:** "unknown", "all", "any", "n/a", "default", "sentinel", "-1 means", "999 means".
- **Sink:** column `properties.description`.
- **Tag:** `[magic] -1 = unknown; 0 = system user` / `[magic] 9999 = lifetime / no expiry`.
- **Why it matters:** averages and sums silently poisoned by sentinels treated as real values.

### 6. Synonyms / business aliases

- **Trigger:** raw uses a business term that maps to a model / column / metric, but the term doesn't appear verbatim in MDL names or descriptions.
  - Examples: "customer" → `customers` (vs `accounts`, `customers_v3`); "ARR" → `mrr * 12`; "DAU" → distinct active users per day.
- **Sink:** `instructions.md` under heading `## Naming conventions`.
- **Write format:**
  ```markdown
  ## Naming conventions
  - "ARR" in business docs = `subscriptions.mrr * 12`. Do not use the `revenue` table.
  - "customer" = the `customers` model (not `customers_v3`, that's the legacy raw mirror).
  - "active user" = a user with at least one event in the past 28 days, not `users.is_active`.
  ```
- **Why it matters:** memory retrieval matches on terms; users speak business, schema speaks tech.

### 7. Date / time conventions

- **Trigger:** `column.type ∈ {DATE, TIMESTAMP, TIMESTAMP_TZ, TIMESTAMPTZ}` AND description does not contain `[time]` AND any of: TZ ambiguous, event-vs-record ambiguous, grain ambiguous.
- **Name hints:** `*_at`, `*_time`, `*_date`, `created_*`, `updated_*`, `as_of_*`, `effective_*`.
- **Raw keyword scan:** "UTC", "timezone", "event time", "as of", "snapshot", "month-end", "fiscal", "rolling".
- **Sink:** column `properties.description`.
- **Tag:** `[time] UTC; event time (not insert time); month-end snapshot for billing rows`.
- **Why it matters:** cross-timezone aggregations, fiscal-vs-calendar buckets, and "as-of" snapshots produce wrong-bucket numbers that pass dry-run.

### 8. Cross-system identifiers

- **Trigger:** column name contains an external-system tag (`stripe_*`, `salesforce_*`, `intercom_*`, `hubspot_*`, `*_external_id`, `*_external_ref`) OR raw maps an internal ID to an external system.
- **Sink:** `instructions.md` under heading `## External identifiers`.
- **Write format:**
  ```markdown
  ## External identifiers
  - `users.stripe_customer_id` maps to a Stripe Customer object. NULL = not yet billed.
  - `orders.external_ref` is the source-system order ID; format varies by `orders.source` (`shopify` = 13-digit numeric, `manual` = free-form string).
  ```
- **Why it matters:** the agent has no schema for foreign systems; it needs the explicit mapping plus the format / null semantics.

### 9. Currency / locale

- **Trigger:** any model has `currency`, `locale`, `country`, `region`, `fx_rate`, `original_amount` column OR raw mentions FX rates, multi-currency, or non-USD reporting.
- **Sink:** `instructions.md` under heading `## Currency`.
- **Write format:**
  ```markdown
  ## Currency
  - All amounts in `orders.amount` are USD-converted at order-time FX (see `orders.fx_rate`). Use `orders.original_amount` + `orders.currency` for source-currency analysis.
  - Display monetary values with 2 decimals and thousand separators.
  ```
- **Why it matters:** the agent will sum mixed-currency rows without converting if no rule is present.

### 10. Canonical table preferences

- **Trigger:** schema has lookalike tables (`users` / `users_v3`, `orders` / `orders_archive` / `orders_summary`) OR raw says "use X not Y" / "deprecated" / "raw mirror".
- **Sink:** `instructions.md` under heading `## Canonical tables`.
- **Write format:**
  ```markdown
  ## Canonical tables
  - Use `customers` for analytics. `customers_v3` is the legacy raw mirror — do not query.
  - For order date ranges > 90 days, use `orders_summary`. `orders` is row-level only and slow on large windows.
  ```
- **Why it matters:** without an explicit rule the agent picks tables by lexical proximity and silently goes to the wrong one.

## Re-enrichment audit

To check what a previous enrich run already covered before adding more:

```bash
# Column-local tags
grep -rE '\[(enum|unit|null|magic|time|pii)\]' models/

# instructions.md section headings written by enrich
grep -E '^## (Default filters|Naming conventions|External identifiers|Currency|Canonical tables)' instructions.md
```

Any existing `[tag]` line or `##` section means that category has been touched on that target — **do not rewrite by Universal Rule 1**. Surface contradictions on the manual-fix list instead.

## Out of scope (do not propose in this skill)

- **PII / privacy policy** — if raw flags a column as sensitive, add a `[pii] mask in non-prod` line to its description, but do not draft an org-wide privacy policy. That's a separate concern.
- **Performance hints** — `cached:` is an MDL field, not a description rule.
- **Row-level access** — use the `row_level_access_controls:` MDL field, not a free-text rule.
- **Schema corrections** — wrong PK, wrong join type, wrong column type. Surface on manual-fix; never edit (Universal Rule 1).
