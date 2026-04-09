# Eval SQLite exception assessment (2026-04-09)

## Bottom line

WrenAI's **product runtime / local dev / cutover scripts** are now PostgreSQL-first.
The remaining SQLite references are intentionally bounded to:

1. benchmark / eval compatibility code
2. repo / dependency metadata files

That boundary is enforced by:

- `misc/sqlite-residual-allowlist.txt`
- `bash misc/scripts/check-sqlite-residuals.sh`

## Why eval still uses SQLite

### 1) Spider execution metrics open benchmark `.sqlite` databases directly

- `wren-ai-service/eval/metrics/spider/__init__.py:788-804`
  - opens a benchmark DB path with `sqlite3.connect(...)`
- `wren-ai-service/eval/metrics/spider/__init__.py:962-968`
  - discovers sibling benchmark DB files by `.sqlite` suffix
- `wren-ai-service/eval/metrics/spider/process_sql.py:116-124`
  - introspects schema via `sqlite_master` and `PRAGMA table_info`
- `wren-ai-service/eval/metrics/spider/exec_match.py:28-33`
  - builds `<db_name>.sqlite` paths for execution accuracy
- `wren-ai-service/eval/metrics/spider/exact_match.py:31-34`
  - builds `<db_name>.sqlite` paths for exact-match schema loading

These are not just naming leftovers; they are the current execution model for the upstream Spider benchmark helpers.

### 2) BIRD preparation inherits upstream SQLite artifact names

- `wren-ai-service/eval/preparation.py:330-333`
  - reads `mini_dev_sqlite.json`

This is an upstream dataset filename, not an app-storage choice.

### 3) Eval utilities still bridge SQLite benchmark assets into PostgreSQL

- `wren-ai-service/eval/utils.py:540-555`
  - installs DuckDB's sqlite extension and attaches `.sqlite` benchmark DBs
- `wren-ai-service/eval/utils.py:584-591`
  - uses `pgloader` to load benchmark `.sqlite` data into PostgreSQL

So even the PostgreSQL-backed eval flow currently starts from SQLite benchmark artifacts.

## Why not remove these references right now

Removing them safely would require more than string cleanup:

1. replacing Spider's sqlite3-based execution path with a PostgreSQL runner
2. replacing schema introspection that currently depends on `sqlite_master` / `PRAGMA`
3. revalidating benchmark semantics, especially execution/exact-match parity
4. deciding whether benchmark truth should remain upstream-compatible or become Wren-specific

That is a **benchmark semantics change**, not just a runtime cleanup.

## What changed in this repo already

A first adapter step is now in place:

- Spider helpers can build either the legacy `<db_name>.sqlite` target or an experimental PostgreSQL DSN target.
- Schema loading can now introspect PostgreSQL via `information_schema.columns`.
- Execution matching can now run against a single PostgreSQL target when explicitly configured.

This reduces direct SQLite coupling inside the helper code, but it does **not** yet prove parity with the upstream multi-file SQLite testsuite semantics.

## Recommended boundary

Short term:

- keep eval SQLite references as a documented compatibility exception
- keep all product/runtime/dev paths PostgreSQL-first
- enforce the exception set with `check-sqlite-residuals.sh`

Future migration only if needed:

1. build a parallel PostgreSQL benchmark adapter
2. compare it against the canonical SQLite path on the same benchmark slice
3. switch only after parity is proven


## Real Spider PostgreSQL rehearsal (2026-04-09)

A real local rehearsal was run against the upstream `poker_player` Spider benchmark database after downloading the official Spider assets into `wren-ai-service/tools/dev/etc/spider1.0`.

Verified findings:

1. The PostgreSQL Spider adapter needed a driver fallback.
   - Local env had `psycopg` but not `psycopg2`.
   - `eval.metrics.spider.database._connect_postgres()` was updated to accept either driver.

2. Importing benchmark SQLite data with `pgloader --with "quote identifiers"` breaks canonical Spider SQL on PostgreSQL.
   - Example: `SELECT COUNT(DISTINCT Nationality) FROM people` failed because pgloader preserved mixed-case column names like `"Nationality"`.

3. Importing the same benchmark DB **without** `quote identifiers` improves canonical-query compatibility.
   - The canonical Spider gold query above executed successfully after a case-normalized import.
   - `eval.utils.load_eval_data_db_to_postgres()` now uses that case-normalized pgloader import strategy.

4. PostgreSQL execution now normalizes quoted identifiers before benchmark execution.
   - `eval.metrics.spider.__init__.py` lowers quoted identifiers only for PostgreSQL-backed execution targets, while preserving single-quoted string literals.
   - This closed the observed `poker_player` parity gap for `SELECT COUNT(DISTINCT "Nationality") AS "nationality_count" FROM "people"`.

5. PostgreSQL benchmark reload now targets the effective benchmark DSN instead of a hardcoded default database.
   - `eval.utils.load_eval_data_db_to_postgres()` now resolves `{db_name}` templates, creates the target database if needed, and imports into that exact PostgreSQL benchmark target.
   - The loader now auto-detects the matching Docker network / container alias from the host-side DSN used by prediction / evaluation metadata instead of hardcoding `wren_wren`.
   - Non-`public` schemas are now finalized by moving imported tables into the requested schema and setting the database `search_path`.

Implication:

- The PostgreSQL Spider adapter is now **driver-compatible** in this repo and can execute both the canonical and quoted-identifier rehearsal cases on `poker_player` with the same exact-match / execution result as SQLite.
- The PostgreSQL benchmark reload path is now materially closer to production-like usage because prediction / evaluation can round-trip through a host-side DSN such as `localhost:9432/{db_name}?schema=analytics` and still load into the right containerized PostgreSQL target.
- SQLite still remains the default benchmark compatibility path until broader multi-database parity is proven, but the PostgreSQL adapter is materially more usable than before.

## Verification evidence

At the time of this assessment:

- `cd wren-ai-service && poetry run pytest tests/pytest/eval/test_spider_database_adapter.py tests/pytest/eval/test_pipeline_metric_config.py tests/pytest/eval/test_metrics.py tests/pytest/eval/test_evaluation_benchmark_target.py -q`
  - `26 passed`
- `bash misc/scripts/check-sqlite-residuals.sh`
  - passes with allowlisted-only hits
- `bash misc/scripts/inventory-sqlite-residuals.sh`
  - reports `active runtime / dev / ops path` hit-count = `0`
- real `poker_player` rehearsal against PostgreSQL imported from upstream Spider SQLite asset
  - identity case: SQLite exact/exec = `True/1`, PostgreSQL exact/exec = `True/1`
  - quoted-identifier case: SQLite exact/exec = `True/1`, PostgreSQL exact/exec = `True/1`
- synthetic PostgreSQL loader smoke against `postgresql://postgres:postgres@localhost:9432/smoke_{db_name}?schema=analytics`
  - verified `search_path = analytics, public`
  - verified unqualified `SELECT COUNT(*) FROM items` = `2`
  - verified schema-qualified `SELECT COUNT(*) FROM analytics.items` = `2`
