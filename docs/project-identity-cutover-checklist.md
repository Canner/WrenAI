# Project identity compatibility cutover checklist (2026-04-09)

> Generated from `misc/project-identity-compatibility-boundaries.tsv`.
> Refresh with: `bash misc/scripts/project-identity-cutover-checklist.sh > docs/project-identity-cutover-checklist.md`

## Current cutover baseline

- Safe, non-breaking cleanup is complete; the remaining work is **breaking-change cutover**.
- Remaining compatibility-boundary files: **0**
- Remaining implementation exact-match hits for legacy bridge aliases: **0**
- Repo-wide baseline commands:
  - `bash misc/scripts/scan-runtime-identity.sh`
  - `bash misc/scripts/inventory-project-identity.sh`

## Recommended cutover order

- None. Compatibility boundary cutover is complete.

## Boundary checklist
## Execution notes

- Treat each boundary as an explicit breaking-change step; do not batch all four removals blindly.
- Refresh this checklist immediately before starting a cutover wave so the exact-match lines stay current.
- If any wave fails verification, roll back that boundary before moving to the next one.
