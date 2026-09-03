.mode line
.print '=== T1 cross-system-union ==='
SELECT
  (SELECT COUNT(*) FROM orders) AS new_platform_orders_only,
  (SELECT COUNT(*) FROM orders) + (SELECT COUNT(*) FROM legacy_orders WHERE migrated_at IS NULL) AS correct_historical_order_count;

.print '=== T2 dedup-migration ==='
SELECT
  (SELECT COUNT(*) FROM orders WHERE legacy_ord_id IS NOT NULL) AS migrated_dupes_in_orders,
  (SELECT COUNT(*) FROM legacy_orders WHERE migrated_at IS NOT NULL) AS migrated_flagged_in_legacy;

.print '=== T3 unit-cents ==='
SELECT
  SUM(amt_c) AS naive_sum_treated_as_dollars,
  SUM(amt_c) / 100.0 AS correct_sum_usd
FROM legacy_orders;

.print '=== T4 same-name-diff-meaning ==='
SELECT
  SUM(p.amount) AS naive_net_sum,
  SUM(p.amount + p.fee_amount) AS gross_reconstructed_from_payments,
  (SELECT SUM(o.order_total) FROM orders o WHERE o.id IN (SELECT order_id FROM payments WHERE amount > 0)) AS order_total_sum_for_paid_orders
FROM payments p WHERE p.method != 'refund_reversal';

.print '=== T5 refund-double-count ==='
SELECT
  (SELECT COUNT(*) FROM payments WHERE amount < 0) AS negative_payment_rows,
  (SELECT COUNT(*) FROM refunds) AS refund_rows,
  (SELECT SUM(-amount) FROM payments WHERE amount < 0) AS negative_payment_total,
  (SELECT SUM(amount) FROM refunds) AS refund_total;

.print '=== T6 test-and-deleted ==='
SELECT
  (SELECT COUNT(*) FROM customers) AS all_customers,
  (SELECT COUNT(*) FROM customers WHERE is_test = false AND deleted_at IS NULL) AS clean_customers,
  (SELECT COUNT(*) FROM customers WHERE is_test = true) AS test_customers,
  (SELECT COUNT(*) FROM customers WHERE deleted_at IS NOT NULL) AS deleted_customers;

.print '=== T7 enum-drift (marketing_channel) ==='
SELECT marketing_channel, COUNT(*) AS n FROM customers GROUP BY marketing_channel ORDER BY n DESC;

.print '=== T7 enum-drift (order status paid family) ==='
SELECT status, COUNT(*) AS n FROM orders WHERE lower(status) = 'paid' GROUP BY status ORDER BY n DESC;

.print '=== T8 semi-additive (subscriptions MRR) ==='
SELECT
  (SELECT SUM(mrr_amount) FROM subscription_snapshots) AS naive_sum_all_months_wrong,
  (SELECT SUM(mrr_amount) FROM subscription_snapshots WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM subscription_snapshots)) AS correct_latest_month_mrr,
  (SELECT COUNT(DISTINCT snapshot_date) FROM subscription_snapshots) AS n_months;

.print '=== T8 semi-additive (inventory) ==='
SELECT
  (SELECT SUM(units_on_hand) FROM inventory_levels) AS naive_sum_all_snapshots_wrong,
  (SELECT SUM(units_on_hand) FROM inventory_levels WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM inventory_levels)) AS correct_latest_snapshot_total;

.print '=== T9 fiscal-calendar ==='
SELECT date, fiscal_year, fiscal_quarter FROM fiscal_calendar WHERE date IN ('2024-01-31','2024-02-01','2025-01-31','2025-02-01') ORDER BY date;

.print '=== T10 timezone ==='
SELECT
  COUNT(*) AS total_legacy_orders,
  COUNT(*) FILTER (
    -- naive LA local -> naive UTC, independent of the session timezone
    WHERE strftime(timezone('UTC', timezone('America/Los_Angeles', ord_dt::TIMESTAMP)), '%Y-%m-%d')
       != substr(ord_dt, 1, 10)
  ) AS rows_where_naive_utc_reading_shifts_the_calendar_day
FROM legacy_orders;

.print '=== T11 currency ==='
SELECT currency, COUNT(*) AS n, SUM(order_total) AS naive_meaningless_sum FROM orders GROUP BY currency ORDER BY currency;

.print '=== T11 currency (fx coverage / weekend gap) ==='
SELECT
  (SELECT COUNT(*) FROM fx_rates WHERE currency='EUR') AS eur_days_with_rate,
  (SELECT COUNT(*) FROM generate_series(DATE '2023-01-01', DATE '2026-06-30', INTERVAL 1 DAY)) AS total_calendar_days_in_range;

.print '=== T12 sentinel-null ==='
SELECT
  COUNT(*) FILTER (WHERE ship_dt = '1970-01-01 00:00:00') AS sentinel_unshipped_rows,
  COUNT(*) FILTER (WHERE ship_dt != '1970-01-01 00:00:00') AS real_ship_dt_rows,
  COUNT(*) AS total
FROM legacy_orders;

.print '=== T13 identity-dedup ==='
SELECT
  (SELECT COUNT(*) FROM legacy_customers lc JOIN customers c
     ON lower(trim(lc.email)) = lower(trim(c.email))) AS true_overlap_by_email,
  (SELECT COUNT(*) FROM customer_xref) AS xref_rows,
  (SELECT COUNT(DISTINCT c.id)
     FROM customers c
     LEFT JOIN customer_xref x ON x.customer_id = c.id
     WHERE x.customer_id IS NULL
       AND EXISTS (SELECT 1 FROM legacy_customers lc WHERE lower(trim(lc.email)) = lower(trim(c.email)))
  ) AS overlap_customers_missed_by_xref_alone;

.print '=== T14 grain-mismatch ==='
SELECT
  COUNT(*) AS total_orders,
  COUNT(*) FILTER (WHERE ABS(o.order_total - i.items_sum) <= 0.005) AS exact_match,
  COUNT(*) FILTER (WHERE ABS(o.order_total - i.items_sum) > 0.005) AS mismatched,
  ROUND(100.0 * COUNT(*) FILTER (WHERE ABS(o.order_total - i.items_sum) > 0.005) / COUNT(*), 2) AS pct_mismatched
FROM orders o
JOIN (SELECT order_id, SUM(quantity*unit_price - discount_amount) AS items_sum FROM order_items GROUP BY order_id) i
  ON i.order_id = o.id;

.print '=== T15 returns-vs-refunds ==='
SELECT
  (SELECT COUNT(DISTINCT oi.order_id) FROM returns r JOIN order_items oi ON oi.id = r.order_item_id) AS orders_with_returns,
  (SELECT COUNT(DISTINCT order_id) FROM refunds) AS orders_with_refunds,
  (SELECT COUNT(DISTINCT oi.order_id) FROM returns r JOIN order_items oi ON oi.id = r.order_item_id
     WHERE oi.order_id IN (SELECT order_id FROM refunds)) AS orders_with_both;
