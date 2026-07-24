# Changelog

## [0.13.2](https://github.com/Canner/WrenAI/compare/wren-v0.13.1...wren-v0.13.2) (2026-07-24)


### Bug Fixes

* **bigquery:** push LIMIT into SQL and strip trailing semicolon ([#2465](https://github.com/Canner/WrenAI/issues/2465)) ([0a25df3](https://github.com/Canner/WrenAI/commit/0a25df3eaba8d40ece29061c6970c63a46717178))
* **duckdb:** strip trailing semicolon on unlimited query path ([#2489](https://github.com/Canner/WrenAI/issues/2489)) ([3d1be24](https://github.com/Canner/WrenAI/commit/3d1be241e8cc625b7bb7df17cc871365edfbab9f))
* **mcp:** apply default row cap in list_stored_queries markdown fallback ([#2526](https://github.com/Canner/WrenAI/issues/2526)) ([86fac4f](https://github.com/Canner/WrenAI/commit/86fac4fcb2fdadeb5b7f5939539c19df24f8644c))
* **memory:** skip non-dict columns in seed query generation ([#2514](https://github.com/Canner/WrenAI/issues/2514)) ([a3de389](https://github.com/Canner/WrenAI/commit/a3de389752f5cfc5c01de9333bbf9f0c1e252597))
* **mssql:** strip trailing semicolons before sqlglot LIMIT rewrite ([#2476](https://github.com/Canner/WrenAI/issues/2476)) ([2e2d0a9](https://github.com/Canner/WrenAI/commit/2e2d0a9346319f0d871c84048fdc08687b8c1ba4))
* **oracle:** strip trailing semicolon on unlimited query path ([#2534](https://github.com/Canner/WrenAI/issues/2534)) ([78b5b93](https://github.com/Canner/WrenAI/commit/78b5b934792b8869c185bdb15796d2fdcf32c0ab))
* **profile:** exclude connection_url from selectable datasources ([#2527](https://github.com/Canner/WrenAI/issues/2527)) ([62712f2](https://github.com/Canner/WrenAI/commit/62712f21d9264578bfb34fd439b6cf5486b161fb))
* **profile:** mask secrets nested under kwargs and settings in profile debug ([#2525](https://github.com/Canner/WrenAI/issues/2525)) ([682e829](https://github.com/Canner/WrenAI/commit/682e829bb52f3fbcd4d2a203664f371ba2442f7b))
* **redshift:** strip trailing semicolon on unlimited query path ([#2482](https://github.com/Canner/WrenAI/issues/2482)) ([812e802](https://github.com/Canner/WrenAI/commit/812e80289687715460304469a5af01cecfcaf1ad))
* **redshift:** use public strip_trailing_semicolon on unlimited path ([#2560](https://github.com/Canner/WrenAI/issues/2560)) ([50e710d](https://github.com/Canner/WrenAI/commit/50e710deea6df466bce23c5915ccfd148d5f1113))
* **spark:** strip trailing semicolon before sql/dry_run ([#2464](https://github.com/Canner/WrenAI/issues/2464)) ([f4b45ed](https://github.com/Canner/WrenAI/commit/f4b45eddab3bd19919045c3f3bee16c85a8f7ebf))

## [0.13.1](https://github.com/Canner/WrenAI/compare/wren-v0.13.0...wren-v0.13.1) (2026-07-20)


### Bug Fixes

* **athena:** push LIMIT into SQL and strip trailing semicolon on wrap ([#2457](https://github.com/Canner/WrenAI/issues/2457)) ([79af489](https://github.com/Canner/WrenAI/commit/79af489464431c4bdaf1ff44a28050f0086376c9))
* **canner:** strip trailing semicolon on unlimited query path ([#2488](https://github.com/Canner/WrenAI/issues/2488)) ([c7e7462](https://github.com/Canner/WrenAI/commit/c7e7462e30bee1ba356861f885f7554fe8fefa3d))
* **clickhouse:** catch SqlglotError in type string parsing ([#2523](https://github.com/Canner/WrenAI/issues/2523)) ([e99d5ee](https://github.com/Canner/WrenAI/commit/e99d5eef086896152b29a0e5af30fa51e1bd765c))
* **connector:** use public strip_trailing_semicolon in dry_run paths ([#2550](https://github.com/Canner/WrenAI/issues/2550)) ([4e0c4f3](https://github.com/Canner/WrenAI/commit/4e0c4f35db1024cd5361b8b7156d878dd600630d))
* **context:** guard `wren context show`/`validate` against null relationship models ([#2494](https://github.com/Canner/WrenAI/issues/2494)) ([30f045d](https://github.com/Canner/WrenAI/commit/30f045d327f72d2acf5ed7749d831c7d5a86edce))
* **databricks:** strip trailing semicolon before query execute ([#2477](https://github.com/Canner/WrenAI/issues/2477)) ([7aebe4e](https://github.com/Canner/WrenAI/commit/7aebe4e7e28523cd34944e611f1d1981e694fa1d))
* **datafusion:** strip trailing semicolon before dry_run ([#2463](https://github.com/Canner/WrenAI/issues/2463)) ([fc5949f](https://github.com/Canner/WrenAI/commit/fc5949fde786653ba67e404b9592283d8f0b2fcd))
* **memory:** guard schema indexing against null relationship models ([#2493](https://github.com/Canner/WrenAI/issues/2493)) ([e19677f](https://github.com/Canner/WrenAI/commit/e19677fbe3fcc3249b7f24dfb45c7dcc01261c56))
* **postgres:** strip trailing semicolon on unlimited query path ([#2490](https://github.com/Canner/WrenAI/issues/2490)) ([7e4cfca](https://github.com/Canner/WrenAI/commit/7e4cfca9b40fc9b4055137b1a73718ef79358a6c))
* **profile:** mask all registry-sensitive fields in `wren profile debug` ([#2492](https://github.com/Canner/WrenAI/issues/2492)) ([68cf17b](https://github.com/Canner/WrenAI/commit/68cf17bd3b26a1a508694b44ce3f0a057eb60bde))
* **snowflake:** strip trailing semicolon before dry_run describe ([#2487](https://github.com/Canner/WrenAI/issues/2487)) ([724c9bd](https://github.com/Canner/WrenAI/commit/724c9bd2fce3d7b6cc1fbb53b7cf83f08fbefd9e))
* **trino:** coerce verify=false URL/kwargs for SSL connections ([#2481](https://github.com/Canner/WrenAI/issues/2481)) ([243eec8](https://github.com/Canner/WrenAI/commit/243eec883e12657791bcf911f4c2f2de6638bfa8))
* **trino:** fall back on Sqlglot TokenError for type strings ([#2505](https://github.com/Canner/WrenAI/issues/2505)) ([82ad7a1](https://github.com/Canner/WrenAI/commit/82ad7a1c473f8b28fd8df32d5e35b9955bc30b61))
* **trino:** sanitize bracketed userinfo and URL-decode credentials ([#2472](https://github.com/Canner/WrenAI/issues/2472)) ([769e222](https://github.com/Canner/WrenAI/commit/769e222a1366e4c2eaff8177a10065f2fb295efa))
* **type_mapping:** skip non-dict rows in parse/translate_types ([#2508](https://github.com/Canner/WrenAI/issues/2508)) ([aab727f](https://github.com/Canner/WrenAI/commit/aab727fa240f362547d2f21f56bc54bd2c17bdde))
* **wren:** align MCP handlers with ServeContext and query limits ([#2500](https://github.com/Canner/WrenAI/issues/2500)) ([55c128a](https://github.com/Canner/WrenAI/commit/55c128ab20a27ad20b2bce2320fa3bafd883be05))
* **wren:** bump transitive deps to clear security advisories ([#2529](https://github.com/Canner/WrenAI/issues/2529)) ([9b2c362](https://github.com/Canner/WrenAI/commit/9b2c362f42c4f05651d8d2adbc128fadbb043a93))
* **wren:** treat non-string SQL as not exploratory ([#2509](https://github.com/Canner/WrenAI/issues/2509)) ([cba94ad](https://github.com/Canner/WrenAI/commit/cba94ad1476ba4583695fed2aa3da31ddbbf59f3))


### Performance Improvements

* **wren:** defer memory model initialization ([#2513](https://github.com/Canner/WrenAI/issues/2513)) ([736175c](https://github.com/Canner/WrenAI/commit/736175c83f562e842b0e906279962cedfe9908bd))


### Documentation

* **wren:** fix cube hierarchy YAML examples ([#2502](https://github.com/Canner/WrenAI/issues/2502)) ([d0c6a46](https://github.com/Canner/WrenAI/commit/d0c6a46b348be785e3fbbc41270a4aadefbfb42a))

## [0.13.0](https://github.com/Canner/WrenAI/compare/wren-v0.12.0...wren-v0.13.0) (2026-07-13)


### Features

* **wren:** serve project capabilities over MCP ([#2438](https://github.com/Canner/WrenAI/issues/2438)) ([a38bfd7](https://github.com/Canner/WrenAI/commit/a38bfd7fb1deb7df675816cea97ebaec75890dd9))


### Bug Fixes

* **clickhouse:** sanitize brackets in connection-URL userinfo before parse ([#2454](https://github.com/Canner/WrenAI/issues/2454)) ([ef0a824](https://github.com/Canner/WrenAI/commit/ef0a824d3d39bc689d0aaec71949d4faf1228fcc))
* **clickhouse:** use unquote (not unquote_plus) for URL credentials; decode database ([#2436](https://github.com/Canner/WrenAI/issues/2436)) ([d9ba1a1](https://github.com/Canner/WrenAI/commit/d9ba1a13087b2438217623f3d6832189877cd401))
* **deps:** patch idna, cryptography, and pytest security advisories ([#2458](https://github.com/Canner/WrenAI/issues/2458)) ([8c72492](https://github.com/Canner/WrenAI/commit/8c724925aae679281e30a872469ecf20d85a854c))
* **mssql:** sanitize brackets in connection-URL userinfo before parse ([#2447](https://github.com/Canner/WrenAI/issues/2447)) ([5d94aaa](https://github.com/Canner/WrenAI/commit/5d94aaa4fbdfd64e626fbba14c9de55310563202))
* **oracle:** sanitize brackets in connection-URL userinfo before parse ([#2448](https://github.com/Canner/WrenAI/issues/2448)) ([89b1ec7](https://github.com/Canner/WrenAI/commit/89b1ec7f039451bffe4e384d9a4e9e5ff1a8c6d9))
* **oracle:** URL-decode credentials from connection_url ([#2434](https://github.com/Canner/WrenAI/issues/2434)) ([7db2651](https://github.com/Canner/WrenAI/commit/7db2651726efaeda4a38e05cae3a4c4b8a7b06ff))
* **sdk:** URL-decode ClickHouse connection-URL credentials and database ([#2444](https://github.com/Canner/WrenAI/issues/2444)) ([f178cfe](https://github.com/Canner/WrenAI/commit/f178cfefded33e3de60407f81940258ddb1ea1f0))
* **snowflake:** push LIMIT into SQL and strip trailing semicolon on wrap ([#2456](https://github.com/Canner/WrenAI/issues/2456)) ([4348f7a](https://github.com/Canner/WrenAI/commit/4348f7a0a91762e4e9386f845478ad9b29e45890))
* **trino:** URL-decode credentials and identifiers from connection URL ([#2435](https://github.com/Canner/WrenAI/issues/2435)) ([51ed348](https://github.com/Canner/WrenAI/commit/51ed34885e1946cd3f20d38e60c36c3add3e614a))
* **type-mapping:** fall back on sqlglot TokenError, not just ParseError ([#2433](https://github.com/Canner/WrenAI/issues/2433)) ([b7cecc7](https://github.com/Canner/WrenAI/commit/b7cecc77643b7c30a084802c9057a99c0aae26e8))

## [0.12.0](https://github.com/Canner/WrenAI/compare/wren-v0.11.0...wren-v0.12.0) (2026-07-06)


### Features

* **memory:** add 'wren memory watch' to auto-reindex on source changes ([#2418](https://github.com/Canner/WrenAI/issues/2418)) ([d5911c5](https://github.com/Canner/WrenAI/commit/d5911c5fb3352a8e7652d90db645b5d487084c37))
* **policy:** govern data-reading TVFs in all positions + structure source-func allowlist ([#2419](https://github.com/Canner/WrenAI/issues/2419)) ([5ff51e4](https://github.com/Canner/WrenAI/commit/5ff51e4a0f941761b3e12c9975b88c77e0e3d892))
* **wren:** add cross-dialect type translation to type_mapping ([#2410](https://github.com/Canner/WrenAI/issues/2410)) ([e124ff5](https://github.com/Canner/WrenAI/commit/e124ff538f512716a4d4779d495c6f4e38e3e072))


### Bug Fixes

* **athena:** strip trailing semicolon before EXPLAIN in dry_run ([#2421](https://github.com/Canner/WrenAI/issues/2421)) ([830dfbe](https://github.com/Canner/WrenAI/commit/830dfbeb7896e7321d63c799de73b71120d2d127))
* **athena:** treat DECIMAL(p) as scale 0, not a default non-zero scale ([#2403](https://github.com/Canner/WrenAI/issues/2403)) ([22d3125](https://github.com/Canner/WrenAI/commit/22d3125ced39c4e463ebff4d6c05bbeac1ea6209))
* **clickhouse:** default port-less clickhouse+https URLs to 8443, not 8123 ([#2412](https://github.com/Canner/WrenAI/issues/2412)) ([06a51a8](https://github.com/Canner/WrenAI/commit/06a51a81b002434365acacdf33d138599386df8f))
* **clickhouse:** reconcile default port when `secure` is toggled via kwargs or query params ([#2426](https://github.com/Canner/WrenAI/issues/2426)) ([f28b886](https://github.com/Canner/WrenAI/commit/f28b8867fc7f534668742a3d003a67342fecc170))
* **context:** preserve leading underscores in _snake_to_camel key conversion ([#2414](https://github.com/Canner/WrenAI/issues/2414)) ([0cf9fa3](https://github.com/Canner/WrenAI/commit/0cf9fa3ece85141ce5dcf51f0eba1908a6d547ce))
* **databricks:** strip trailing semicolon before subquery-wrapping in dry_run ([#2422](https://github.com/Canner/WrenAI/issues/2422)) ([35abf74](https://github.com/Canner/WrenAI/commit/35abf747873bc0e9097bd299438c6bb3b31e5d7b))
* **datafusion:** strip trailing semicolon before subquery-wrapping in query ([#2430](https://github.com/Canner/WrenAI/issues/2430)) ([8929764](https://github.com/Canner/WrenAI/commit/8929764310b51c2b59e4e67fbadd8ae41c1e2c3f))
* **duckdb:** case-insensitive .duckdb discovery, deterministic attach aliases, and single-statement SQL hardening ([#2411](https://github.com/Canner/WrenAI/issues/2411)) ([cfbd209](https://github.com/Canner/WrenAI/commit/cfbd209d906497d0f2c0b481ffba08c9756d991c))
* finish wren-engine → wrenai rename cleanup ([#2425](https://github.com/Canner/WrenAI/issues/2425)) ([0733d37](https://github.com/Canner/WrenAI/commit/0733d379e15f041235bd7ff7449ecc421834a7f4))
* **genbi:** normalise null apps/schema_version in app index ([#2406](https://github.com/Canner/WrenAI/issues/2406)) ([0c031d6](https://github.com/Canner/WrenAI/commit/0c031d60b0fdbb28925970622434721f3fd631db))
* **memory:** guard seed-query generation against null relationship models/condition ([#2424](https://github.com/Canner/WrenAI/issues/2424)) ([f96e978](https://github.com/Canner/WrenAI/commit/f96e9785cdc71655d7fbe5b6507f2f0b09720261))
* **oracle:** strip trailing semicolon before subquery-wrapping ([#2423](https://github.com/Canner/WrenAI/issues/2423)) ([fe92e5b](https://github.com/Canner/WrenAI/commit/fe92e5b2a2870f9b40c763507e3a90e4a584bbde))
* **osi:** skip empty expressions when picking a dialect expression ([#2413](https://github.com/Canner/WrenAI/issues/2413)) ([bcf78d1](https://github.com/Canner/WrenAI/commit/bcf78d19aa3dba61a79d633321f929f8a77ec740))
* **policy:** block table-valued functions reached via JOIN in strict mode ([#2405](https://github.com/Canner/WrenAI/issues/2405)) ([a2a37b3](https://github.com/Canner/WrenAI/commit/a2a37b39556f05e2aaa1a9550540cec1ed0a1aed))
* **postgres:** strip trailing semicolon before subquery-wrapping ([#2407](https://github.com/Canner/WrenAI/issues/2407)) ([3122f4f](https://github.com/Canner/WrenAI/commit/3122f4fbeda1175de21078296f7aaa4cf38b87cb))
* **redshift:** strip trailing semicolon before subquery-wrapping ([#2420](https://github.com/Canner/WrenAI/issues/2420)) ([a60a14a](https://github.com/Canner/WrenAI/commit/a60a14a868e47162943b9634c6121b449cfe4cf6))
* **trino:** treat DECIMAL(p) as scale 0, not a default non-zero scale ([#2404](https://github.com/Canner/WrenAI/issues/2404)) ([1be4baa](https://github.com/Canner/WrenAI/commit/1be4baaeba6f6a54febda73a5850bb47f25c6f40))

## [0.11.0](https://github.com/Canner/WrenAI/compare/wren-v0.10.1...wren-v0.11.0) (2026-06-26)


### Features

* **wren:** add v5 project layout (schema_version 5) ([#2386](https://github.com/Canner/WrenAI/issues/2386)) ([d50b9bc](https://github.com/Canner/WrenAI/commit/d50b9bcc58d4242e39b3d728c328b446e074997d))
* **wren:** case-aware column & model binding in the CTE rewriter ([#2400](https://github.com/Canner/WrenAI/issues/2400)) ([58f3f51](https://github.com/Canner/WrenAI/commit/58f3f5113ef2da7189541e4ad2b89182e6f86a48))
* **wren:** v5 project layout — knowledge/ first-class, memory decoupled from LanceDB ([#2399](https://github.com/Canner/WrenAI/issues/2399)) ([3e34906](https://github.com/Canner/WrenAI/commit/3e34906e4b690f454e0435e57fda8ec60a1b1595))


### Bug Fixes

* **wren:** run full unit suite in CI and fix upgrade tests for schema_version 5 ([#2388](https://github.com/Canner/WrenAI/issues/2388)) ([c36e56e](https://github.com/Canner/WrenAI/commit/c36e56ebd285c0c07444ce7deb900055fe7cf538))

## [0.10.1](https://github.com/Canner/WrenAI/compare/wren-v0.10.0...wren-v0.10.1) (2026-06-22)


### Bug Fixes

* disable transformers progress bar on Windows ([#2368](https://github.com/Canner/WrenAI/issues/2368)) ([f91529b](https://github.com/Canner/WrenAI/commit/f91529b62c6367440f0a6a87f894d3765663127f))

## [0.10.0](https://github.com/Canner/WrenAI/compare/wren-v0.9.0...wren-v0.10.0) (2026-06-18)


### Features

* **wren-core:** support composite (multi-column) primary keys ([#2345](https://github.com/Canner/WrenAI/issues/2345)) ([d33917f](https://github.com/Canner/WrenAI/commit/d33917f046f4ac0abddbbce9ce6c9c10b5adb10a))
* **wren:** GenBI app build & deploy — semantic layer → shareable web app ([#2348](https://github.com/Canner/WrenAI/issues/2348)) ([67257bf](https://github.com/Canner/WrenAI/commit/67257bf2a867df8271c52e0aa352e9b4c3ae155e))


### Bug Fixes

* ensure UTF-8 encoding for YAML file operations on Windows ([#2357](https://github.com/Canner/WrenAI/issues/2357)) ([322bd79](https://github.com/Canner/WrenAI/commit/322bd798da9e50945af6bc2132622b908073ce7c))
* **memory:** avoid identifier columns in aggregation seed queries ([#2358](https://github.com/Canner/WrenAI/issues/2358)) ([d5e7879](https://github.com/Canner/WrenAI/commit/d5e78790b95fe188e5e208cc7b794bdf550a44e8))
* **mysql:** handle brackets in connection URLs ([#2367](https://github.com/Canner/WrenAI/issues/2367)) ([8850abe](https://github.com/Canner/WrenAI/commit/8850abe74d9442062354953d06136dfc3823955a))
* **wren:** load cubes from folder-per-entity layout ([#2350](https://github.com/Canner/WrenAI/issues/2350)) ([6f2542e](https://github.com/Canner/WrenAI/commit/6f2542e117cd4d7b0631745cd400cbf3f5a948d7))


### Performance Improvements

* **cli:** use find_spec instead of eager import to detect memory extra ([#2352](https://github.com/Canner/WrenAI/issues/2352)) ([81d15fa](https://github.com/Canner/WrenAI/commit/81d15faa3cadc7c5bfeb716f1a241e16cac25c04))


### Documentation

* **wren:** document macOS memory first-run scan ([#2354](https://github.com/Canner/WrenAI/issues/2354)) ([40b1a97](https://github.com/Canner/WrenAI/commit/40b1a97caadd95dd5273519916c98578a210edda))
* **wren:** fix cube quickstart and align YAML/CLI examples with implementation ([#2359](https://github.com/Canner/WrenAI/issues/2359)) ([be69509](https://github.com/Canner/WrenAI/commit/be69509f06506ad89f299af1eaf9025a90ca50c6))

## [0.9.0](https://github.com/Canner/WrenAI/compare/wren-v0.8.1...wren-v0.9.0) (2026-06-04)


### Features

* **wren:** query MDL views in the SDK rewriter and strict mode ([#2334](https://github.com/Canner/WrenAI/issues/2334)) ([731c9c0](https://github.com/Canner/WrenAI/commit/731c9c0d92e665254afb2eff129f9e061a932fd2))
* **wren:** serve agent skills and reference docs from the CLI ([#2329](https://github.com/Canner/WrenAI/issues/2329)) ([cbd10cd](https://github.com/Canner/WrenAI/commit/cbd10cd0ae31876e9dc8a0d113c482b29b6f5ad2))


### Bug Fixes

* **wren:** support Databricks catalog ([#2340](https://github.com/Canner/WrenAI/issues/2340)) ([5e58ef6](https://github.com/Canner/WrenAI/commit/5e58ef633fe3e657f99e512a3fdd33b61d03dbdd))

## [0.8.1](https://github.com/Canner/WrenAI/compare/wren-v0.8.0...wren-v0.8.1) (2026-05-28)


### Dependencies

* clear 5 high-severity Dependabot alerts on main ([#2330](https://github.com/Canner/WrenAI/issues/2330)) ([cee71e6](https://github.com/Canner/WrenAI/commit/cee71e6444025599d0949b8761e9fdf23abf2c04))

## [0.8.0](https://github.com/Canner/WrenAI/compare/wren-v0.7.0...wren-v0.8.0) (2026-05-26)


### Features

* **wren:** add dbt import workflow ([#2279](https://github.com/Canner/WrenAI/issues/2279)) ([0bd16b8](https://github.com/Canner/WrenAI/commit/0bd16b8a95c7f599488177f9a56e232c17760e25))
* **wren:** build MDL manifests from OSI semantic models ([#2322](https://github.com/Canner/WrenAI/issues/2322)) ([983cf8b](https://github.com/Canner/WrenAI/commit/983cf8bff589b5028b611bcb1ef89834990f9517))


### Bug Fixes

* **wren:** honor SQL identifier case across policy, extract, and CTE rewriter ([#2310](https://github.com/Canner/WrenAI/issues/2310)) ([9b5fe22](https://github.com/Canner/WrenAI/commit/9b5fe22ee35209ec23ec3bd4fe2b04133407a8bc))

## [0.7.0](https://github.com/Canner/WrenAI/compare/wren-v0.6.0...wren-v0.7.0) (2026-05-22)


### ⚠ BREAKING CHANGES

* **wren:** rename PyPI package from wren-engine to wrenai ([#2315](https://github.com/Canner/WrenAI/issues/2315))

### Features

* **wasm:** full Cube support — validate, translate, PyO3, CLI, WASM, docs ([#2282](https://github.com/Canner/WrenAI/issues/2282)) ([026111e](https://github.com/Canner/WrenAI/commit/026111e54ec31e7165f9fd79c5c998070e66626c))


### Documentation

* **wren:** rebrand README to Wren AI and expand rename migration note ([#2316](https://github.com/Canner/WrenAI/issues/2316)) ([f3a00eb](https://github.com/Canner/WrenAI/commit/f3a00eb971a27186824954eff64b32f7e290db3c))


### Miscellaneous Chores

* **wren:** rename PyPI package from wren-engine to wrenai ([#2315](https://github.com/Canner/WrenAI/issues/2315)) ([20cffa9](https://github.com/Canner/WrenAI/commit/20cffa904f2d47c048c9247a77687b3fdfe24416))

## [0.6.0](https://github.com/Canner/WrenAI/compare/wren-v0.5.0...wren-v0.6.0) (2026-05-13)


### Features

* **context:** bind a connection profile to a project ([#2251](https://github.com/Canner/WrenAI/issues/2251)) ([41fbe41](https://github.com/Canner/WrenAI/commit/41fbe411fd1f1bb7a4080fbcedc7c886678276d1))

## [0.5.0](https://github.com/Canner/WrenAI/compare/wren-v0.4.0...wren-v0.5.0) (2026-05-05)


### Features

* **core:** import wren-engine into core/ ([cc9b67f](https://github.com/Canner/WrenAI/commit/cc9b67f593bf94c7418e0abb0ed46aa4a21613c3))
* **core:** import wren-engine into core/ ([#2209](https://github.com/Canner/WrenAI/issues/2209)) ([8b8a1a3](https://github.com/Canner/WrenAI/commit/8b8a1a3c5bf2a43d56ea1587782a0d5d853803b2))

## [0.4.0](https://github.com/Canner/wren-engine/compare/wren-v0.3.0...wren-v0.4.0) (2026-04-30)


### Features

* **wren:** .env-driven profile secrets, auto connection validation, and wren-install-guide skill ([#1588](https://github.com/Canner/wren-engine/issues/1588)) ([38ceaf1](https://github.com/Canner/wren-engine/commit/38ceaf1f73a91bf123e609aa6e402d5b971d3340))

## [0.3.0](https://github.com/Canner/wren-engine/compare/wren-v0.2.0...wren-v0.3.0) (2026-04-20)


### Features

* add MDL layout versioning and dialect field on Model and View ([#1556](https://github.com/Canner/wren-engine/issues/1556)) ([0384931](https://github.com/Canner/wren-engine/commit/03849312d5934c606c0e43d0bd41d091892b4454))
* add wren-core-wasm module with browser WASM support ([#1568](https://github.com/Canner/wren-engine/issues/1568)) ([4f9201b](https://github.com/Canner/wren-engine/commit/4f9201b7f98ce34fba9069b10da7a52b2c338b8b))
* **wren-core:** add refSql model support ([#1555](https://github.com/Canner/wren-engine/issues/1555)) ([bdaddf2](https://github.com/Canner/wren-engine/commit/bdaddf25bb9c10287b7f2062e727c26ac0e76303))
* **wren:** add `wren docs connection-info` CLI command ([#1507](https://github.com/Canner/wren-engine/issues/1507)) ([87efbfd](https://github.com/Canner/wren-engine/commit/87efbfdb91aece1c46999a3cc1bae72b77de778b))
* **wren:** add LanceDB-backed memory layer for schema and query retrieval ([#1494](https://github.com/Canner/wren-engine/issues/1494)) ([dfdff01](https://github.com/Canner/wren-engine/commit/dfdff010371f649abfa999b9fd08a729b81b15f2))
* **wren:** add memory list, forget, dump & load commands ([#1531](https://github.com/Canner/wren-engine/issues/1531)) ([de424e8](https://github.com/Canner/wren-engine/commit/de424e8b08d4125456895935e99dfd79ddd21f3f))
* **wren:** add profile management for named connection profiles ([#1509](https://github.com/Canner/wren-engine/issues/1509)) ([b086576](https://github.com/Canner/wren-engine/commit/b086576fbc0ead4ce46af915403a5c7268eac525))
* **wren:** add standalone wren Python SDK package ([#1471](https://github.com/Canner/wren-engine/issues/1471)) ([41f3f21](https://github.com/Canner/wren-engine/commit/41f3f21f97aba6418b087c1d6437183fdd30f2b3))
* **wren:** CLI 0.2.0 — context management, profiles, strict mode & memory ([#1522](https://github.com/Canner/wren-engine/issues/1522)) ([fbec650](https://github.com/Canner/wren-engine/commit/fbec650d4e44a62a3ed7fa3a943c74af83d63402))
* **wren:** CTE-based SQL planning with per-model expansion ([#1479](https://github.com/Canner/wren-engine/issues/1479)) ([fca2b11](https://github.com/Canner/wren-engine/commit/fca2b11bb4d2d45d883803f75605f0b84571188f))
* **wren:** extend standalone CLI with MySQL support and auto-discovery ([#1476](https://github.com/Canner/wren-engine/issues/1476)) ([6a78c12](https://github.com/Canner/wren-engine/commit/6a78c1210e0bd36e34984f85ae7e240a70b5ef0f))
* **wren:** generate AGENTS.md during `wren context init` ([#1526](https://github.com/Canner/wren-engine/issues/1526)) ([40bf46f](https://github.com/Canner/wren-engine/commit/40bf46f636d38f39f01fc005583d71c1679a2507))
* **wren:** preserve SELECT * in CTE rewriter ([#1536](https://github.com/Canner/wren-engine/issues/1536)) ([ed03388](https://github.com/Canner/wren-engine/commit/ed03388f7534a4f85b85a4fd3b6fc8a36179425e))


### Bug Fixes

* **oracle:** replace ibis[oracle] with native oracledb cursor connector ([#1495](https://github.com/Canner/wren-engine/issues/1495)) ([2e3c1de](https://github.com/Canner/wren-engine/commit/2e3c1def9645dcab3e0105bfa7053e740d162f83))
* **wren:** address CodeRabbit review feedback ([9c46f55](https://github.com/Canner/wren-engine/commit/9c46f554d0e25ce1000be11a496718289092e81d))
* **wren:** fix CLI 0.2.0 docs — description placement, install extras, CLI flags ([#1523](https://github.com/Canner/wren-engine/issues/1523)) ([536988e](https://github.com/Canner/wren-engine/commit/536988edeb1055620e0204f25243cbc70ee25f8a))
* **wren:** suppress model-loading noise and improve memory CLI error message ([#1529](https://github.com/Canner/wren-engine/issues/1529)) ([bd20444](https://github.com/Canner/wren-engine/commit/bd204445d81805e3b54cb9f441177f06c5e45eb8))


### Dependencies

* **wren:** bump transitive deps for security patches ([53c16c4](https://github.com/Canner/wren-engine/commit/53c16c4a36eb7dbe1bb467c4cb05b0b64b6ec902))
