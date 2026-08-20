# WrenAI Ask Grounding Handoff

Date: 2026-08-20

## Current Goal

Make WrenAI's Ask pipeline schema-first for the active org/project. Natural language should search and rank verified schema metadata, but final SQL must use only tables, views, columns, relationships, metrics, and values supported by the selected project's metadata.

Do not fix future issues by hardcoding one question, project, table, column, or organization. Representative prompts such as `Which repair logs have the highest priority?` are regression examples only.

## Final Runtime State

- UI: `http://127.0.0.1:3000`
- AI service: `http://127.0.0.1:5555`
- AI health: `{"status":"ok"}`
- Active project restored after validation: `org / PCB_DB`
- Active project id: `10`
- Orders project id: `11`
- Sales duplicate: not shown in current project list; `Orders` remains canonical.

Current projects visible through `/api/v1/projects/current`:

- id `4`, unnamed DuckDB
- id `10`, `PCB_DB`
- id `11`, `Orders`
- id `12`, `CWPay`
- id `13`, `CW_GL`

## What Changed Today

### Generic Schema Grounding

Permanent source changes are now in `D:\WrenAI\wren-ai-service`, not only `.codex-tmp`.

Main file:

- `wren-ai-service/src/pipelines/generation/utils/sql.py`

Added or improved:

- SQL identifier validation against retrieved schema.
- Semantic coverage validation so valid identifiers are not enough; the referenced table/view must also support the requested business concepts.
- Unsupported-schema result helper that returns `NO_RELEVANT_SQL` with no invented SQL.
- Deterministic schema-grounded fallback for common Ask families:
  - count / grouped counts
  - top-N
  - highest / lowest
  - latest / recent
  - priority / severity
  - status filters
  - date/month/year filters
  - revenue/sales measures
  - failure counts vs defect-rate metrics
  - failure type value filters
- Semantic alias support from Wren retrieved context blocks.
- More timestamp type support, including `TIMESTAMPTZ`, which fixed the live `latest repair logs` failure.
- Normalization of dialect issues such as `TOP n`, joined `DESCLIMIT`, and order-by aliases.
- Logs for generated SQL validation, deterministic fallback SQL, fallback validation, selected table, verified columns, and metric intent.

### Retrieval Improvements

Main file:

- `wren-ai-service/src/pipelines/retrieval/db_schema_retrieval.py`

Added or improved:

- Project-scoped retrieval filters retained and tested.
- Query expansion for business concepts such as repair, failure, revenue, order, material, status, priority, latest, and date.
- Ranking uses table names, column names, descriptions/comments, semantic context, and generic-table deboosting.
- Logs for:
  - selected project id
  - retrieved candidate tables and scores
  - selected schema objects and columns

### Generation Pipeline Wiring

Files:

- `wren-ai-service/src/pipelines/generation/sql_generation.py`
- `wren-ai-service/src/pipelines/generation/followup_sql_generation.py`
- `wren-ai-service/src/pipelines/generation/sql_correction.py`

Changes:

- Passed the user query into post-processing as `fallback_query`.
- Added pre-LLM unsupported-schema checks where retrieved schema clearly cannot cover requested concepts.
- Ensured SQL correction still uses the same schema-first validation and fallback logic.
- Strengthened correction instructions so invalid or hallucinated identifiers are not preserved.

### UI / Project Cleanup From This Workstream

Files still dirty from the related UI/runtime fixes:

- `wren-ui/src/apollo/server/resolvers/modelResolver.ts`
- `wren-ui/src/apollo/server/services/askingService.ts`

Relevant behavior:

- Previous `results` crash handling is preserved.
- Unsupported-schema failures now avoid showing invented SQL as something to fix.
- Sales/Orders cleanup remains in place: UI project list shows `Orders`, not duplicate `Sales`.

## Live Validation Done

All live checks were run through the UI GraphQL Ask path after restarting the AI service.

### PCB_DB

Active project: `PCB_DB`, id `10`.

Passed:

- `Which repair logs have the highest priority?`
  - Table: `dbo_repair_logs`
  - Uses verified `priority`
  - Orders by generic priority ranking expression
- `Show all critical-priority repairs`
  - Table: `dbo_repair_logs`
  - Filter: `priority = 'critical'`
- `Show repairs by status`
  - Table: `dbo_repair_logs`
  - Group: `status`
  - Metric: `COUNT(id)`
- `Show latest repair logs`
  - Table: `dbo_repair_logs`
  - Order: `created_at DESC`
  - This was the live regression fixed by adding timestamp type coverage.
- `Show the number of failures by material`
  - Uses verified material/failure fields from PCB_DB.
- `Show top 5 board models with the most failures`
  - Table: `dbo_repair_logs`
  - Metric: `COUNT(failure_code)`
  - Did not use `defect_rate`.
- `Show units with JTAG as the failure type`
  - Table: `dbo_report_failures`
  - Filter: `failure_type = 'JTAG'`
- Extra check:
  - `Show all repairs with a critical priority and an in-progress status.`
  - Table: `dbo_repair_logs`
  - Filters: `status = 'in-progress'` and `priority = 'critical'`

### Orders

Temporarily switched active project to `Orders`, id `11`, then restored PCB_DB.

Passed:

- `Show top 10 orders from July`
  - Uses Orders table/date fields.
- `Show number of orders by customer`
  - Groups by customer.
  - Counts distinct order numbers.
- `Show revenue by year`
  - Uses verified sales/revenue value and invoice date fields.
- Unsupported check: `Which repair logs have the highest priority?`
  - Returned `NO_RELEVANT_SQL`.
  - No SQL candidate.
  - Message clearly said the active project does not contain verified `repair` and `priority/severity` fields.

## Checks Run

Passed:

```powershell
git diff --check -- wren-ai-service/src/pipelines/generation/utils/sql.py `
  wren-ai-service/src/pipelines/generation/sql_generation.py `
  wren-ai-service/src/pipelines/generation/followup_sql_generation.py `
  wren-ai-service/src/pipelines/generation/sql_correction.py `
  wren-ai-service/src/pipelines/retrieval/db_schema_retrieval.py `
  wren-ai-service/tests/pytest/pipelines/generation/test_sql_schema_grounding.py `
  wren-ai-service/tests/pytest/pipelines/retrieval/test_db_schema_retrieval.py
```

Passed:

```powershell
cd D:\WrenAI\wren-ai-service
.\venv\Scripts\python.exe -m compileall -q src\pipelines\generation src\pipelines\retrieval `
  tests\pytest\pipelines\generation\test_sql_schema_grounding.py `
  tests\pytest\pipelines\retrieval\test_db_schema_retrieval.py
```

Could not run pytest in the service venv:

```text
D:\WrenAI\wren-ai-service\venv\Scripts\python.exe: No module named pytest
```

## Tests Added

Main test file:

- `wren-ai-service/tests/pytest/pipelines/generation/test_sql_schema_grounding.py`

Coverage added for:

- Unsupported schema clears invalid SQL.
- Generic table rejection for unsupported business concepts.
- Repair priority ordering.
- Critical-priority repair filters.
- Repairs by status.
- Latest repair logs with `TIMESTAMPTZ`.
- Semantic alias column support, for example using real verified `Urgency` when semantic context says it means priority/severity.
- Failure by material / technician with verified columns.
- JTAG failure type filters.
- Board models with most failures uses count, not defect rate.
- Highest defect rate uses rate metric.
- Repairs by technician requires one schema object or relationship coverage.

Retrieval test file:

- `wren-ai-service/tests/pytest/pipelines/retrieval/test_db_schema_retrieval.py`

Coverage added for:

- Project filter conditions.
- Query expansion.
- Table ranking by query and schema text.
- Project-scoped schema retrieval behavior.

## Restart Commands Used

Restart AI service only:

```powershell
$taskName = 'WrenAI 04 AI Service'
$listenerProcessIds = Get-NetTCPConnection -LocalPort 5555 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
foreach ($listenerProcessId in $listenerProcessIds) {
  if ($listenerProcessId) {
    Stop-Process -Id $listenerProcessId -Force -ErrorAction SilentlyContinue
  }
}
Start-ScheduledTask -TaskName $taskName
```

Health check:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5555/health
```

Project switch endpoints used for validation:

```powershell
Invoke-WebRequest -UseBasicParsing -Method POST http://127.0.0.1:3000/api/v1/projects/11/select
Invoke-WebRequest -UseBasicParsing -Method POST http://127.0.0.1:3000/api/v1/projects/10/select
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/api/v1/projects/current
```

## Current Dirty Files To Review

Relevant tracked files:

- `wren-ai-service/src/pipelines/generation/followup_sql_generation.py`
- `wren-ai-service/src/pipelines/generation/sql_correction.py`
- `wren-ai-service/src/pipelines/generation/sql_generation.py`
- `wren-ai-service/src/pipelines/generation/utils/sql.py`
- `wren-ai-service/src/pipelines/retrieval/db_schema_retrieval.py`
- `wren-ai-service/tests/pytest/pipelines/generation/test_sql_schema_grounding.py`
- `wren-ai-service/tests/pytest/pipelines/retrieval/test_db_schema_retrieval.py`
- `wren-ui/src/apollo/server/resolvers/modelResolver.ts`
- `wren-ui/src/apollo/server/services/askingService.ts`

There are also many local untracked runtime/data artifacts in the repository. Do not clean or delete them casually.

## Important Caveats

- Runtime source code should remain generic. Do not add checks for exact prompts such as `Which repair logs have the highest priority?`.
- Tests may use representative table and prompt names; production code must not.
- Retrieval context currently uses metadata/descriptions and some semantic context. It does not appear to carry robust sample-value lists. Status casing/value handling works for tested prompts, but richer value-aware matching would improve future accuracy.
- `enable_column_pruning` was not the focus of today's final validation.
- Full pytest suite still needs an environment with `pytest` installed.

## Recommended Next Steps

1. Install or enable pytest in `wren-ai-service\venv`, then run focused tests.
2. Review the large `utils/sql.py` diff carefully; consider extracting fallback/grounding helpers into smaller modules after behavior is stable.
3. Add sample-value metadata to retrieval context if available, then make value matching use that metadata instead of only text normalization.
4. Run a broader live Ask regression across PCB_DB, Orders, CWPay, and CW_GL when their data sources are available.
5. Commit the source changes after review, excluding local runtime/data artifacts.
