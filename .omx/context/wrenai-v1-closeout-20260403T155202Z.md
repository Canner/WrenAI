# WrenAI V1 closeout context snapshot

## Task statement
Use OMX team mode to finish the remaining WrenAI V1 rebuild work as quickly as possible via 3 coordinated lanes.

## Desired outcome
- P1-09: deepagents becomes the ask main path with legacy fallback preserved.
- P1-11: regression/scan/golden evidence is consolidated and runnable.
- Legacy current-project bridge is reduced to bootstrap-only or removed from runtime main paths.

## Known facts / evidence
- P1-01 ~ P1-08 and most of P1-10 have code landed.
- `wren-ai-service/src/config.py` still defaults `ASK_RUNTIME_MODE` to `legacy`.
- deepagents orchestrator / tool router / shadow compare code and tests already exist.
- pgvector provider + sql_pairs runtime path was just fixed and verified.
- Recent verified tests:
  - `tests/pytest/services/test_sql_pairs.py`
  - `tests/pytest/pipelines/indexing/test_sql_pairs.py`
  - `tests/pytest/providers/test_pgvector_provider.py`
  - `tests/pytest/providers/test_loader.py`
  - `tests/pytest/providers/test_providers.py`
- `bash misc/scripts/scan-current-project.sh` returns: `only allowlisted bridge usages remain`.
- `wren-ui/src/apollo/server/context/runtimeScope.ts` still contains legacy `getCurrentProject()` bridge logic.

## Constraints
- User wants fast completion and explicitly requested team mode.
- Keep diffs focused; avoid unrelated churn.
- Network is restricted by default; local/test/docker commands may need escalation.
- Repo currently has many in-flight modifications; avoid stepping on unrelated files.
- Must verify with concrete evidence before claiming completion.

## Unknowns / open questions
- Which remaining deepagents tests fail once default mode flips to `deepagents`.
- Whether any UI/API paths still implicitly depend on legacy current-project fallback.
- Whether current golden baselines need fixture updates after the default-mode switch.

## Likely codebase touchpoints
- `wren-ai-service/src/config.py`
- `wren-ai-service/src/web/v1/services/ask.py`
- `wren-ai-service/src/core/tool_router.py`
- `wren-ai-service/src/core/deepagents_orchestrator.py`
- `wren-ai-service/tests/pytest/services/test_ask*.py`
- `wren-ai-service/tests/pytest/core/test_trace_compare.py`
- `wren-ui/src/apollo/server/context/runtimeScope.ts`
- `wren-ui/src/apollo/server/resolvers/*`
- `misc/scripts/scan-current-project.sh`
- `misc/scripts/scan-runtime-identity.sh`
