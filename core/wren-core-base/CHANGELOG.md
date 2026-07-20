# Changelog

## [0.3.0](https://github.com/Canner/WrenAI/compare/wren-core-base-v0.2.0...wren-core-base-v0.3.0) (2026-07-20)


### Features

* **wren-mdl:** loosen manifest schema and bump layout version to 4 ([#2501](https://github.com/Canner/WrenAI/issues/2501)) ([283d089](https://github.com/Canner/WrenAI/commit/283d0896e692bfacc408677a9ee456ee4f73ada2))

## [0.2.0](https://github.com/Canner/WrenAI/compare/wren-core-base-v0.1.0...wren-core-base-v0.2.0) (2026-07-10)


### Features

* add MDL layout versioning and dialect field on Model and View ([#1556](https://github.com/Canner/WrenAI/issues/1556)) ([db2f0e4](https://github.com/Canner/WrenAI/commit/db2f0e4689b3565989288489c57a3e5a55a2f3ef))
* **core:** add BigQuery EXTRACT function support and window frame validation ([#1279](https://github.com/Canner/WrenAI/issues/1279)) ([eae6a34](https://github.com/Canner/WrenAI/commit/eae6a3409570d2bb7b5df30800d8191d4a20b8ac))
* **core:** import wren-engine into core/ ([cc9b67f](https://github.com/Canner/WrenAI/commit/cc9b67f593bf94c7418e0abb0ed46aa4a21613c3))
* **core:** import wren-engine into core/ ([#2209](https://github.com/Canner/WrenAI/issues/2209)) ([8b8a1a3](https://github.com/Canner/WrenAI/commit/8b8a1a3c5bf2a43d56ea1587782a0d5d853803b2))
* **core:** introduce dialect-specific function list and refactor BigQuery function lists ([#1366](https://github.com/Canner/WrenAI/issues/1366)) ([586156f](https://github.com/Canner/WrenAI/commit/586156fde21005e2ac00c92236bbcdb0b3bfa754))
* **ibis:** Add Spark connector  ([#1398](https://github.com/Canner/WrenAI/issues/1398)) ([260eb68](https://github.com/Canner/WrenAI/commit/260eb68fbd467ade901d5c58af73e3ecafecaf77))
* **ibis:** introduce Databricks connector ([#1361](https://github.com/Canner/WrenAI/issues/1361)) ([8601c78](https://github.com/Canner/WrenAI/commit/8601c780b4193c15042261280039be22b8527631))
* **wren-core-base:** replace Metric with Cube types and remove deprecated security types ([#1574](https://github.com/Canner/WrenAI/issues/1574)) ([72d18a8](https://github.com/Canner/WrenAI/commit/72d18a81bbc28a9833a07e19486de16cf59836d0))
* **wren-core:** add refSql model support ([#1555](https://github.com/Canner/WrenAI/issues/1555)) ([815889c](https://github.com/Canner/WrenAI/commit/815889c69bdf5dd4dc13d4dd06ae3bfd160b6e73))
* **wren-core:** support composite (multi-column) primary keys ([#2345](https://github.com/Canner/WrenAI/issues/2345)) ([d33917f](https://github.com/Canner/WrenAI/commit/d33917f046f4ac0abddbbce9ce6c9c10b5adb10a))
* **wren-engine:** add Apache Doris connector support ([#1430](https://github.com/Canner/WrenAI/issues/1430)) ([185dbb0](https://github.com/Canner/WrenAI/commit/185dbb09a93d82a6cc6e092148983f04a6e05d6c))


### Bug Fixes

* **core-py:** avoid to generate duplicate models after extracting manifest ([#1244](https://github.com/Canner/WrenAI/issues/1244)) ([24646bd](https://github.com/Canner/WrenAI/commit/24646bd77b0c1f083d4391569087cf827d356e58))
* **core:** allow the RLAC condition invoke the hidden columns ([#1330](https://github.com/Canner/WrenAI/issues/1330)) ([d8f1fa6](https://github.com/Canner/WrenAI/commit/d8f1fa676fd7cdb605e6a6e78c9828758e3ff17f))
* **core:** normalize the name of session property ([#1331](https://github.com/Canner/WrenAI/issues/1331)) ([ccd040c](https://github.com/Canner/WrenAI/commit/ccd040c8976336cb91529992c2e4ea1f72870607))
