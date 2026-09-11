# Canonical metric definitions (Driftwood)

These are the company's authoritative definitions. When a question asks for one of these
metrics, use exactly this definition — do not improvise an alternative.

## Recognized revenue / gross captured volume

- **Gross captured payment volume** = `SUM(payments.amount + payments.fee_amount)` over
  payment rows with `method <> 'refund_reversal'`. (`payments.amount` alone is NET of
  processor fees; `orders.order_total` is a header estimate, not money movement.)
- **Refunds are subtracted from the `refunds` table only.** Every refund exists twice:
  as a `refunds` row (positive, gross) AND as a negative `payments` row
  (`method = 'refund_reversal'`). Counting both double-subtracts. Convention: exclude
  `refund_reversal` rows from payment sums; take refund totals from `refunds`.
- **Net recognized revenue** = gross captured volume − `SUM(refunds.amount)`, both in USD.

## Currency conversion

- Reporting currency is **USD**. Convert EUR/GBP amounts at the `fx_rates` rate for the
  transaction date; `fx_rates` has business days only — for weekend dates use the **latest
  prior business day's** rate (ASOF/last-value join on `fx_rates.date <= txn_date` per currency).

## Merchandise value (order value at line grain)

- Canonical order/merchandise value is computed at **line-item grain**:
  `SUM(order_items.quantity * order_items.unit_price - order_items.discount_amount)`.
- `orders.order_total` disagrees with the line-item sum on ~8% of orders (rounding,
  partial-refund adjustments). For reconciliation-sensitive answers, line items win.

## MRR (monthly recurring revenue)

- MRR is a **point-in-time balance**, read from `subscription_snapshots` at a single
  `snapshot_date` (month-end): `SUM(mrr_amount) WHERE snapshot_date = <month end>`.
- **Never sum mrr_amount across snapshot dates.** "MRR for December 2025" means the
  2025-12-31 snapshot. "Average MRR over a year" means the average of the 12 month-end
  totals. The same point-in-time rule applies to `inventory_levels.units_on_hand`.
