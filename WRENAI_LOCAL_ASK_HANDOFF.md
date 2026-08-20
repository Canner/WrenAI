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

After the final temporary PR-service validation attempt, the original scheduled AI service was restarted and health checked successfully on port `5555`.

## Source Control / PR Status

The work is pushed to the fork branch:

- Repository: `hbalasubramanya-rgb/WrenAI`
- Branch: `organization/ask-schema-grounding-20260820`
- PR: `https://github.com/hbalasubramanya-rgb/WrenAI/pull/1`
- PR base: `organization-feature`
- Latest schema implementation commit before handoff-only updates: `4a199fca1` (`Broaden Ask semantic grounding coverage`)
- Check PR #1 for the live head SHA because handoff-only commits may be added after the implementation commit.

The PR branch was rebased onto the latest `origin/organization-feature` after GitHub initially reported conflicts against the wrong compare/base. It was then pushed with `--force-with-lease`.

GitHub readback after the rebase:

- `mergeable=True`
- `mergeable_state=unstable`

`unstable` means GitHub checks are pending or failing; it is not a merge-conflict state.

If the previous/old branch view is gone or stale, use this branch and PR instead:

- Use branch `organization/ask-schema-grounding-20260820` for this work.
- Review and merge PR #1 into `organization-feature`.
- After merge, use `organization-feature` as the updated canonical branch.

Do not open this work against upstream `Canner/WrenAI:main` unless that is explicitly intended; this branch was prepared for the fork's `organization-feature` base.

## What Changed Today

### Generic Schema Grounding

Permanent source changes are committed on the PR branch and present in the clean PR worktree at `D:\WrenAI-ask-e2e-fix-20260820`. The original local checkout at `D:\WrenAI` may still be on an older local commit until it is refreshed from `origin/organization/ask-schema-grounding-20260820`.

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

## Live Validation and Verification

The live checks below were run through the UI GraphQL Ask path after restarting the AI service during this workstream. A later broader app regression against the updated PR source was attempted, but could not complete because the configured LLM endpoint timed out during intent classification; details are in `Final Temp PR-Service Attempt`.

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

### Final Temp PR-Service Attempt

To verify the latest PR branch rather than the stale local checkout, the scheduled AI service was stopped and a temporary service was started from `D:\WrenAI-ask-e2e-fix-20260820\wren-ai-service` using the existing local venv and `D:\WrenAI\wren-ai-service\config.local.yaml`.

Observed:

- First temp start was missing the original `.env.dev` values and Ask failed with `Embedding request failed with status 401: Invalid API Key`.
- Temp service was restarted with environment values loaded from `D:\WrenAI\wren-ai-service\.env.dev`; health check passed.
- A broader GraphQL Ask regression began with random/generic questions across PCB_DB, Orders, CWPay, CW_GL, and an unsupported Orders repair question.
- The run was blocked by the configured LLM endpoint timing out during intent classification:
  - endpoint: `10.104.74.10:18002`
  - error class: `litellm.exceptions.InternalServerError`
  - underlying connection error: `The semaphore timeout period has expired`
- Because this was an external LLM connectivity timeout, the final broader live app regression did not complete on the latest PR commit.

Cleanup completed:

- Temporary regression runner was stopped.
- Temporary PR AI service was stopped.
- Scheduled task `WrenAI 04 AI Service` was restarted.
- AI health returned `{"status":"ok"}`.
- Active project was restored to PCB_DB with project id `10`.

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
- Follow-up generic business families:
  - Invoice counts by task status and invoice month.
  - Top suppliers by gross amount.
  - Missing supplier email fields.
  - Reconciliation counts by status and preparer group.
  - GL accounts by highest ending balance for the current year.
  - Recent journal workflow approvals.

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

In the pushed PR branch, the source changes below are committed. The original local checkout at `D:\WrenAI` may still show unrelated dirty runtime/data files and may also show the old pre-rebase local commit until it is refreshed from origin.

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
- On 2026-08-20, live E2E against the running local app showed the checkout at `D:\WrenAI` was older than the pushed PR branch, so some observed runtime failures were from stale local code. The PR branch now includes follow-up commit `4a199fca1` (`Broaden Ask semantic grounding coverage`), which expands generic schema grounding for invoice, supplier email, reconciliation, GL balance, and journal workflow families without hardcoding one project/table/prompt.
- The final broader live regression against the latest PR source was blocked by LLM endpoint connectivity to `10.104.74.10:18002`, not by SQL identifier validation. Re-run this after the LLM endpoint is reachable.
- Local live execution against CWPay/CW_GL may still fail until those SQL Server datasources are reachable; the observed error was an ODBC login/network timeout to `BRVBISQL.INT.CW.LOCAL,1433`, not a SQL identifier hallucination.
- `enable_column_pruning` was not the focus of today's final validation.
- Full pytest suite still needs an environment with `pytest` installed.
- UI `check-types`/Jest could not be run in the clean PR worktree because `node_modules` and the Yarn node_modules state file were absent. `corepack yarn` is available; run `corepack yarn install --immutable` in an environment where dependency install is allowed, then `corepack yarn check-types`.

## Follow-up Fix: Same-thread Ask Reliability

Additional generic fixes were added for the issue where an existing thread could show `Failed to create asking task` while a new thread worked better.

Changed:

- `wren-ui/src/apollo/server/repositories/threadResponseRepository.ts`
  - Thread responses now have deterministic ordering.
  - Limited history uses newest response ids first.
- `wren-ui/src/pages/home/[id].tsx`
  - Same-thread resume logic now considers only the latest thread response for unfinished asking/thread-response polling.
  - Older stale unfinished responses no longer take over the prompt state for the current thread.
- `wren-ui/src/hooks/useAskPrompt.tsx`
  - Asking-task polling is scoped to the active task id so late results from older tasks do not drive the current prompt.
  - Failed task creation now stops polling and propagates the error to the prompt.
- `wren-ui/src/components/pages/home/prompt/index.tsx`
  - Prompt UI resets out of `Understanding question` if asking-task creation fails.
- `wren-ui/src/apollo/server/services/askingService.ts`
  - Added logs for thread id, project id, deploy id, previous latest task state, history count, task id/query id, and failure reason.
- `wren-ui/src/apollo/server/services/askingTaskTracker.ts`
  - Added logs for task creation request, project/deploy id, histories, created local task id, query id, and creation failure reason.

Root cause addressed:

- Existing-thread pages could resume or keep polling an older unfinished response instead of the latest response, especially when previous failed/stale task state remained in the thread. New threads did not have that stale state, which is why they behaved better.

## Follow-up Fix: Average / Distribution / Location Grounding

Additional generic schema-first SQL fixes were added for metric intent and dimension grounding:

- Average intent now requires `AVG(...)` over a verified numeric measure such as age/duration/elapsed fields.
- Average requests no longer fall back to `COUNT(...)`.
- If a requested average measure is not available in the active project schema, the flow returns unsupported schema instead of a wrong count.
- Distribution/breakdown intent now uses grouped counts over verified category/status fields.
- Repair-status distributions can filter verified status values such as completed and in-progress while still grouping by status.
- Dimension-pair listing, such as board model by location, uses `SELECT DISTINCT` only when one verified schema object exposes all requested dimensions.
- If board model and location are not covered by verified schema, the flow returns unsupported schema instead of inventing `Location`.
- Retrieval expansion and column ranking now include average, age, duration, elapsed, distribution, and breakdown concepts.
- Semantic validation now rejects valid-but-wrong SQL that answers average requests with counts or distribution requests without grouped counts.

Focused validation passed:

```text
py_compile:
- wren-ai-service/src/pipelines/generation/utils/sql.py
- wren-ai-service/src/pipelines/retrieval/db_schema_retrieval.py
- wren-ai-service/tests/pytest/pipelines/generation/test_sql_schema_grounding.py

Direct Python test-function harness:
- ran=37 failures=0

Direct SQL smoke:
- average age of failed units by board model -> AVG verified age measure grouped by board_model
- average age without age/duration field -> unsupported schema
- repair status distribution -> grouped counts by verified status with completed/in-progress filters
- board model associated with location -> SELECT DISTINCT only when both verified columns exist
- board model/location without location field -> unsupported schema
```

## Recommended Next Steps

1. Review PR #1: `https://github.com/hbalasubramanya-rgb/WrenAI/pull/1`.
2. Confirm the PR base is `organization-feature`, not `Canner/WrenAI:main`.
3. Resolve any GitHub check failures if `mergeable_state` remains `unstable`, then merge PR #1.
4. After merge, continue from `organization-feature`.
5. Install or enable pytest in `wren-ai-service\venv`, then run focused tests.
6. Review the large `utils/sql.py` diff carefully; consider extracting fallback/grounding helpers into smaller modules after behavior is stable.
7. Add sample-value metadata to retrieval context if available, then make value matching use that metadata instead of only text normalization.
8. Re-run the broader live Ask regression across PCB_DB, Orders, CWPay, and CW_GL when the LLM endpoint and data sources are available.
