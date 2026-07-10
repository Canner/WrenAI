# Changelog

This file tracks repository-level changes (layout, licensing, governance). Per-package release notes live in each package's own `CHANGELOG.md` (e.g. `core/wren/CHANGELOG.md`, `core/wren-core-py/CHANGELOG.md`) and are managed by release-please.

## 2026-Q2 — Repo consolidation

- **Imported** [`Canner/wren-engine`](https://github.com/Canner/wren-engine) into [`core/`](./core) via `git filter-repo` rewrite, preserving authorship and PR history (~5,300 commits across `core/wren-core`, `core/wren-core-base`, `core/wren-core-py`, `core/wren-core-wasm`, `core/wren`).
- **Relocated** the existing `wren-mdl/` schema to `core/wren-mdl/`.
- **Archived** the legacy WrenAI GenBI app (`wren-ai-service`, `wren-ui`, `wren-launcher`, `docker`, `deployment`) on the [`legacy/v1`](https://github.com/Canner/WrenAI/tree/legacy/v1) branch (tag `v1-final`).
- **Adopted** a multi-license layout (Apache 2.0 for code/skills/SDKs/examples; CC BY 4.0 for docs; AGPL 3.0 reserved for future modules). See [LICENSE](./LICENSE).
- **Added** root metadata: `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, this `CHANGELOG.md`.
