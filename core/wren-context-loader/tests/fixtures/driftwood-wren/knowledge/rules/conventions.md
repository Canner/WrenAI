# Reporting conventions (Driftwood)

## Default filters

- **Exclude test accounts from EVERY business metric** — customer counts, order counts,
  revenue, units sold, returns, subscriptions — unless the question explicitly asks about
  internal/test accounts. Test accounts are `customers.is_test = TRUE`; apply the exclusion
  wherever a customer link exists (orders/payments/refunds/returns join back to the
  customer). Legacy tables carry no test flag, so no exclusion is possible there.
- **Soft deletes**: `customers.deleted_at IS NOT NULL` rows still exist in the table.
  "Active customers" excludes them; counts of accounts/customers "we have (ever) had"
  include them (but still exclude test accounts).

## Reporting timezone

All date bucketing and calendar filters (year/quarter/month/day) are in **UTC**.
New-platform timestamps are already UTC. Legacy naive America/Los_Angeles timestamps must
be converted to UTC before any bucketing — including for legacy-only questions.

## Units sold

"Units sold" = the sum of order-line quantities, **excluding cancelled orders** (they were
never fulfilled). Refunded orders still count as sold — the money side is handled via
refunds, not by un-counting the sale.

## Marketing channel canonicalization

`customers.marketing_channel` contains historical variants. Canonical grouping:

| canonical | raw values |
| --- | --- |
| Facebook | 'fb', 'facebook', 'Facebook Ads' |
| Google | 'google', 'adwords', 'Google' |
| Email | 'email', 'newsletter' |
| Organic | 'organic' |
| Unknown | NULL |

Any channel question must aggregate over the canonical groups, not the raw strings.

## Order status normalization

`orders.status` is lowercase except a small share of historical mixed-case rows
('PAID', 'Paid'). Always compare case-insensitively: `lower(status) = 'paid'`.

## Fiscal calendar

The fiscal year starts **February 1** and is labeled by its starting year
(FY2024 = 2024-02-01 → 2025-01-31; Q1 = Feb–Apr, Q2 = May–Jul, Q3 = Aug–Oct,
Q4 = Nov–Jan). Any "Qn" or "fiscal year" question must go through `fiscal_calendar`
— never assume calendar quarters.

## Returns vs refunds (two different things)

- **Returns** (`returns`) = physical merchandise coming back (RMA), measured in units
  (`qty_returned`). Use for return rates and item counts.
- **Refunds** (`refunds`) = money given back, measured in currency. Use for refund
  amounts.
- They overlap only partially (a refund can happen without a return and vice versa);
  never join or substitute one for the other.
