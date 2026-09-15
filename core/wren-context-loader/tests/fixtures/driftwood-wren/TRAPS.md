# Driftwood trap catalogue (T1-T15)

Each trap below is: a short description of the mess and why it exists in the
Driftwood Outfitters narrative, one validation SQL query (runnable via
`duckdb driftwood.duckdb`), and the actual value(s) computed against the
generated database (seed 42). Numbers were captured by running
`_validate.sql`-equivalent queries against `driftwood.duckdb` after
`uv run generate.py`; re-running the generator reproduces them exactly
(see README.md "Determinism").

---

### T1 — `cross-system-union`

Revenue and order volume span two systems: the legacy platform (2019-01 to
2023-08) and the new platform (2023-03 onward). A query that only touches
`orders` silently drops every order placed before the migration window
started (2019-01 to 2023-02) and undercounts historical volume.

```sql
SELECT
  (SELECT COUNT(*) FROM orders) AS new_platform_orders_only,
  (SELECT COUNT(*) FROM orders)
    + (SELECT COUNT(*) FROM legacy_orders WHERE migrated_at IS NULL) AS deduped_union,
  (SELECT COUNT(*) FROM orders o JOIN customers c ON c.id = o.customer_id
     WHERE NOT c.is_test AND o.legacy_ord_id IS NULL)
    + (SELECT COUNT(*) FROM legacy_orders) AS canonical_all_time_orders;
```

**Result:** `new_platform_orders_only = 60,000` vs `deduped_union =
102,174` — the naive query misses ~42% of all-time order volume. The
**canonical** answer additionally applies the knowledge rules (test-account
exclusion on every business metric): `canonical_all_time_orders = 100,994`,
which is what golden `g03_total_orders_all_time` expects.

---

### T2 — `dedup-migration`

Legacy orders placed during the 2023-03→2023-08 migration window with
status paid/shipped/delivered were dual-written: the original row stays in
`legacy_orders` (flagged via `migrated_at`) and a duplicate is inserted into
`orders` (flagged via `legacy_ord_id`). A naive `UNION` of the two tables
double-counts every migrated order.

```sql
SELECT
  (SELECT COUNT(*) FROM orders WHERE legacy_ord_id IS NOT NULL) AS migrated_dupes_in_orders,
  (SELECT COUNT(*) FROM legacy_orders WHERE migrated_at IS NOT NULL) AS migrated_flagged_in_legacy;
```

**Result:** `2,826` = `2,826` — the two flags agree exactly, confirming
the fix (`WHERE legacy_ord_id IS NULL` or `WHERE migrated_at IS NULL`) is
correct.

---

### T3 — `unit-cents`

`legacy_orders.amt_c` is an integer in **cents**, USD only. Summing it
directly and treating the result as dollars overstates revenue by 100x.

```sql
SELECT SUM(amt_c) AS naive_sum_treated_as_dollars, SUM(amt_c) / 100.0 AS correct_sum_usd
FROM legacy_orders;
```

**Result:** `1,437,820,899` (naive) vs `14,378,208.99` (correct) — exactly
100x apart.

---

### T4 — `same-name-diff-meaning`

`payments.amount` is the **net** amount captured (gross minus processor
fee); `orders.order_total` is the **gross** order value. They share no
column name collision but are frequently confused because both represent
"how much this order is worth." Recognized revenue must reconstruct gross
as `amount + fee_amount`.

```sql
SELECT
  SUM(p.amount) AS naive_net_sum,
  SUM(p.amount + p.fee_amount) AS gross_reconstructed_from_payments,
  (SELECT SUM(o.order_total) FROM orders o WHERE o.id IN (SELECT order_id FROM payments WHERE amount > 0))
    AS order_total_sum_for_paid_orders
FROM payments p WHERE p.method != 'refund_reversal';
```

**Result:** `naive_net_sum = 15,709,036.14` vs
`gross_reconstructed_from_payments = 16,193,909.41`, which matches
`order_total_sum_for_paid_orders = 16,193,909.41` exactly — using the net
figure alone understates recognized revenue by ~$484,873 (fees).

---

### T5 — `refund-double-count`

Every refund produces **two** artifacts: a positive-gross row in `refunds`
*and* a negative-amount row in `payments` (`method = 'refund_reversal'`).
Subtracting both from revenue double-counts the refund.

```sql
SELECT
  (SELECT COUNT(*) FROM payments WHERE amount < 0) AS negative_payment_rows,
  (SELECT COUNT(*) FROM refunds) AS refund_rows,
  (SELECT SUM(-amount) FROM payments WHERE amount < 0) AS negative_payment_total,
  (SELECT SUM(amount) FROM refunds) AS refund_total;
```

**Result:** `negative_payment_rows = 3,845` = `refund_rows = 3,845`;
`negative_payment_total = 892,028.20` = `refund_total = 892,028.20` — the
two representations are exact duplicates of each other, by construction.

---

### T6 — `test-and-deleted`

`customers.is_test` (internal QA accounts) and `deleted_at` (soft deletes)
both inflate a naive `COUNT(*)` on `customers`.

```sql
SELECT
  (SELECT COUNT(*) FROM customers) AS all_customers,
  (SELECT COUNT(*) FROM customers WHERE is_test = false AND deleted_at IS NULL) AS clean_customers,
  (SELECT COUNT(*) FROM customers WHERE is_test = true) AS test_customers,
  (SELECT COUNT(*) FROM customers WHERE deleted_at IS NOT NULL) AS deleted_customers;
```

**Result:** `all_customers = 8,000` vs `clean_customers = 7,508`
(`test_customers = 164`, `deleted_customers = 332`) — the naive count is
inflated by ~6.6%.

---

### T7 — `enum-drift`

`customers.marketing_channel` has ten raw values that collapse into four
canonical buckets (Facebook: `fb`/`facebook`/`Facebook Ads`; Google:
`google`/`adwords`/`Google`; Email: `email`/`newsletter`; Organic; NULL). A
naive `GROUP BY` fragments what should be one bucket into three or more
rows. Independently, `orders.status` has `'paid'` spelled three ways.

```sql
SELECT marketing_channel, COUNT(*) AS n FROM customers GROUP BY marketing_channel ORDER BY n DESC;

SELECT status, COUNT(*) AS n FROM orders WHERE lower(status) = 'paid' GROUP BY status ORDER BY n DESC;
```

**Result (channel):** `NULL=1,574`, `organic=1,572`, `google=958`,
`fb=834`, `email=784`, `facebook=616`, `adwords=514`,
`Facebook Ads=426`, `newsletter=386`, `Google=336` — canonical Facebook
total = 834+616+426 = **1,876**; canonical Google total =
958+514+336 = **1,808**; canonical Email total = 784+386 = **1,170**, none
of which is visible without the canonical mapping.

**Result (status):** `paid=18,650`, `PAID=275`, `Paid=259` — the case
variants are 534/19,184 ≈ **2.8%** of all paid-family rows (target ~3%).

---

### T8 — `semi-additive`

`subscription_snapshots.mrr_amount` and `inventory_levels.units_on_hand`
are month-end **snapshots**. Both are semi-additive: they must never be
summed across time (only across the entity dimension, at a fixed month).

```sql
SELECT
  (SELECT SUM(mrr_amount) FROM subscription_snapshots) AS naive_sum_all_months_wrong,
  (SELECT SUM(mrr_amount) FROM subscription_snapshots
     WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM subscription_snapshots)) AS correct_latest_month_mrr;

SELECT
  (SELECT SUM(units_on_hand) FROM inventory_levels) AS naive_sum_all_snapshots_wrong,
  (SELECT SUM(units_on_hand) FROM inventory_levels
     WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM inventory_levels)) AS correct_latest_snapshot_total;
```

**Result (MRR):** naive sum across 30 month-end snapshots =
`560,005.51` vs correct current MRR = `28,687.92` — off by ~19.5x.

**Result (inventory):** naive sum across all monthly snapshots =
`5,981,264` vs correct current on-hand = `150,807` — off by ~40x.

---

### T9 — `fiscal-calendar`

Driftwood's fiscal year starts **February 1**. `fiscal_calendar` maps every
calendar date to `(fiscal_year, fiscal_quarter)`; a query using calendar
quarters for "Q3 revenue" answers the wrong question.

```sql
SELECT date, fiscal_year, fiscal_quarter FROM fiscal_calendar
WHERE date IN ('2024-01-31','2024-02-01','2025-01-31','2025-02-01') ORDER BY date;
```

**Result:**

| date | fiscal_year | fiscal_quarter |
| --- | --- | --- |
| 2024-01-31 | 2023 | FY2023-Q4 |
| 2024-02-01 | 2024 | FY2024-Q1 |
| 2025-01-31 | 2024 | FY2024-Q4 |
| 2025-02-01 | 2025 | FY2025-Q1 |

A single calendar-day boundary (Jan 31 → Feb 1) flips both the fiscal year
and the quarter.

---

### T10 — `timezone`

`legacy_orders.ord_dt` is a **naive** local-time string in
`America/Los_Angeles`, generated from a true UTC instant. Treating the
string as if it were already UTC shifts the calendar day for any order
placed near midnight LA time.

```sql
SELECT
  COUNT(*) AS total_legacy_orders,
  COUNT(*) FILTER (
    -- timezone('UTC', timezone('America/Los_Angeles', ts)) = interpret the naive string
    -- as LA local, then express it as naive UTC — independent of the session timezone
    -- (date_trunc on a TIMESTAMPTZ would silently truncate in the session zone instead).
    WHERE strftime(timezone('UTC', timezone('America/Los_Angeles', ord_dt::TIMESTAMP)), '%Y-%m-%d')
       != substr(ord_dt, 1, 10)
  ) AS rows_where_naive_utc_reading_shifts_the_calendar_day
FROM legacy_orders;
```

**Result:** `13,736` of `45,000` rows (~30.5%) land on a different UTC
calendar day than their naive local date — consistent with a 7-8 hour
offset (≈ 7.5/24 of uniformly-drawn timestamps sit within the offset of a
day boundary). Any day/month/year bucketing that misreads the naive string
as UTC misplaces those rows.

---

### T11 — `currency`

`orders.currency` is USD/EUR/GBP. Summing `order_total` across currencies
without conversion produces a meaningless number. `fx_rates` only has
**weekday** rows (no Sat/Sun), so a same-day join needs a last-value
carry-forward for weekend-captured payments.

```sql
SELECT currency, COUNT(*) AS n, SUM(order_total) AS naive_meaningless_sum FROM orders GROUP BY currency ORDER BY currency;

SELECT
  (SELECT COUNT(*) FROM fx_rates WHERE currency='EUR') AS eur_days_with_rate,
  (SELECT COUNT(*) FROM generate_series(DATE '2023-01-01', DATE '2026-06-30', INTERVAL 1 DAY)) AS total_calendar_days_in_range;
```

**Result:** `EUR: n=14,417, sum=4,576,032.18` / `GBP: n=5,680,
sum=1,751,345.71` / `USD: n=39,903, sum=12,774,201.62` — adding these three
sums together is not a valid USD total. `fx_rates` covers `912` of `1,277`
calendar days (~71.4%, i.e. exactly the weekday fraction) — any date-join
must fall back to the most recent prior rate on weekends.

---

### T12 — `sentinel-null`

`legacy_orders.ship_dt` uses the epoch-zero sentinel
`'1970-01-01 00:00:00'` to mean "never shipped," instead of `NULL`. Treated
as a real date, it silently becomes the oldest "ship date" in the dataset.

```sql
SELECT
  COUNT(*) FILTER (WHERE ship_dt = '1970-01-01 00:00:00') AS sentinel_unshipped_rows,
  COUNT(*) FILTER (WHERE ship_dt != '1970-01-01 00:00:00') AS real_ship_dt_rows,
  COUNT(*) AS total
FROM legacy_orders;
```

**Result:** `sentinel_unshipped_rows = 19,333` / `real_ship_dt_rows =
25,667` out of `45,000` — 43% of legacy orders would appear to have
shipped on 1970-01-01 unless the sentinel is filtered out.

---

### T13 — `identity-dedup`

~3,000 humans exist in both `customers` and `legacy_customers` under
casing/whitespace email variants (e.g. `Jane.Doe@gmail.com` vs
`jane.doe@gmail.com `). `customer_xref` links only ~87% of them explicitly;
the rest are only resolvable by normalizing and joining on email.

```sql
SELECT
  (SELECT COUNT(*) FROM legacy_customers lc JOIN customers c
     ON lower(trim(lc.email)) = lower(trim(c.email))) AS true_overlap_by_email,
  (SELECT COUNT(*) FROM customer_xref) AS xref_rows,
  (SELECT COUNT(*) FROM legacy_customers l
     WHERE EXISTS (SELECT 1 FROM customers c
                   WHERE lower(trim(c.email)) = lower(trim(l.email)))
       AND NOT EXISTS (SELECT 1 FROM customer_xref x
                       WHERE x.cust_ref = l.cust_ref)) AS overlap_missed_by_xref;
```

**Result:** `true_overlap_by_email = 2,936` vs `xref_rows = 2,550`, and
`overlap_missed_by_xref = 442` (golden `g38_xref_gap`). Note the gap is
**not** `2,936 − 2,550 = 386`: the two sets only partially overlap — 56 of
the 2,550 xref rows map legacy customers whose emails do *not* normalize to
a new-platform match, so a set difference, not a count difference, is
required. A naive customer count that trusts `customer_xref` alone misses
442 real overlaps (~15%) that only surface via `lower(trim(email))`
matching.

---

### T14 — `grain-mismatch`

`orders.order_total` (header grain) and `SUM(order_items)` (line grain)
mostly agree exactly, but ~8% of orders carry a small rounding delta
(±$0.01-$0.99) between the two representations.

```sql
SELECT
  COUNT(*) AS total_orders,
  COUNT(*) FILTER (WHERE ABS(o.order_total - i.items_sum) <= 0.005) AS exact_match,
  COUNT(*) FILTER (WHERE ABS(o.order_total - i.items_sum) > 0.005) AS mismatched,
  ROUND(100.0 * COUNT(*) FILTER (WHERE ABS(o.order_total - i.items_sum) > 0.005) / COUNT(*), 2) AS pct_mismatched
FROM orders o
JOIN (SELECT order_id, SUM(quantity*unit_price - discount_amount) AS items_sum FROM order_items GROUP BY order_id) i
  ON i.order_id = o.id;
```

**Result:** `total_orders = 60,000`, `exact_match = 55,172`,
`mismatched = 4,828` → **8.05%** mismatched (target ~8%) — a reconciliation
report keyed on `order_total` alone will disagree with one built from
`order_items` for roughly 1 in 12 orders.

---

### T15 — `returns-vs-refunds`

`returns` (RMA / physical product returns) and `refunds` (monetary refunds)
are independent concepts with only partial overlap — a returned item
doesn't always trigger a refund, and a refund doesn't require a physical
return. Using one table to answer a question about the other undercounts
or overcounts depending on direction.

```sql
SELECT
  (SELECT COUNT(DISTINCT oi.order_id) FROM returns r JOIN order_items oi ON oi.id = r.order_item_id) AS orders_with_returns,
  (SELECT COUNT(DISTINCT order_id) FROM refunds) AS orders_with_refunds,
  (SELECT COUNT(DISTINCT oi.order_id) FROM returns r JOIN order_items oi ON oi.id = r.order_item_id
     WHERE oi.order_id IN (SELECT order_id FROM refunds)) AS orders_with_both;
```

**Result:** `orders_with_returns = 1,977`, `orders_with_refunds = 3,845`,
`orders_with_both = 142` — only ~4% of returns orders also show up in
refunds (and vice versa), confirming the two are mostly disjoint
populations that must not be conflated.
