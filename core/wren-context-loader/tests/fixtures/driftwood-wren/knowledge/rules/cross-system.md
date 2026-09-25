# Cross-system rules: legacy platform vs new platform

Driftwood migrated platforms in 2023. Legacy (`legacy_*` tables) covers 2019-01 → 2023-08;
the new platform (`orders`, `customers`, …) covers 2023-03 → present. Any all-time or
pre-2023 question must combine both systems under these rules.

## Order dedup (the migration copied orders)

- Legacy orders from the migration window were **copied into `orders`**: the copy carries
  `orders.legacy_ord_id = legacy_orders.ord_id`, and the source carries
  `legacy_orders.migrated_at IS NOT NULL`.
- **Counting rule**: all-time order counts/sums = all of `legacy_orders` + only
  `orders WHERE legacy_ord_id IS NULL` (or equivalently: all of `orders` + only
  `legacy_orders WHERE migrated_at IS NULL`). Never a plain UNION of both tables.

## Legacy amounts and timestamps

- `legacy_orders.amt_c` is integer **US cents** — divide by 100.0. Legacy is USD-only.
- `legacy_orders.ord_dt` / `ship_dt` are naive **America/Los_Angeles local time** strings.
  Convert to UTC before any date bucketing or comparison — the reporting timezone is
  always UTC (see conventions), including for legacy-only questions.
- `legacy_orders.ship_dt = '1970-01-01 00:00:00'` is a sentinel meaning **never shipped**
  — treat it as NULL, never as a real date.
- Legacy statuses are numeric codes: decode via `legacy_status_codes`
  (1 pending, 2 paid, 3 shipped, 4 delivered, 5 partial, 7 refunded, 9 cancelled).

## Customer identity across systems

- Many legacy customers are the **same person** as a new-platform customer.
  `customer_xref` maps them but is **incomplete** (~87% of the true overlap).
- **Identity rule**: resolve identity by normalized email —
  `lower(trim(email))` matches across `legacy_customers` and `customers` — and use
  `customer_xref` only as a supplement. Unique-customer counts = new-platform customers
  (excluding test accounts) + legacy customers whose normalized email has no
  new-platform match.
