# kb_snapshot legacy project cutover audit (2026-04-09)

## Current repo status

- Compatibility bridge exact hits in active implementation are down to **0**.
- Active kb_snapshot bridge fallback surfaces are down to **0**.
- The runtime cleanup portion of Wave 3 is complete; the remaining work is **schema closeout**.
- `bash misc/scripts/scan-kb-snapshot-bridge-fallback.sh` now verifies that no kb_snapshot bridge fallback surfaces remain in active code.
- `bash misc/scripts/scan-runtime-identity.sh` now also triggers this guardrail by default, so the main runtime identity scan already covers Wave 3 code fallback checks.

## Remaining Wave 3 focus

At this point the compatibility cutover is no longer blocked by active code paths.
The remaining goal is to prove the data is clean and then remove the old schema column:

1. Backfill canonical dashboard / deploy-hash bindings.
2. Clear any remaining `kb_snapshot.legacy_project_id` rows that are already covered by canonical deploy data.
3. Drop `kb_snapshot.legacy_project_id` from the schema.

### Schema / migration evidence

- `wren-ui/migrations/20260401150001_create_knowledge_base_runtime_tables.js:26-46`
  - `kb_snapshot` still physically contains `legacy_project_id`
- `wren-ui/migrations/20260406205500_add_runtime_identity_to_deploy_log.js:18-34`
  - `deploy_log` runtime identity fields were backfilled from `kb_snapshot` by `deploy_hash`
  - This is the main canonical path that can replace the old bridge fallback, but it must be verified on real data first.
- `wren-ui/migrations/20260409153000_backfill_dashboard_and_kb_snapshot_runtime_binding.js`
  - Adds a non-breaking backfill step so dashboards and kb snapshots can align to canonical `deploy_log.kb_snapshot_id` rows before the final Wave 3 cutover.
- `wren-ui/migrations/20260409170000_clear_kb_snapshot_legacy_project_id.js`
  - Clears `kb_snapshot.legacy_project_id` only after canonical deploy linkage exists and dashboard / deploy-hash drift checks are clean.
- `wren-ui/migrations/20260409173000_drop_kb_snapshot_legacy_project_id.js`
  - Drops the old schema column after the runtime cleanup and legacy-row cleanup steps are complete.

## Manual DB audit SQL

> Run these against the real app database before deleting the last compatibility mapping.
> Reusable SQL file: `misc/sql/project-identity-kb-snapshot-wave3-audit.sql`
> PostgreSQL non-destructive rehearsal helper (runs inside a transaction and rolls back): `bash misc/scripts/project-identity-kb-snapshot-backfill-rehearsal.sh "$PG_URL"`
> PostgreSQL apply helper (creates a `pg_dump` backup first): `bash misc/scripts/project-identity-kb-snapshot-backfill-apply.sh "$PG_URL"`
> PostgreSQL final drop helper (creates a `pg_dump` backup first): `bash misc/scripts/project-identity-kb-snapshot-drop-legacy-column.sh "$PG_URL"`

### 0) Sanity-check that you are on the app database

```sql
SELECT
  to_regclass('public.kb_snapshot') AS kb_snapshot_table,
  to_regclass('public.dashboard') AS dashboard_table,
  to_regclass('public.deploy_log') AS deploy_log_table;
```

If any result is `NULL`, stop and switch to the real application database before using the rest of the audit.

### 1) Count snapshots still carrying the old bridge project id

```sql
SELECT COUNT(*) AS kb_snapshot_legacy_project_rows
FROM kb_snapshot
WHERE legacy_project_id IS NOT NULL;
```

### 2) Inspect sample rows that still depend on the old column

```sql
SELECT id, knowledge_base_id, deploy_hash, legacy_project_id, status, created_at, updated_at
FROM kb_snapshot
WHERE legacy_project_id IS NOT NULL
ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
LIMIT 50;
```

### 3) Check whether every such snapshot already has canonical deploy_log linkage

```sql
SELECT COUNT(*) AS missing_canonical_deploy_rows
FROM kb_snapshot ks
LEFT JOIN deploy_log dl
  ON dl.kb_snapshot_id = ks.id
WHERE ks.legacy_project_id IS NOT NULL
  AND dl.id IS NULL;
```

### 4) Check whether deploy_hash lookup is still the only thing linking old snapshots

```sql
SELECT COUNT(*) AS missing_deploy_hash_match_rows
FROM kb_snapshot ks
LEFT JOIN deploy_log dl
  ON dl.hash = ks.deploy_hash
WHERE ks.legacy_project_id IS NOT NULL
  AND dl.id IS NULL;
```

### 5) Check snapshots whose stored deploy_hash drifts from the canonical deployment linked by kb_snapshot_id

```sql
SELECT COUNT(*) AS stale_kb_snapshot_deploy_hash_rows
FROM kb_snapshot ks
JOIN deploy_log dl
  ON dl.kb_snapshot_id = ks.id
WHERE ks.legacy_project_id IS NOT NULL
  AND ks.deploy_hash IS NOT NULL
  AND dl.hash IS NOT NULL
  AND ks.deploy_hash <> dl.hash;
```

### 6) Inspect the snapshot deploy_hash drift rows before cutover

```sql
SELECT ks.id, ks.knowledge_base_id, ks.deploy_hash AS kb_snapshot_deploy_hash,
       dl.hash AS canonical_deploy_hash, dl.status, dl.updated_at
FROM kb_snapshot ks
JOIN deploy_log dl
  ON dl.kb_snapshot_id = ks.id
WHERE ks.legacy_project_id IS NOT NULL
  AND ks.deploy_hash IS NOT NULL
  AND dl.hash IS NOT NULL
  AND ks.deploy_hash <> dl.hash
ORDER BY dl.updated_at DESC NULLS LAST, dl.created_at DESC NULLS LAST
LIMIT 50;
```

### 7) Check dashboards that still need project / deploy_hash backfill from canonical deployment data

```sql
SELECT COUNT(*) AS dashboards_needing_runtime_backfill
FROM dashboard d
JOIN kb_snapshot ks ON ks.id = d.kb_snapshot_id
LEFT JOIN deploy_log dl ON dl.kb_snapshot_id = ks.id
WHERE d.kb_snapshot_id IS NOT NULL
  AND ks.legacy_project_id IS NOT NULL
  AND (
    (d.project_id IS NULL AND COALESCE(dl.project_id, ks.legacy_project_id) IS NOT NULL)
    OR (
      COALESCE(dl.hash, dl.deploy_hash) IS NOT NULL
      AND d.deploy_hash IS NOT NULL
      AND d.deploy_hash <> COALESCE(dl.hash, dl.deploy_hash)
    )
  );
```

### 8) Inspect the dashboards above before cutover

```sql
SELECT d.id, d.name, d.project_id, d.knowledge_base_id, d.kb_snapshot_id,
       d.deploy_hash AS dashboard_deploy_hash,
       ks.legacy_project_id,
       ks.deploy_hash AS kb_snapshot_deploy_hash,
       dl.project_id AS canonical_project_id,
       COALESCE(dl.hash, dl.deploy_hash) AS canonical_deploy_hash
FROM dashboard d
JOIN kb_snapshot ks ON ks.id = d.kb_snapshot_id
LEFT JOIN deploy_log dl ON dl.kb_snapshot_id = ks.id
WHERE d.kb_snapshot_id IS NOT NULL
  AND ks.legacy_project_id IS NOT NULL
  AND (
    (d.project_id IS NULL AND COALESCE(dl.project_id, ks.legacy_project_id) IS NOT NULL)
    OR (
      COALESCE(dl.hash, dl.deploy_hash) IS NOT NULL
      AND d.deploy_hash IS NOT NULL
      AND d.deploy_hash <> COALESCE(dl.hash, dl.deploy_hash)
    )
  )
ORDER BY d.updated_at DESC NULLS LAST, d.created_at DESC NULLS LAST
LIMIT 50;
```

## Cutover go / no-go checklist

You can safely remove the old schema column only when all of the following are true:

- `kb_snapshot.legacy_project_id` is fully unused, or a backfill/migration plan exists for every remaining row.
- Canonical `deploy_log.kb_snapshot_id` / `deploy_log.deploy_hash` lookups are sufficient for runtime resolution.
- `kb_snapshot.deploy_hash` and dashboard `deploy_hash` values are aligned with canonical deploy rows for any snapshot still carrying legacy bridge data.
- No active code path still depends on `kb_snapshot.legacy_project_id`.
- Dashboard execution is already aligned to dashboard runtime bindings / canonical deploy data and no longer depends on kb snapshot bridge fallbacks.

## Suggested implementation order once the audit is clean

1. Ship / run `wren-ui/migrations/20260409153000_backfill_dashboard_and_kb_snapshot_runtime_binding.js`.
2. Re-run the audit until dashboard / deploy-hash drift rows are clean. For direct PostgreSQL execution, you can use:
   - `bash misc/scripts/project-identity-kb-snapshot-backfill-rehearsal.sh "$PG_URL"`
   - Apply with backup via:
     - `bash misc/scripts/project-identity-kb-snapshot-backfill-apply.sh "$PG_URL"`
3. Ship / run `wren-ui/migrations/20260409170000_clear_kb_snapshot_legacy_project_id.js`.
4. Confirm `kb_snapshot.legacy_project_id` audit rows drop to zero.
5. Ship / run `wren-ui/migrations/20260409173000_drop_kb_snapshot_legacy_project_id.js`.
   - If you are executing directly against PostgreSQL outside Knex, apply the same closeout with backup via:
     - `bash misc/scripts/project-identity-kb-snapshot-drop-legacy-column.sh "$PG_URL"`
6. Confirm the column is gone from the target database schema.
   - PostgreSQL: `psql "$PG_URL" -c "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'kb_snapshot' ORDER BY ordinal_position;"`
7. Re-run repo checks:
   - `bash misc/scripts/scan-runtime-identity.sh`
   - `bash misc/scripts/inventory-project-identity.sh`
   - `cd wren-ui && yarn jest src/apollo/server/repositories/kbSnapshotRepository.test.ts --runInBand`
   - `cd wren-ui && yarn jest src/apollo/server/context/tests/runtimeScope.test.ts --runInBand`
   - `cd wren-ui && yarn jest src/apollo/server/utils/tests/dashboardRuntime.test.ts --runInBand`

## Rollback note

If Wave 3 fails after the clear/drop steps, restore the database backup first, then revert the cleanup migrations before retrying the schema cutover.
