# WrenAI V1 closeout review (2026-04-04)

## Scope reviewed
- P1-09 deepagents ask primary-path cutover and legacy fallback wiring
- P1-11 regression / scan / golden evidence
- Legacy `getCurrentProject()` bridge reduction on runtime main paths

## Review findings
1. **Deepagents wiring is in place, but the default mode is still `legacy`.**
   - `wren-ai-service/src/config.py` still sets `ASK_RUNTIME_MODE` default to `legacy`.
   - `wren-ai-service/src/core/tool_router.py` already treats `deepagents` as the primary runtime when enabled and safely falls back to `LegacyAskTool` on routing miss or runtime error.
   - `wren-ai-service/src/core/deepagents_orchestrator.py` preserves skill-first routing metadata so the cutover remains observable.
2. **P1-11 regression coverage is runnable and currently green in the reviewed scope.**
   - Focused ask/runtime regression suites passed in `wren-ai-service`.
   - Focused runtime-identity/dashboard/secret-service Jest suites passed in `wren-ui`.
   - Static scans report only allowlisted compatibility-bridge usages.
3. **The current-project bridge is reduced, but not fully deleted.**
   - `wren-ui/src/apollo/server/context/runtimeScope.ts` still exposes the explicit legacy-project shim path (`allowLegacyProjectShim`) for compatibility/bootstrap cases.
   - Static scans currently show no unexpected `getCurrentProject()` or direct project-field main-path usage outside the allowlist.

## Verification evidence
### Python ask/runtime suites
Command:
```bash
cd wren-ai-service && \
  PYTHONPATH=. /Users/liyi/Code/WrenAI/wren-ai-service/.venv/bin/pytest \
  tests/pytest/test_config.py \
  tests/pytest/core/test_trace_compare.py \
  tests/pytest/services/test_ask_skill_runner.py \
  tests/pytest/services/test_ask_golden_regression.py \
  tests/pytest/services/test_chart_golden_regression.py \
  tests/pytest/services/test_runtime_identity_bridge.py \
  tests/pytest/pipelines/test_runtime_scope_context.py \
  tests/pytest/providers/test_wren_engine.py -q
```
Result: `66 passed, 1 warning in 0.98s`

### Runtime identity scans
Command:
```bash
bash misc/scripts/scan-current-project.sh
bash misc/scripts/scan-runtime-identity.sh
```
Result:
- `scan-current-project: only allowlisted bridge usages remain`
- `scan-runtime-identity:getCurrentProject: only allowlisted bridge usages remain`
- `scan-runtime-identity:direct-project-field-access: only allowlisted bridge usages remain`
- `scan-runtime-identity: runtime identity contract checks passed`

### UI focused regression suites
Command:
```bash
cd wren-ui && yarn test \
  src/apollo/server/context/tests/runtimeScope.test.ts \
  src/apollo/server/backgrounds/tests/dashboardCacheBackgroundTracker.test.ts \
  src/apollo/server/resolvers/tests/projectResolver.test.ts \
  src/apollo/server/services/tests/secretService.test.ts --runInBand
```
Result: `4 passed, 25 tests passed`

### Focused diagnostics
Command:
- `python -m py_compile src/config.py src/core/tool_router.py src/core/deepagents_orchestrator.py src/web/v1/services/ask.py`
- `lsp_diagnostics` on `wren-ui/src/apollo/server/context/runtimeScope.ts`

Result:
- Python compile check passed.
- `runtimeScope.ts` diagnostics: `0` errors.

## Risks / remaining gaps
- **Cutover still not complete by default**: until `ASK_RUNTIME_MODE` flips from `legacy` to `deepagents`, P1-09 is implemented behind the runtime switch rather than fully cut over.
- **Repo-wide UI typecheck is currently noisy outside reviewed scope**: `cd wren-ui && yarn check-types` fails on pre-existing `vega-lite` resolution and missing `children` prop errors in unrelated chart/home/knowledge pages.
- **Compatibility shim still exists intentionally**: runtime bridge cleanup is effectively “bootstrap-only / allowlisted”, not total deletion.

## Recommended closeout readout
- Treat the ask/runtime wiring and regression scaffolding as **ready for cutover**, but call out that the default-mode flip is still the final functional gate.
- Treat the current-project bridge work as **main-path cleaned, compatibility shim retained**.
- Carry forward the unrelated `wren-ui` typecheck failures as pre-existing follow-up work rather than a blocker for this reviewed slice.
