# WrenAI Ask Schema Grounding Handoff

Date: 2026-08-20

## Current Goal

Make WrenAI Ask schema-driven for the active org/project. User wording may search and rank verified metadata, but final SQL must use only verified tables, columns, relationships, metrics, and supported values from the selected project's retrieved schema.

Do not fix future issues with exact prompt handling, project-specific branches, table/column mappings, or static business synonym/value lists.

## Branch / PR

- Repository: `hbalasubramanya-rgb/WrenAI`
- Branch: `organization/ask-schema-grounding-20260820`
- PR: `https://github.com/hbalasubramanya-rgb/WrenAI/pull/1`
- Previous pushed commit before this handoff update: `4a040c817` (`Improve ticket status grounding`)
- Current worktree: `D:\WrenAI-ask-e2e-fix-20260820`

The worktree is detached at the branch tip because the local branch is checked out in another worktree. Commit from this detached worktree and push with:

```powershell
git push origin HEAD:organization/ask-schema-grounding-20260820
```

Do not stage the unrelated mode-only change in `wren-ui/.yarn/releases/yarn-4.5.3.cjs`.

## What Changed Today

### Static Business Maps Removed

Files:

- `wren-ai-service/src/pipelines/generation/utils/sql.py`
- `wren-ai-service/src/pipelines/retrieval/db_schema_retrieval.py`

Removed static business-token and value logic, including:

- `_STATUS_VALUE_ALIASES`
- `_PRIORITY_VALUE_ALIASES`
- `_PRIORITY_ORDER`
- `_requested_business_concepts`
- `_expanded_fallback_query_tokens`
- `_expand_fallback_token_aliases`
- retrieval `concept_terms`
- domain-specific table boosts/deboosts for example business words

Production scans now return no matches for those removed helpers/maps or for the audited domain strings in the two Ask grounding files.

### Schema-Derived Grounding

Added generic schema-token extraction and matching from:

- table names
- column names
- table/column semantic descriptions
- relationship/identifier context already present in retrieved schema text
- enum/sample values when supplied in Wren semantic context

The deterministic fallback is now schema-shape based. It can produce conservative SQL for generic shapes such as:

- grouped counts
- averages over verified numeric measures
- sums over verified numeric measures
- top-N grouped counts
- latest/recent listings over verified temporal fields
- month/year buckets over verified temporal fields
- ordering by verified requested columns
- filters only when values are supported by sample/enum metadata

It no longer contains domain branches for specific business words or values.

### Validation Tightened

`validate_sql_semantic_coverage` now rejects SQL when:

- non-operational query terms are not represented anywhere in active project schema metadata/sample values
- generated SQL uses a verified table but not one covering all schema-backed query tokens
- an average request is answered with count-only SQL
- a distribution/breakdown request is not grouped with counts
- a string literal filter on a sampled column uses a value not present in verified samples

`unsupported_schema_message` now reports partial coverage instead of returning `None` just because some query terms matched schema.

### Retrieval Cleanup

Retrieval query augmentation is now a no-op. Ranking uses only direct overlap between query tokens and retrieved schema metadata. The table-selection prompt was changed to instruct schema-local reasoning without domain examples or built-in synonym lists.

### Tests Updated

Files:

- `wren-ai-service/tests/pytest/pipelines/generation/test_sql_schema_grounding.py`
- `wren-ai-service/tests/pytest/pipelines/retrieval/test_db_schema_retrieval.py`

The generation test module now verifies generic behavior rather than PCB/Orders-specific examples:

- identifier validation
- unsupported partial schema coverage
- sample-value filters
- unverified values rejected
- grouped counts
- averages vs counts
- latest by temporal column
- monthly counts
- explicit order by
- top grouped count
- sum by year
- literal sample validation

The retrieval test now verifies no query expansion and schema-metadata ranking.

## Validation Run

Commands run from `D:\WrenAI-ask-e2e-fix-20260820`:

```powershell
python -m py_compile wren-ai-service/src/pipelines/generation/utils/sql.py wren-ai-service/src/pipelines/retrieval/db_schema_retrieval.py wren-ai-service/tests/pytest/pipelines/generation/test_sql_schema_grounding.py wren-ai-service/tests/pytest/pipelines/retrieval/test_db_schema_retrieval.py
git diff --check
```

Manual local harness:

- generation grounding tests: `ran=21 failures=0`
- retrieval touched logic: `ran=2 failures=0`
- randomized schema-derived validation: `ran=10 failures=0`

`python -m pytest` was not available in the local venv because `pytest` is not installed.

Randomized validation used synthetic selected-project schemas and shuffled questions covering:

- grouped count
- average
- latest/recent
- sample-value filter with explicit ordering
- monthly count
- sum by year
- top-N grouped count
- sum by dimension
- unsupported unknown dimension

## Remaining Blockers

- Live local `D:\WrenAI` was refreshed with the branch source because the running app was still using older code.
- Fixed a generic word-form coverage bug where `repairs` did not ground to verified schema token `repair`.
- Fixed SQL table-reference validation so `EXTRACT(YEAR FROM "updated_at")` is not misread as a table reference.
- Changed generated date buckets to `CAST(EXTRACT(... ) AS BIGINT)` because uncast `EXTRACT` passed generation validation but failed live preview result conversion.
- Added schema-derived user-value filtering for the case where exactly one verified categorical column is explicitly mentioned. Values are escaped and attached only to that verified column; identifier columns such as `ticket_id`, `repair_id`, and `org_id` are excluded.
- Tightened dimension selection so identifier columns are not used as grouping dimensions unless an identifier grouping is explicitly requested.
- Live API validation on `org / PCB_DB` now passes:
  - `show number of repairs updated each month` -> `dbo_repair_logs.updated_at`, monthly `COUNT(*)`, successful summary.
  - `Show repairs by status.` -> `dbo_repair_logs.status`, grouped count, successful summary.
  - `Show latest repair logs.` -> `dbo_repair_logs`, date ordering, successful summary.
  - `Show the distribution of repairs across completed and in-progress statuses.` -> `dbo_repair_logs.status`, filtered grouped count, successful summary.
  - `Show customer revenue by year.` while PCB_DB is selected -> clear `NO_RELEVANT_SQL`, no invalid SQL.
  - `Show all blocked tickets ordered by ticket id.` -> clear `NO_RELEVANT_SQL` for missing verified `blocked` concept, no invalid SQL.
- `pytest` is still not installed in the local AI-service venv, so validation used `py_compile`, direct function harnesses, and live API calls.
