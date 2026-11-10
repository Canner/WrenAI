# driftwood-wren

A deliberately messy semantic-layer project: a dual-write migration between two
order tables, multi-currency amounts, a February fiscal year, and subscriptions.

It is the input of the loader's `consumer_lineage` tests, which read it through the
MDL adapter and check that metrics reach their queries and dashboards.

Inputs:

- `wren_project.yml`
- `models/`
- `cubes/` and `cubes.yml`
- `knowledge/`
- `relationships.yml`
- `dashboards.yml`
