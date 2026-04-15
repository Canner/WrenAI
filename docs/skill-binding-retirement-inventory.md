# Skill binding retirement inventory (2026-04-10)

## Summary

- Runtime / main-path code should no longer depend on legacy `skill_binding`.
- Remaining references should be limited to historical migrations, backfill / audit assets, and archival design docs.
- Refresh with: `bash misc/scripts/inventory-skill-binding-residuals.sh > docs/skill-binding-retirement-inventory.md`
- Guardrail with: `bash misc/scripts/check-skill-binding-main-path.sh`
- SQL readiness audit: `misc/sql/skill-binding-retirement-readiness.sql`

## active runtime / main-path code

hit-count: 0
sample-files: none

## historical schema migrations

hit-count: 17
sample-files:

- wren-ui/migrations/20260401150002_create_connector_skill_governance_tables.js
- wren-ui/migrations/20260410122000_drop_legacy_skill_binding.js
- wren-ui/migrations/20260410120020_mark_skill_binding_legacy.js

exact-matches:

- wren-ui/migrations/20260401150002_create_connector_skill_governance_tables.js:79: await knex.schema.createTable('skill_binding', (table) => {
- wren-ui/migrations/20260401150002_create_connector_skill_governance_tables.js:204: await knex.schema.dropTableIfExists('skill_binding');
- wren-ui/migrations/20260410122000_drop_legacy_skill_binding.js:5: 'Recreated by rollback of 20260410122000_drop_legacy_skill_binding. Legacy binding rows are not restored automatically.';
- wren-ui/migrations/20260410122000_drop_legacy_skill_binding.js:20: 'Cannot drop skill_binding before skill_definition.migration_source_binding_id exists.',
- wren-ui/migrations/20260410122000_drop_legacy_skill_binding.js:42: `Cannot drop skill_binding: found ${duplicateCount} duplicated migration_source_binding_id values in skill_definition.`,
- wren-ui/migrations/20260410122000_drop_legacy_skill_binding.js:62: FROM skill_binding AS sb
- wren-ui/migrations/20260410122000_drop_legacy_skill_binding.js:69: FROM skill_binding AS sb
- wren-ui/migrations/20260410122000_drop_legacy_skill_binding.js:86: `Cannot drop skill_binding: found ${incompleteGroupCount} skill definitions whose legacy binding groups have not been fully materialized into runtime skills.`,
- wren-ui/migrations/20260410122000_drop_legacy_skill_binding.js:99: FROM skill_binding AS sb
- wren-ui/migrations/20260410122000_drop_legacy_skill_binding.js:112: `Cannot drop skill_binding: found ${missingRuntimeSettingsCount} skill definitions with legacy bindings but missing runtime settings on skill_definition.`,
- wren-ui/migrations/20260410122000_drop_legacy_skill_binding.js:122: const hasSkillBindingTable = await knex.schema.hasTable('skill_binding');
- wren-ui/migrations/20260410122000_drop_legacy_skill_binding.js:132: await knex.schema.dropTable('skill_binding');
- wren-ui/migrations/20260410122000_drop_legacy_skill_binding.js:140: const hasSkillBindingTable = await knex.schema.hasTable('skill_binding');
- wren-ui/migrations/20260410122000_drop_legacy_skill_binding.js:145: await knex.schema.createTable('skill_binding', (table) => {
- wren-ui/migrations/20260410122000_drop_legacy_skill_binding.js:181: COMMENT ON TABLE skill_binding IS
- wren-ui/migrations/20260410120020_mark_skill_binding_legacy.js:7: COMMENT ON TABLE skill_binding IS
- wren-ui/migrations/20260410120020_mark_skill_binding_legacy.js:18: COMMENT ON TABLE skill_binding IS NULL;

## backfill / audit operations

hit-count: 13
sample-files:

- misc/scripts/check-skill-binding-main-path.sh
- wren-ui/scripts/migrate_skill_bindings_to_runtime_skills.test.ts
- misc/sql/skill-binding-retirement-readiness.sql
- wren-ui/scripts/migrate_skill_bindings_to_runtime_skills.ts

exact-matches:

- misc/scripts/check-skill-binding-main-path.sh:8:PATTERN='listSkillBindingsByKnowledgeBase|/api/v1/skills/bindings|skillBindings\b'
- wren-ui/scripts/migrate_skill_bindings_to_runtime_skills.test.ts:5:} from './migrate_skill_bindings_to_runtime_skills';
- wren-ui/scripts/migrate_skill_bindings_to_runtime_skills.test.ts:7:describe('migrate_skill_bindings_to_runtime_skills', () => {
- misc/sql/skill-binding-retirement-readiness.sql:4:-- final migration that drops the legacy skill_binding table.
- misc/sql/skill-binding-retirement-readiness.sql:7:SELECT COUNT(\*) AS total_skill_binding_rows
- misc/sql/skill-binding-retirement-readiness.sql:8:FROM skill_binding;
- misc/sql/skill-binding-retirement-readiness.sql:29: FROM skill_binding AS sb
- misc/sql/skill-binding-retirement-readiness.sql:36: FROM skill_binding AS sb
- misc/sql/skill-binding-retirement-readiness.sql:65: FROM skill_binding AS sb
- misc/sql/skill-binding-retirement-readiness.sql:107:FROM skill_binding AS sb
- wren-ui/scripts/migrate_skill_bindings_to_runtime_skills.ts:63:const HELP_TEXT = `Usage: yarn ts-node scripts/migrate_skill_bindings_to_runtime_skills.ts [options]
- wren-ui/scripts/migrate_skill_bindings_to_runtime_skills.ts:269: const bindings = await trx<SkillBindingRow>('skill_binding')
- wren-ui/scripts/migrate_skill_bindings_to_runtime_skills.ts:397: console.error(`migrate_skill_bindings_to_runtime_skills failed: ${error.message}`);

## docs / archival plans

hit-count: 65
sample-files:

- docs/archive/skill-architecture-plan-v2-wave3-wave4-file-breakdown.md
- docs/phase3-next-stage-implementation-plan.md
- docs/archive/skill-architecture-plan-v2.md
- docs/skill-binding-retirement-checklist.md
- docs/archive/skill-architecture-plan-v2-implementation-checklist.md

## Notes

- **active runtime / main-path code** should stay at **0**. Any new hit there is a regression.
- **historical schema migrations** are expected to remain in git history; final table retirement should happen via a new drop migration instead of deleting old migration files.
- **backfill / audit operations** remain intentional until the legacy table is fully retired and the final PostgreSQL cutover has been rehearsed.
- **docs / archival plans** may continue to mention legacy bindings for historical context, but should not describe them as the current main path.
