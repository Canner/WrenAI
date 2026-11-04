---
defaults:
  - id: exclude-test-accounts
    kind: exclude_rows
    column: customers.is_test
    exclude: true
    covers: {reaching: customers, via: many_to_one}
    when: aggregated
    unless:
      - addresses_column
      - filtered_by: orders.legacy_ord_id IS NOT NULL
---
# Reporting conventions (Shopfront)

Internal test accounts are flagged `customers.is_test`. Exclude them from every
business metric unless the question is about test accounts themselves.
