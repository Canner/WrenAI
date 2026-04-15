import crypto from 'crypto';
import process from 'process';
import { Knex } from 'knex';
import { getConfig } from '../src/apollo/server/config';
import { bootstrapKnex } from '../src/apollo/server/utils/knex';

type InstalledFrom =
  | 'custom'
  | 'marketplace'
  | 'builtin'
  | 'migrated_from_binding';

interface CliOptions {
  execute: boolean;
  workspaceId?: string;
  help?: boolean;
}

interface SkillDefinitionRow {
  id: string;
  workspace_id: string;
  name: string;
  runtime_kind: string;
  source_type: string;
  source_ref?: string | null;
  entrypoint?: string | null;
  manifest_json?: Record<string, any> | null;
  catalog_id?: string | null;
  instruction?: string | null;
  is_enabled?: boolean | null;
  execution_mode?: string | null;
  connector_id?: string | null;
  runtime_config_json?: Record<string, any> | null;
  kb_suggestion_ids?: string[] | null;
  installed_from?: InstalledFrom | null;
  migration_source_binding_id?: string | null;
  secret_record_id?: string | null;
  created_by?: string | null;
}

interface SkillBindingRow {
  id: string;
  knowledge_base_id: string;
  kb_snapshot_id?: string | null;
  skill_definition_id: string;
  connector_id?: string | null;
  binding_config?: Record<string, any> | null;
  enabled: boolean;
  created_by?: string | null;
}

interface MigrationSummary {
  execute: boolean;
  workspaceId?: string;
  scannedSkills: number;
  skillsWithBindings: number;
  updatedSkills: number;
  createdClones: number;
  skippedSkills: number;
  notes: string[];
}

const HELP_TEXT = `Usage: yarn ts-node scripts/migrate_skill_bindings_to_runtime_skills.ts [options]

Options:
  --workspace <id>   Optional. Only migrate one workspace.
  --workspace-id <id> Alias of --workspace.
  --execute          Persist changes. Default is dry-run.
  --dry-run          Preview only. This is the default.
  --help             Show this message.
`;

const readValue = (args: string[], index: number, flag: string) => {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
};

export const parseCliArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = {
    execute: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case '--execute':
        options.execute = true;
        break;
      case '--dry-run':
        options.execute = false;
        break;
      case '--workspace':
      case '--workspace-id':
        options.workspaceId = readValue(argv, index, arg);
        index += 1;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
};

const normalizeJson = (value: any): any => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJson(item));
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, any>>((accumulator, key) => {
        accumulator[key] = normalizeJson(value[key]);
        return accumulator;
      }, {});
  }

  return value ?? null;
};

const stableStringify = (value: any) => JSON.stringify(normalizeJson(value));

export const buildBindingSignature = (binding: SkillBindingRow) =>
  stableStringify({
    connectorId: binding.connector_id ?? null,
    bindingConfig: binding.binding_config ?? null,
    enabled: binding.enabled ?? true,
    kbSnapshotId: binding.kb_snapshot_id ?? null,
  });

export const groupBindingsBySignature = (bindings: SkillBindingRow[]) => {
  const grouped = new Map<
    string,
    {
      signature: string;
      bindings: SkillBindingRow[];
    }
  >();

  bindings.forEach((binding) => {
    const signature = buildBindingSignature(binding);
    const current = grouped.get(signature) || { signature, bindings: [] };
    current.bindings.push(binding);
    grouped.set(signature, current);
  });

  return Array.from(grouped.values())
    .map((group) => ({
      ...group,
      bindings: [...group.bindings].sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
    }))
    .sort((left, right) =>
      left.bindings[0].id.localeCompare(right.bindings[0].id),
    );
};

const uniqueKnowledgeBaseIds = (bindings: SkillBindingRow[]) =>
  Array.from(new Set(bindings.map((binding) => binding.knowledge_base_id)));

const reserveCloneName = (
  names: Set<string>,
  baseName: string,
  binding: SkillBindingRow,
) => {
  const kbHint = binding.knowledge_base_id.slice(0, 8);
  const snapshotHint = binding.kb_snapshot_id
    ? ` @ ${binding.kb_snapshot_id.slice(0, 8)}`
    : '';
  const normalizedBaseName = baseName.trim() || 'skill';
  let candidate = `${normalizedBaseName} · ${kbHint}${snapshotHint}`;
  let attempt = 2;

  while (names.has(candidate)) {
    candidate = `${normalizedBaseName} · ${kbHint}${snapshotHint} (${attempt})`;
    attempt += 1;
  }

  names.add(candidate);
  return candidate;
};

const buildRuntimePatch = (
  baseSkill: SkillDefinitionRow,
  bindings: SkillBindingRow[],
  migrationSourceBindingId?: string | null,
) => ({
  connector_id: bindings[0]?.connector_id ?? null,
  runtime_config_json: bindings[0]?.binding_config ?? null,
  is_enabled: bindings[0]?.enabled ?? baseSkill.is_enabled ?? true,
  kb_suggestion_ids: uniqueKnowledgeBaseIds(bindings),
  migration_source_binding_id: migrationSourceBindingId ?? null,
});

const updateSkillDefinition = async (
  trx: Knex.Transaction,
  skillId: string,
  patch: Record<string, any>,
  execute: boolean,
) => {
  if (!execute || Object.keys(patch).length === 0) {
    return;
  }

  await trx('skill_definition')
    .where({ id: skillId })
    .update({
      ...patch,
      updated_at: trx.fn.now(),
    });
};

const insertSkillDefinitionClone = async (
  trx: Knex.Transaction,
  payload: Record<string, any>,
  execute: boolean,
) => {
  if (!execute) {
    return;
  }

  await trx('skill_definition').insert(payload);
};

export const runMigration = async (
  knex: Knex,
  options: CliOptions,
): Promise<MigrationSummary> => {
  const summary: MigrationSummary = {
    execute: options.execute,
    workspaceId: options.workspaceId,
    scannedSkills: 0,
    skillsWithBindings: 0,
    updatedSkills: 0,
    createdClones: 0,
    skippedSkills: 0,
    notes: [],
  };

  const skillDefinitionsQuery = knex<SkillDefinitionRow>('skill_definition')
    .select('*')
    .orderBy(['workspace_id', 'name', 'id']);

  if (options.workspaceId) {
    skillDefinitionsQuery.where({ workspace_id: options.workspaceId });
  }

  const skillDefinitions = await skillDefinitionsQuery;
  summary.scannedSkills = skillDefinitions.length;

  await knex.transaction(async (trx) => {
    const workspaceDefinitions = new Map<string, SkillDefinitionRow[]>();

    skillDefinitions.forEach((definition) => {
      const current = workspaceDefinitions.get(definition.workspace_id) || [];
      current.push(definition);
      workspaceDefinitions.set(definition.workspace_id, current);
    });

    for (const skillDefinition of skillDefinitions) {
      const bindings = await trx<SkillBindingRow>('skill_binding')
        .select('*')
        .where({ skill_definition_id: skillDefinition.id })
        .orderBy(['knowledge_base_id', 'kb_snapshot_id', 'id']);

      if (bindings.length === 0) {
        if (
          skillDefinition.runtime_config_json == null &&
          skillDefinition.manifest_json != null
        ) {
          await updateSkillDefinition(
            trx,
            skillDefinition.id,
            {
              runtime_config_json: skillDefinition.manifest_json,
            },
            options.execute,
          );
          summary.updatedSkills += 1;
        } else {
          summary.skippedSkills += 1;
        }
        continue;
      }

      summary.skillsWithBindings += 1;

      const groupedBindings = groupBindingsBySignature(bindings);
      const primaryGroup = groupedBindings[0];
      const runtimePatch = buildRuntimePatch(
        skillDefinition,
        primaryGroup.bindings,
        primaryGroup.bindings.length === 1 ? primaryGroup.bindings[0].id : null,
      );

      await updateSkillDefinition(
        trx,
        skillDefinition.id,
        runtimePatch,
        options.execute,
      );
      summary.updatedSkills += 1;

      const workspaceSkillDefinitions =
        workspaceDefinitions.get(skillDefinition.workspace_id) || [];
      const usedNames = new Set(
        workspaceSkillDefinitions.map((item) => item.name),
      );

      for (const group of groupedBindings.slice(1)) {
        const existingClone = workspaceSkillDefinitions.find(
          (candidate) =>
            candidate.id !== skillDefinition.id &&
            group.bindings.some(
              (binding) => candidate.migration_source_binding_id === binding.id,
            ),
        );

        const patch = buildRuntimePatch(
          skillDefinition,
          group.bindings,
          existingClone?.migration_source_binding_id || group.bindings[0].id,
        );

        if (existingClone) {
          await updateSkillDefinition(
            trx,
            existingClone.id,
            patch,
            options.execute,
          );
          summary.updatedSkills += 1;
          continue;
        }

        const clone: SkillDefinitionRow = {
          ...skillDefinition,
          id: crypto.randomUUID(),
          name: reserveCloneName(
            usedNames,
            skillDefinition.name,
            group.bindings[0],
          ),
          connector_id: patch.connector_id,
          runtime_config_json: patch.runtime_config_json,
          is_enabled: patch.is_enabled,
          kb_suggestion_ids: patch.kb_suggestion_ids,
          installed_from: 'migrated_from_binding',
          migration_source_binding_id: patch.migration_source_binding_id,
          created_by:
            group.bindings[0].created_by || skillDefinition.created_by || null,
        };

        await insertSkillDefinitionClone(
          trx,
          {
            ...clone,
            created_at: trx.fn.now(),
            updated_at: trx.fn.now(),
          },
          options.execute,
        );
        workspaceSkillDefinitions.push(clone);
        summary.createdClones += 1;
      }
    }
  });

  summary.notes.push(
    options.execute
      ? 'Migration executed against PostgreSQL.'
      : 'Dry-run completed. No rows were persisted.',
  );
  summary.notes.push(
    'migration_source_binding_id is used as the idempotency key for cloned runtime skills.',
  );

  return summary;
};

export const runCli = async (argv: string[]) => {
  const options = parseCliArgs(argv);
  if (options.help) {
    console.log(HELP_TEXT);
    return;
  }

  const config = getConfig();
  const knex = bootstrapKnex({
    pgUrl: config.pgUrl,
    debug: config.debug,
  });

  try {
    const summary = await runMigration(knex, options);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await knex.destroy();
  }
};

if (require.main === module) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(
      `migrate_skill_bindings_to_runtime_skills failed: ${error.message}`,
    );
    process.exitCode = 1;
  });
}
