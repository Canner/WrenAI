---
defaults:
  - id: usd-at-transaction-date
    kind: require_rate_join
    when: aggregated
    amounts:
      - {columns: [payments.amount], currency: payments.currency, dates: [payments.captured_at]}
      - {columns: [orders.order_total, order_items.unit_price], currency: orders.currency, dates: [orders.placed_at]}
    rate: {model: fx_rates, currency: fx_rates.currency, date: fx_rates.date, match: on_or_before}
    unless:
      - groups_by_currency
      - filters_currency_literal
---
# Canonical metrics (Shopfront)

Report money in USD. Convert each amount with the `fx_rates` row for its currency
on the transaction date, or the latest earlier date when the day has no rate.
