# Changelog

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
