# Changelog

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
