# WrenAI Ask Schema Grounding Handoff

Date: 2026-09-01

## Current Branch

- Workspace: `D:\WrenAI`
- Branch: `organization/ask-schema-grounding-20260820`
- Local HEAD before this handoff commit: `0ff1e6e23 Improve Ask schema grounding`
- Remote tracking state at handoff time: local branch was ahead 1 and behind 82
- Do not use `.codex-tmp` as runtime source. The AI service was restarted from `D:\WrenAI\wren-ai-service`.

## Goal Continued

Continue the WrenAI Ask schema-grounding work for CWPay and CW_GL while preserving Orders and PCB_DB behavior. The focus of this continuation was Ask speed and correctness on large schemas:

- add timing logs for Ask stages
- identify slow stages
- reduce unnecessary LLM calls
- cache schema-derived metadata and ranking inputs
- keep SQL generation schema-verified
- return clear unsupported results instead of hallucinated SQL
- validate CWPay, CW_GL, Orders, and PCB_DB

## What Was Done

### Timing and Observability

Ask timing logs now cover the key path across UI and AI service:

- frontend request
- task creation
- schema retrieval support context
- schema retrieval
- candidate ranking
- LLM intent generation
- SQL generation / deterministic fast path
- SQL validation
- SQL execution
- answer formatting request and polling
- cancel request and cancellation point

Relevant logs reviewed:

- `.codex-tmp\ai-dev-after13.err.log`
- `.codex-tmp\ai-dev-after14.err.log`
- `.codex-tmp\ai-dev-after15.err.log`
- `.codex-tmp\ai-dev-after17.err.log`
- `.codex-tmp\ai-dev-after19.err.log`
- `.codex-tmp\ai-dev-after20.err.log`

Final stage summary from `.codex-tmp\ai-dev-after20.err.log`:

- `sql_generation_fast_path`: avg about 1.4s, max about 2.8s
- `schema_retrieval`: avg about 0.5s, max about 1.5s
- `schema_retrieval_support_context`: avg about 19ms
- task creation and frontend markers were effectively negligible
- no LLM intent generation was used by the final Ask validation tasks except the explicit cancel test

There is one non-Ask background outlier in the same AI log: `schema_retrieval_total` around 142s from a column-pruning/question-recommendation path. It was not part of the final Ask task timing set.

### Performance Improvements

- Added deterministic schema-driven fast paths for clear count, grouping, top-N, latest, date/month bucket, distribution, listing, and same-thread group-result follow-up shapes.
- Added pre-intent unsupported handling for simple analytics requests when active-project schema coverage is missing.
- Added schema metadata/token/index caching for table/column/description-derived matching.
- Changed large-schema retrieval to broad candidate gathering and small top-K reranking.
- Changed generation-context limiting to skip oversized candidates and continue looking for smaller valid candidates within the token budget.
- Tightened same-thread follow-up grounding to use compact latest verified SQL/table identifiers instead of accumulating stale or oversized history.
- Preserved schema validation and dry-run validation. Unsupported cases return `NO_RELEVANT_SQL` instead of invalid SQL.
- Fixed SQL literal offset handling so extracted filter values are validated against the right columns.
- Fixed top record/listing behavior so row-level date questions order by verified date columns instead of unrelated numeric fields.
- Tightened answer formatting prompts to use executed SQL result rows only and not invent analysis, values, code, or examples.
- Added transient MSSQL deadlock retry around Ibis query execution.

### Count Shape Fix

The CWPay question `How many invoice records are there?` now returns a scalar aggregate:

```sql
SELECT
  COUNT(*) AS "record_count"
FROM
  "dbo_View_Open_Invoices"
```

The result shape is one column, `record_count`, and one row. It no longer returns invoice detail columns for that simple count shape.

### Same-Thread Follow-Ups

Follow-up questions now retrieve exact prior verified tables from the latest SQL and use a compact grounding query. This fixed the slow same-thread path that previously fell back to LLM calls on large schemas.

Final targeted follow-up waits:

- CWPay: about 3.0s
- CW_GL: about 3.0s
- Orders: about 3.1s
- PCB_DB: about 2.0s

## Validation Results

Final artifacts:

- `.codex-tmp\ask_perf_benchmark_after_final.json`
- `.codex-tmp\resume_schema_grounding_validation_after_final.json`
- `.codex-tmp\cancel_check_after20.json`

Before/after benchmark:

- Before avg Ask wait: 61,818.6ms
- Before max Ask wait: 143,366ms
- After avg Ask wait: 3,388ms
- After max Ask wait: 5,056ms

Observed CWPay examples:

- `How many invoice records are there?`
  - before: 84,653ms
  - after: 3,031ms
  - final SQL uses scalar `COUNT(*) AS "record_count"`
- `Show invoices by business unit`
  - before: 112,881ms
  - after: 3,036ms
  - final SQL groups by verified `bunit`

Final full validation:

- Project checks: 4/4
- Ask cases: 18/18
- Same-thread follow-ups: 4/4

Project checks:

- CWPay: 364 datasource tables, 350 models, modeling page passed, preview 3/3, deploy `SUCCESS`, sync `SYNCRONIZED`
- CW_GL: 223 datasource tables, 223 models, modeling page passed, preview 3/3, deploy `SUCCESS`, sync `SYNCRONIZED`
- Orders: 103 datasource tables, 101 models, modeling page passed, preview 3/3, deploy `SUCCESS`, sync `SYNCRONIZED`
- PCB_DB: 76 datasource tables, 68 models, modeling page passed, preview 3/3, deploy `SUCCESS`, sync `SYNCRONIZED`

Regression status:

- Orders by customer: passed
- Orders revenue/date/month/latest families: passed
- PCB_DB repairs/status/priority/month/latest families: passed
- Unsupported cross-project questions: passed with `NO_RELEVANT_SQL`
- No observed schema leakage between projects
- No observed `Failed to create asking task`
- No observed hallucinated tables or columns in final validation

Cancel validation:

- CWPay cancel task: `7a2e1247-2a73-4a52-9fdd-d41004afc3c7`
- cancel mutation returned `true`
- final status: `STOPPED`
- elapsed to terminal status: 520ms

## Tests Run

From `D:\WrenAI\wren-ai-service`:

```powershell
.\venv\Scripts\python.exe -m pytest tests/pytest/services/test_ask.py tests/pytest/pipelines/generation/test_sql_schema_grounding.py tests/pytest/pipelines/retrieval/test_db_schema_retrieval.py -q
```

Result: 114 passed.

Additional focused Ask service test:

```powershell
.\venv\Scripts\python.exe -m pytest tests/pytest/services/test_ask.py -q
```

Result: 4 passed.

Warnings were pre-existing Pydantic deprecation warnings and existing coroutine cleanup warnings in semantics-preparation tests.

## Files To Include In Handoff Commit

Include the Ask/UI source and focused tests:

- `wren-ai-service/src/pipelines/generation/data_assistance.py`
- `wren-ai-service/src/pipelines/generation/followup_sql_generation.py`
- `wren-ai-service/src/pipelines/generation/followup_sql_generation_reasoning.py`
- `wren-ai-service/src/pipelines/generation/intent_classification.py`
- `wren-ai-service/src/pipelines/generation/sql_answer.py`
- `wren-ai-service/src/pipelines/generation/sql_correction.py`
- `wren-ai-service/src/pipelines/generation/sql_generation.py`
- `wren-ai-service/src/pipelines/generation/sql_generation_reasoning.py`
- `wren-ai-service/src/pipelines/generation/utils/sql.py`
- `wren-ai-service/src/pipelines/indexing/db_schema.py`
- `wren-ai-service/src/pipelines/indexing/utils/helper.py`
- `wren-ai-service/src/pipelines/retrieval/db_schema_retrieval.py`
- `wren-ai-service/src/web/v1/routers/ask.py`
- `wren-ai-service/src/web/v1/services/ask.py`
- `wren-ai-service/src/web/v1/services/ask_feedback.py`
- `wren-ai-service/src/web/v1/services/sql_answer.py`
- `wren-ai-service/tests/pytest/pipelines/generation/test_prompt_grounding_contracts.py`
- `wren-ai-service/tests/pytest/pipelines/generation/test_sql_answer_prompt.py`
- `wren-ai-service/tests/pytest/pipelines/generation/test_sql_schema_grounding.py`
- `wren-ai-service/tests/pytest/pipelines/indexing/test_db_schema.py`
- `wren-ai-service/tests/pytest/pipelines/retrieval/test_db_schema_retrieval.py`
- `wren-ai-service/tests/pytest/services/test_ask.py`
- `wren-ui/src/apollo/server/adaptors/wrenAIAdaptor.ts`
- `wren-ui/src/apollo/server/backgrounds/textBasedAnswerBackgroundTracker.ts`
- `wren-ui/next.config.js`
- `wren-ui/src/apollo/server/resolvers/askingResolver.ts`
- `wren-ui/src/apollo/server/resolvers/modelResolver.ts`
- `wren-ui/src/apollo/server/services/askingService.ts`
- `wren-ui/src/apollo/server/services/askingTaskTracker.ts`
- `wren-ui/src/apollo/server/services/queryService.ts`
- `wren-ui/src/apollo/server/services/tests/queryService.test.ts`
- `wren-ui/src/apollo/server/utils/manifest.ts`
- `WRENAI_LOCAL_ASK_HANDOFF.md`

Do not include:

- `.codex-tmp`
- local configs
- logs
- venv folders
- extracted datasource dumps
- Qdrant/storage runtime data
- `wren-engine` submodule pointer
- `wren-ui/.yarn/releases/yarn-4.5.3.cjs` mode-only churn
- `wren-ui/package-lock.json` unless intentionally changing package management

## Remaining Blockers

- Modeling AI Assistant generate semantics/relationships for CW_GL remains unresolved. Earlier evidence showed semantics omitted the selected model and relationships timed out. Final Ask performance validation skipped assistant generation checks.
- Branch is behind remote by 82 commits. Push may require integration/rebase by whoever owns the branch if GitHub rejects a non-fast-forward push.

## Guardrails Preserved

- No app logic hardcodes datasource, project, organization, table, column, filter-value, or prompt-specific mappings.
- SQL is generated only from verified retrieved schema and then validated.
- Answer formatting is grounded in executed SQL results only.
- Unsupported or weakly covered questions fail quickly with a clear unsupported/clarification result.
