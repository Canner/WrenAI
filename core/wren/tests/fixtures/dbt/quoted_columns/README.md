These artifacts were generated with dbt-core 1.12.6 and dbt-duckdb 1.11.0
using `dbt build` and `dbt docs generate`, then trimmed to the fields consumed
by the importer. Both models have a `customer-id` column with `quote: true`.
`dim_customers` has `not_null` and `unique` tests; `fct_orders` has a
`relationships` test targeting `dim_customers` with `field: '"customer-id"'`.
All five dbt build results passed.
