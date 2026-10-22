# OpenMetadata API fixtures

Recorded responses replayed by `tests/unit/test_openmetadata.py`, so the importer is tested
without a live OpenMetadata server.

Recorded from the OpenMetadata **2.0.5** docker quickstart (`docker-compose.yml` from the
`2.0.5-release` GitHub release) after ingesting a sample Postgres 16 database through the
quickstart's ingestion container:

- service `shop_pg`, database `shop`, schemas `shop` and `ref` (`information_schema` excluded
  with a `schemaFilterPattern`)
- tables with single-column, composite, cross-schema and primary-key-as-foreign-key constraints,
  plus `shop.page_views` with no foreign keys
- curated in OpenMetadata after ingestion: `customers` description, `Tier.Tier1` tag and `admin`
  owner; `customers.email` description and `PII.Sensitive` tag

| File | Request |
|------|---------|
| `system_version.json` | `GET /api/v1/system/version` |
| `database_service.json` | `GET /api/v1/services/databaseServices/name/shop_pg` (OpenMetadata masks the password) |
| `tables_page_1.json`, `tables_page_2.json` | `GET /api/v1/tables?database=shop_pg.shop&fields=columns,tableConstraints,tags,owners&limit=5`, then the same request with the returned `after` cursor |

The small page size makes the fixtures exercise the paging cursor.
