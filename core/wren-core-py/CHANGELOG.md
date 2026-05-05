# Changelog

## [0.5.0](https://github.com/Canner/WrenAI/compare/wren-core-py-v0.4.0...wren-core-py-v0.5.0) (2026-05-05)


### Features

* add wren-core-wasm module with browser WASM support ([#1568](https://github.com/Canner/WrenAI/issues/1568)) ([5165a20](https://github.com/Canner/WrenAI/commit/5165a2099aeb7c9d7fef4ec78771e9efcb58db1c))
* **core:** import wren-engine into core/ ([cc9b67f](https://github.com/Canner/WrenAI/commit/cc9b67f593bf94c7418e0abb0ed46aa4a21613c3))
* **core:** import wren-engine into core/ ([#2209](https://github.com/Canner/WrenAI/issues/2209)) ([8b8a1a3](https://github.com/Canner/WrenAI/commit/8b8a1a3c5bf2a43d56ea1587782a0d5d853803b2))
* **wren-core-base:** replace Metric with Cube types and remove deprecated security types ([#1574](https://github.com/Canner/WrenAI/issues/1574)) ([72d18a8](https://github.com/Canner/WrenAI/commit/72d18a81bbc28a9833a07e19486de16cf59836d0))

## [0.4.0](https://github.com/Canner/wren-engine/compare/wren-core-py-v0.3.0...wren-core-py-v0.4.0) (2026-04-16)


### Features

* add MDL layout versioning and dialect field on Model and View ([#1556](https://github.com/Canner/wren-engine/issues/1556)) ([0384931](https://github.com/Canner/wren-engine/commit/03849312d5934c606c0e43d0bd41d091892b4454))

## [0.3.0](https://github.com/Canner/wren-engine/compare/wren-core-py-v0.2.0...wren-core-py-v0.3.0) (2026-04-16)


### Features

* **core:** add validation rule for the condition syntax check of row-level access controls ([#1176](https://github.com/Canner/wren-engine/issues/1176)) ([9465ec8](https://github.com/Canner/wren-engine/commit/9465ec8a8f2add91159fc34a7f9ee7180d89bb7f))
* **core:** apply default nulls last policy for ordering ([#1262](https://github.com/Canner/wren-engine/issues/1262)) ([df63b73](https://github.com/Canner/wren-engine/commit/df63b730ff7d02407164e1ac37538312906997f5))
* **core:** bump DataFusion to 49.0.1 ([#1293](https://github.com/Canner/wren-engine/issues/1293)) ([92a1c7d](https://github.com/Canner/wren-engine/commit/92a1c7db1809c5dbc06e742ae4f3a2326fa817a0))
* **core:** enhance the error message for CLAC failure ([#1250](https://github.com/Canner/wren-engine/issues/1250)) ([e5d0b7d](https://github.com/Canner/wren-engine/commit/e5d0b7d9e73df2f35348bcbaa527d0c23173b135))
* **core:** implement column-level access control for the model ([#1211](https://github.com/Canner/wren-engine/issues/1211)) ([01e541f](https://github.com/Canner/wren-engine/commit/01e541ffb09d331a1e6ae4baa68ffd7a5a77ecc8))
* **core:** implement the customize type coercion rule for unparsing purpose ([#1318](https://github.com/Canner/wren-engine/issues/1318)) ([592bc00](https://github.com/Canner/wren-engine/commit/592bc006cd67a9a06664d5da65cd655420f346c5))
* **core:** introduce dialect-specific function list and refactor BigQuery function lists ([#1366](https://github.com/Canner/wren-engine/issues/1366)) ([180af86](https://github.com/Canner/wren-engine/commit/180af8679be3c46f4a484c7ef342aca83c4b366b))
* **core:** introduce the row-level access control for the model ([#1161](https://github.com/Canner/wren-engine/issues/1161)) ([09ebdca](https://github.com/Canner/wren-engine/commit/09ebdca4f79bd2bb4ee9f7b87cc9cb88c73914e2))
* **core:** support UNNEST syntax for Snowflake ([#1357](https://github.com/Canner/wren-engine/issues/1357)) ([447885b](https://github.com/Canner/wren-engine/commit/447885b2c2de33f528d29639fc5bb593eca92777))
* **core:** upgrade DataFusion to 46.0.0 ([#1084](https://github.com/Canner/wren-engine/issues/1084)) ([e1453e4](https://github.com/Canner/wren-engine/commit/e1453e48c956a685c2942a9427808a0c9b5b7f5e))
* **ibis:** introduce the api to get the details of specfic function ([#1374](https://github.com/Canner/wren-engine/issues/1374)) ([7c05af5](https://github.com/Canner/wren-engine/commit/7c05af5469a6d47e80c205288aa27881fe3a4793))
* **ibis:** pushdown the limit of the query request into SQL ([#1082](https://github.com/Canner/wren-engine/issues/1082)) ([e7b3343](https://github.com/Canner/wren-engine/commit/e7b334302856e6e9d4b4829d123c8a1a4f725a7e))
* **mcp-server:** embed MCP server in Docker image with skills and quickstart guide ([#1425](https://github.com/Canner/wren-engine/issues/1425)) ([1c33247](https://github.com/Canner/wren-engine/commit/1c3324790de03da05cc1c9b9683a894bac4c615b))
* **wren-core:** add refSql model support ([#1555](https://github.com/Canner/wren-engine/issues/1555)) ([bdaddf2](https://github.com/Canner/wren-engine/commit/bdaddf25bb9c10287b7f2062e727c26ac0e76303))


### Bug Fixes

* **ci:** disable Linux aarch64 wheel build temporarily ([#1503](https://github.com/Canner/wren-engine/issues/1503)) ([442feab](https://github.com/Canner/wren-engine/commit/442feab592064fe08de0e79c47fba7e4aa603242))
* **ci:** include README.md in wren-core-py Docker build context ([#1498](https://github.com/Canner/wren-engine/issues/1498)) ([a524a75](https://github.com/Canner/wren-engine/commit/a524a75da7ad0d87e6db8886bf67a225fd7b65d7))
* **core-py:** avoid to generate duplicate models after extracting manifest ([#1244](https://github.com/Canner/wren-engine/issues/1244)) ([eb4ff3f](https://github.com/Canner/wren-engine/commit/eb4ff3f1269f120055ea54ea96f9f209488fbc1e))
* **core-py:** extract the used tables using the case-sensitive table name ([#1320](https://github.com/Canner/wren-engine/issues/1320)) ([9524684](https://github.com/Canner/wren-engine/commit/9524684fa3b8cd43c85f262d5d3bf199cbde28c1))
* **core:** disable `ReplaceDistinctWithAggregate` rule ([#1294](https://github.com/Canner/wren-engine/issues/1294)) ([bdd52c2](https://github.com/Canner/wren-engine/commit/bdd52c2aa8545181fa450a9f57872c54561029e1))
* **core:** disable eliminating sort in subquery ([#1206](https://github.com/Canner/wren-engine/issues/1206)) ([de73780](https://github.com/Canner/wren-engine/commit/de73780b4bd440d328b324e3070c47ab3cb2555f))
* **core:** expand the wildcard before Wren rewrite rules ([#1145](https://github.com/Canner/wren-engine/issues/1145)) ([d5d8ae2](https://github.com/Canner/wren-engine/commit/d5d8ae2af3bbe4bc459626bfe18c8778ab19066c))
* **core:** fix access controls case-insensitive issue and disable fallback for the query with access control ([#1295](https://github.com/Canner/wren-engine/issues/1295)) ([f04cee7](https://github.com/Canner/wren-engine/commit/f04cee78fc694e4076d0980e77d4f7cff206f97e))
* **core:** fix current_timestamp function and add datetime function for bigquery ([#1298](https://github.com/Canner/wren-engine/issues/1298)) ([f1347e3](https://github.com/Canner/wren-engine/commit/f1347e3082a4b5e81ffe687dc5b9e309a81fe722))
* **core:** fix RLAC for model with an alias ([#1245](https://github.com/Canner/wren-engine/issues/1245)) ([d58efb2](https://github.com/Canner/wren-engine/commit/d58efb2e15796b28c31276579aed62345eb943b6))
* **core:** fix the CLAC and scope analyze issues ([#1304](https://github.com/Canner/wren-engine/issues/1304)) ([be270c4](https://github.com/Canner/wren-engine/commit/be270c484cec761e57e21784435054d8f69a0777))
* **core:** fix the required session properties for CLAC ([#1287](https://github.com/Canner/wren-engine/issues/1287)) ([388a91a](https://github.com/Canner/wren-engine/commit/388a91a0c6fb2eeff919e4fffe5a3fd61eb8949e))
* **core:** fix the uppercase table name of the model tableReference ([#1173](https://github.com/Canner/wren-engine/issues/1173)) ([55309d0](https://github.com/Canner/wren-engine/commit/55309d020b331555a66539cb70140f2f74ce2743))
* **core:** introduce `DATE_DIFF` function ([#1303](https://github.com/Canner/wren-engine/issues/1303)) ([d560ac3](https://github.com/Canner/wren-engine/commit/d560ac3fabe709d4e47de17d5154a5aaa9c99b34))
* **core:** simplify the available function lists ([#1131](https://github.com/Canner/wren-engine/issues/1131)) ([8602b8b](https://github.com/Canner/wren-engine/commit/8602b8b9c7c47d3d1dff77f982a45a703152f66c))
* **core:** support the Unicode literal for MSSQL ([#1338](https://github.com/Canner/wren-engine/issues/1338)) ([e6fb38d](https://github.com/Canner/wren-engine/commit/e6fb38d6d5715a3bdcbdf84c8b68b47089832e83))
* **ibis:** refactor the available function list ([#1112](https://github.com/Canner/wren-engine/issues/1112)) ([52f9163](https://github.com/Canner/wren-engine/commit/52f9163014542dc30c464f69b75feb64bbe62eba))
* implement ClickHouse dialect and enhance temporal function mapping ([#1424](https://github.com/Canner/wren-engine/issues/1424)) ([1f647cf](https://github.com/Canner/wren-engine/commit/1f647cf824aab4022b7354c01e4090a781c947ac))


### Dependencies

* **core-py:** bump bytes from 1.10.1 to 1.11.1 in /wren-core-py ([55796da](https://github.com/Canner/wren-engine/commit/55796da6ea667bc194bce1a7f6666ba184ae2070))
* **core-py:** bump cryptography from 0.3.44 to 0.3.47 in /wren-core-py ([4cd88dd](https://github.com/Canner/wren-engine/commit/4cd88dd3a3dd64670c4950a49f1e8e02a611c144))
* **core-py:** bump ruff from 0.11.2 to 0.11.4 in /wren-core-py in the all group ([#1134](https://github.com/Canner/wren-engine/issues/1134)) ([06def9d](https://github.com/Canner/wren-engine/commit/06def9d02c1f6e5904ac2e8e3232c90ec27a1a4c))
* **core-py:** bump ruff from 0.11.7 to 0.11.8 in /wren-core-py in the all group ([#1185](https://github.com/Canner/wren-engine/issues/1185)) ([e1cbd03](https://github.com/Canner/wren-engine/commit/e1cbd031d8f2ad1d3979751dfd949e0772802b36))
* **core-py:** bump ruff from 0.12.12 to 0.13.0 in /wren-core-py in the all group ([#1321](https://github.com/Canner/wren-engine/issues/1321)) ([2b0348c](https://github.com/Canner/wren-engine/commit/2b0348c4ab0e53ca9d0a2ac4d7b514e416897e75))
* **core-py:** bump ruff from 0.9.6 to 0.9.7 in /wren-core-py in the all group ([#1069](https://github.com/Canner/wren-engine/issues/1069)) ([c4147c9](https://github.com/Canner/wren-engine/commit/c4147c93e567f79c21894d7a29321c7ad36852a1))
* **core-py:** bump the all group across 1 directory with 2 updates ([#1050](https://github.com/Canner/wren-engine/issues/1050)) ([7fd7ba8](https://github.com/Canner/wren-engine/commit/7fd7ba83bd1c4a953cbd3d47624944cd53b48911))
* **core-py:** bump the all group across 1 directory with 3 updates ([#1313](https://github.com/Canner/wren-engine/issues/1313)) ([183875b](https://github.com/Canner/wren-engine/commit/183875b027961cae8c8e292e2e08617624a09a0c))
* **core-py:** bump the all group in /wren-core-py with 2 updates ([#1058](https://github.com/Canner/wren-engine/issues/1058)) ([d9fcd2a](https://github.com/Canner/wren-engine/commit/d9fcd2aa06d7bb026c01d4c34a2542b9a9f5583a))
* **core-py:** bump the all group in /wren-core-py with 2 updates ([#1078](https://github.com/Canner/wren-engine/issues/1078)) ([8db5987](https://github.com/Canner/wren-engine/commit/8db5987468bbd721e35c4602daa163da610fed24))
* **core-py:** bump the all group in /wren-core-py with 2 updates ([#1095](https://github.com/Canner/wren-engine/issues/1095)) ([e55e8f5](https://github.com/Canner/wren-engine/commit/e55e8f5f5573ac7979aca2a0c7aa2d38370f311e))
* **core-py:** bump the all group in /wren-core-py with 2 updates ([#1194](https://github.com/Canner/wren-engine/issues/1194)) ([63b985b](https://github.com/Canner/wren-engine/commit/63b985b243d1d5f84856fa9f7c0a93ec4869d64b))
* **core-py:** bump the all group in /wren-core-py with 2 updates ([#1210](https://github.com/Canner/wren-engine/issues/1210)) ([856a9ff](https://github.com/Canner/wren-engine/commit/856a9ffbea75d3b450978620d338a1750851efcf))
* **core-py:** bump the all group in /wren-core-py with 2 updates ([#1217](https://github.com/Canner/wren-engine/issues/1217)) ([5be8b95](https://github.com/Canner/wren-engine/commit/5be8b95a496fadc3450ce4f3d5acafab45d386c4))
* **core-py:** bump the all group in /wren-core-py with 3 updates ([#1233](https://github.com/Canner/wren-engine/issues/1233)) ([16f19b0](https://github.com/Canner/wren-engine/commit/16f19b0bac36ee4b7bdd5ac69cc06848e774330e))
* **core:** bump the all group across 1 directory with 2 updates ([#1310](https://github.com/Canner/wren-engine/issues/1310)) ([49ba598](https://github.com/Canner/wren-engine/commit/49ba5982d43f5a6d18547296e51f9c4421c259fe))
* **core:** bump the all group across 1 directory with 3 updates ([#1046](https://github.com/Canner/wren-engine/issues/1046)) ([10d8038](https://github.com/Canner/wren-engine/commit/10d803857842fb47761ae8e43e33fce3521cff99))
* **core:** bump the all group across 1 directory with 4 updates ([#1307](https://github.com/Canner/wren-engine/issues/1307)) ([1180709](https://github.com/Canner/wren-engine/commit/118070967f4c399db335962968d2602413edb045))
* **core:** upgrade to datafusion 0.46.1 ([#1124](https://github.com/Canner/wren-engine/issues/1124)) ([a70c850](https://github.com/Canner/wren-engine/commit/a70c8502e190fe19bf8dd8950f270d973d130be8))
* **wren-core-py:** bump lz4_flex 0.11.5 -&gt; 0.11.6 for security patch ([7f90ed6](https://github.com/Canner/wren-engine/commit/7f90ed6cba251059d91b5bcb72f3c5d62adc3fe6))


### Documentation

* add per-module .claude/CLAUDE.md and redirect AGENTS.md ([#1466](https://github.com/Canner/wren-engine/issues/1466)) ([12bdc4f](https://github.com/Canner/wren-engine/commit/12bdc4fe9f1b52d41468836e8bb8f11c3e8611d6))

## [0.2.0](https://github.com/Canner/wren-engine/compare/wren-core-py-v0.1.0...wren-core-py-v0.2.0) (2026-04-16)


### Features

* **core:** add validation rule for the condition syntax check of row-level access controls ([#1176](https://github.com/Canner/wren-engine/issues/1176)) ([9465ec8](https://github.com/Canner/wren-engine/commit/9465ec8a8f2add91159fc34a7f9ee7180d89bb7f))
* **core:** apply default nulls last policy for ordering ([#1262](https://github.com/Canner/wren-engine/issues/1262)) ([df63b73](https://github.com/Canner/wren-engine/commit/df63b730ff7d02407164e1ac37538312906997f5))
* **core:** bump DataFusion to 49.0.1 ([#1293](https://github.com/Canner/wren-engine/issues/1293)) ([92a1c7d](https://github.com/Canner/wren-engine/commit/92a1c7db1809c5dbc06e742ae4f3a2326fa817a0))
* **core:** enhance the error message for CLAC failure ([#1250](https://github.com/Canner/wren-engine/issues/1250)) ([e5d0b7d](https://github.com/Canner/wren-engine/commit/e5d0b7d9e73df2f35348bcbaa527d0c23173b135))
* **core:** implement column-level access control for the model ([#1211](https://github.com/Canner/wren-engine/issues/1211)) ([01e541f](https://github.com/Canner/wren-engine/commit/01e541ffb09d331a1e6ae4baa68ffd7a5a77ecc8))
* **core:** implement the customize type coercion rule for unparsing purpose ([#1318](https://github.com/Canner/wren-engine/issues/1318)) ([592bc00](https://github.com/Canner/wren-engine/commit/592bc006cd67a9a06664d5da65cd655420f346c5))
* **core:** introduce dialect-specific function list and refactor BigQuery function lists ([#1366](https://github.com/Canner/wren-engine/issues/1366)) ([180af86](https://github.com/Canner/wren-engine/commit/180af8679be3c46f4a484c7ef342aca83c4b366b))
* **core:** introduce the row-level access control for the model ([#1161](https://github.com/Canner/wren-engine/issues/1161)) ([09ebdca](https://github.com/Canner/wren-engine/commit/09ebdca4f79bd2bb4ee9f7b87cc9cb88c73914e2))
* **core:** support UNNEST syntax for Snowflake ([#1357](https://github.com/Canner/wren-engine/issues/1357)) ([447885b](https://github.com/Canner/wren-engine/commit/447885b2c2de33f528d29639fc5bb593eca92777))
* **core:** upgrade DataFusion to 46.0.0 ([#1084](https://github.com/Canner/wren-engine/issues/1084)) ([e1453e4](https://github.com/Canner/wren-engine/commit/e1453e48c956a685c2942a9427808a0c9b5b7f5e))
* **ibis:** introduce the api to get the details of specfic function ([#1374](https://github.com/Canner/wren-engine/issues/1374)) ([7c05af5](https://github.com/Canner/wren-engine/commit/7c05af5469a6d47e80c205288aa27881fe3a4793))
* **ibis:** pushdown the limit of the query request into SQL ([#1082](https://github.com/Canner/wren-engine/issues/1082)) ([e7b3343](https://github.com/Canner/wren-engine/commit/e7b334302856e6e9d4b4829d123c8a1a4f725a7e))
* **mcp-server:** embed MCP server in Docker image with skills and quickstart guide ([#1425](https://github.com/Canner/wren-engine/issues/1425)) ([1c33247](https://github.com/Canner/wren-engine/commit/1c3324790de03da05cc1c9b9683a894bac4c615b))
* **wren-core:** add refSql model support ([#1555](https://github.com/Canner/wren-engine/issues/1555)) ([bdaddf2](https://github.com/Canner/wren-engine/commit/bdaddf25bb9c10287b7f2062e727c26ac0e76303))


### Bug Fixes

* **ci:** disable Linux aarch64 wheel build temporarily ([#1503](https://github.com/Canner/wren-engine/issues/1503)) ([442feab](https://github.com/Canner/wren-engine/commit/442feab592064fe08de0e79c47fba7e4aa603242))
* **ci:** include README.md in wren-core-py Docker build context ([#1498](https://github.com/Canner/wren-engine/issues/1498)) ([a524a75](https://github.com/Canner/wren-engine/commit/a524a75da7ad0d87e6db8886bf67a225fd7b65d7))
* **core-py:** avoid to generate duplicate models after extracting manifest ([#1244](https://github.com/Canner/wren-engine/issues/1244)) ([eb4ff3f](https://github.com/Canner/wren-engine/commit/eb4ff3f1269f120055ea54ea96f9f209488fbc1e))
* **core-py:** extract the used tables using the case-sensitive table name ([#1320](https://github.com/Canner/wren-engine/issues/1320)) ([9524684](https://github.com/Canner/wren-engine/commit/9524684fa3b8cd43c85f262d5d3bf199cbde28c1))
* **core:** disable `ReplaceDistinctWithAggregate` rule ([#1294](https://github.com/Canner/wren-engine/issues/1294)) ([bdd52c2](https://github.com/Canner/wren-engine/commit/bdd52c2aa8545181fa450a9f57872c54561029e1))
* **core:** disable eliminating sort in subquery ([#1206](https://github.com/Canner/wren-engine/issues/1206)) ([de73780](https://github.com/Canner/wren-engine/commit/de73780b4bd440d328b324e3070c47ab3cb2555f))
* **core:** expand the wildcard before Wren rewrite rules ([#1145](https://github.com/Canner/wren-engine/issues/1145)) ([d5d8ae2](https://github.com/Canner/wren-engine/commit/d5d8ae2af3bbe4bc459626bfe18c8778ab19066c))
* **core:** fix access controls case-insensitive issue and disable fallback for the query with access control ([#1295](https://github.com/Canner/wren-engine/issues/1295)) ([f04cee7](https://github.com/Canner/wren-engine/commit/f04cee78fc694e4076d0980e77d4f7cff206f97e))
* **core:** fix current_timestamp function and add datetime function for bigquery ([#1298](https://github.com/Canner/wren-engine/issues/1298)) ([f1347e3](https://github.com/Canner/wren-engine/commit/f1347e3082a4b5e81ffe687dc5b9e309a81fe722))
* **core:** fix RLAC for model with an alias ([#1245](https://github.com/Canner/wren-engine/issues/1245)) ([d58efb2](https://github.com/Canner/wren-engine/commit/d58efb2e15796b28c31276579aed62345eb943b6))
* **core:** fix the CLAC and scope analyze issues ([#1304](https://github.com/Canner/wren-engine/issues/1304)) ([be270c4](https://github.com/Canner/wren-engine/commit/be270c484cec761e57e21784435054d8f69a0777))
* **core:** fix the required session properties for CLAC ([#1287](https://github.com/Canner/wren-engine/issues/1287)) ([388a91a](https://github.com/Canner/wren-engine/commit/388a91a0c6fb2eeff919e4fffe5a3fd61eb8949e))
* **core:** fix the uppercase table name of the model tableReference ([#1173](https://github.com/Canner/wren-engine/issues/1173)) ([55309d0](https://github.com/Canner/wren-engine/commit/55309d020b331555a66539cb70140f2f74ce2743))
* **core:** introduce `DATE_DIFF` function ([#1303](https://github.com/Canner/wren-engine/issues/1303)) ([d560ac3](https://github.com/Canner/wren-engine/commit/d560ac3fabe709d4e47de17d5154a5aaa9c99b34))
* **core:** simplify the available function lists ([#1131](https://github.com/Canner/wren-engine/issues/1131)) ([8602b8b](https://github.com/Canner/wren-engine/commit/8602b8b9c7c47d3d1dff77f982a45a703152f66c))
* **core:** support the Unicode literal for MSSQL ([#1338](https://github.com/Canner/wren-engine/issues/1338)) ([e6fb38d](https://github.com/Canner/wren-engine/commit/e6fb38d6d5715a3bdcbdf84c8b68b47089832e83))
* **ibis:** refactor the available function list ([#1112](https://github.com/Canner/wren-engine/issues/1112)) ([52f9163](https://github.com/Canner/wren-engine/commit/52f9163014542dc30c464f69b75feb64bbe62eba))
* implement ClickHouse dialect and enhance temporal function mapping ([#1424](https://github.com/Canner/wren-engine/issues/1424)) ([1f647cf](https://github.com/Canner/wren-engine/commit/1f647cf824aab4022b7354c01e4090a781c947ac))


### Dependencies

* **core-py:** bump bytes from 1.10.1 to 1.11.1 in /wren-core-py ([55796da](https://github.com/Canner/wren-engine/commit/55796da6ea667bc194bce1a7f6666ba184ae2070))
* **core-py:** bump cryptography from 0.3.44 to 0.3.47 in /wren-core-py ([4cd88dd](https://github.com/Canner/wren-engine/commit/4cd88dd3a3dd64670c4950a49f1e8e02a611c144))
* **core-py:** bump ruff from 0.11.2 to 0.11.4 in /wren-core-py in the all group ([#1134](https://github.com/Canner/wren-engine/issues/1134)) ([06def9d](https://github.com/Canner/wren-engine/commit/06def9d02c1f6e5904ac2e8e3232c90ec27a1a4c))
* **core-py:** bump ruff from 0.11.7 to 0.11.8 in /wren-core-py in the all group ([#1185](https://github.com/Canner/wren-engine/issues/1185)) ([e1cbd03](https://github.com/Canner/wren-engine/commit/e1cbd031d8f2ad1d3979751dfd949e0772802b36))
* **core-py:** bump ruff from 0.12.12 to 0.13.0 in /wren-core-py in the all group ([#1321](https://github.com/Canner/wren-engine/issues/1321)) ([2b0348c](https://github.com/Canner/wren-engine/commit/2b0348c4ab0e53ca9d0a2ac4d7b514e416897e75))
* **core-py:** bump ruff from 0.9.6 to 0.9.7 in /wren-core-py in the all group ([#1069](https://github.com/Canner/wren-engine/issues/1069)) ([c4147c9](https://github.com/Canner/wren-engine/commit/c4147c93e567f79c21894d7a29321c7ad36852a1))
* **core-py:** bump the all group across 1 directory with 2 updates ([#1050](https://github.com/Canner/wren-engine/issues/1050)) ([7fd7ba8](https://github.com/Canner/wren-engine/commit/7fd7ba83bd1c4a953cbd3d47624944cd53b48911))
* **core-py:** bump the all group across 1 directory with 3 updates ([#1313](https://github.com/Canner/wren-engine/issues/1313)) ([183875b](https://github.com/Canner/wren-engine/commit/183875b027961cae8c8e292e2e08617624a09a0c))
* **core-py:** bump the all group in /wren-core-py with 2 updates ([#1058](https://github.com/Canner/wren-engine/issues/1058)) ([d9fcd2a](https://github.com/Canner/wren-engine/commit/d9fcd2aa06d7bb026c01d4c34a2542b9a9f5583a))
* **core-py:** bump the all group in /wren-core-py with 2 updates ([#1078](https://github.com/Canner/wren-engine/issues/1078)) ([8db5987](https://github.com/Canner/wren-engine/commit/8db5987468bbd721e35c4602daa163da610fed24))
* **core-py:** bump the all group in /wren-core-py with 2 updates ([#1095](https://github.com/Canner/wren-engine/issues/1095)) ([e55e8f5](https://github.com/Canner/wren-engine/commit/e55e8f5f5573ac7979aca2a0c7aa2d38370f311e))
* **core-py:** bump the all group in /wren-core-py with 2 updates ([#1194](https://github.com/Canner/wren-engine/issues/1194)) ([63b985b](https://github.com/Canner/wren-engine/commit/63b985b243d1d5f84856fa9f7c0a93ec4869d64b))
* **core-py:** bump the all group in /wren-core-py with 2 updates ([#1210](https://github.com/Canner/wren-engine/issues/1210)) ([856a9ff](https://github.com/Canner/wren-engine/commit/856a9ffbea75d3b450978620d338a1750851efcf))
* **core-py:** bump the all group in /wren-core-py with 2 updates ([#1217](https://github.com/Canner/wren-engine/issues/1217)) ([5be8b95](https://github.com/Canner/wren-engine/commit/5be8b95a496fadc3450ce4f3d5acafab45d386c4))
* **core-py:** bump the all group in /wren-core-py with 3 updates ([#1233](https://github.com/Canner/wren-engine/issues/1233)) ([16f19b0](https://github.com/Canner/wren-engine/commit/16f19b0bac36ee4b7bdd5ac69cc06848e774330e))
* **core:** bump the all group across 1 directory with 2 updates ([#1310](https://github.com/Canner/wren-engine/issues/1310)) ([49ba598](https://github.com/Canner/wren-engine/commit/49ba5982d43f5a6d18547296e51f9c4421c259fe))
* **core:** bump the all group across 1 directory with 3 updates ([#1046](https://github.com/Canner/wren-engine/issues/1046)) ([10d8038](https://github.com/Canner/wren-engine/commit/10d803857842fb47761ae8e43e33fce3521cff99))
* **core:** bump the all group across 1 directory with 4 updates ([#1307](https://github.com/Canner/wren-engine/issues/1307)) ([1180709](https://github.com/Canner/wren-engine/commit/118070967f4c399db335962968d2602413edb045))
* **core:** upgrade to datafusion 0.46.1 ([#1124](https://github.com/Canner/wren-engine/issues/1124)) ([a70c850](https://github.com/Canner/wren-engine/commit/a70c8502e190fe19bf8dd8950f270d973d130be8))
* **wren-core-py:** bump lz4_flex 0.11.5 -&gt; 0.11.6 for security patch ([7f90ed6](https://github.com/Canner/wren-engine/commit/7f90ed6cba251059d91b5bcb72f3c5d62adc3fe6))


### Documentation

* add per-module .claude/CLAUDE.md and redirect AGENTS.md ([#1466](https://github.com/Canner/wren-engine/issues/1466)) ([12bdc4f](https://github.com/Canner/wren-engine/commit/12bdc4fe9f1b52d41468836e8bb8f11c3e8611d6))
