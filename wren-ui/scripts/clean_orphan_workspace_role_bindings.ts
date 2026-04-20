import { Knex } from 'knex';
import { getConfig } from '../src/server/config';
import { bootstrapKnex } from '../src/server/utils/knex';

interface CliOptions {
  execute: boolean;
  help?: boolean;
}

interface OrphanBindingRow {
  id: string;
  principalType: string;
  principalId: string;
  scopeType: string;
  scopeId: string;
  roleName: string | null;
}

const HELP_TEXT = `Usage: yarn repair:orphan-workspace-bindings [options]

Options:
  --execute    Persist deletions. Default is dry-run.
  --dry-run    Preview only. This is the default.
  --help       Show this message.
`;

const parseCliArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = { execute: false };

  argv.forEach((arg) => {
    switch (arg) {
      case '--execute':
        options.execute = true;
        break;
      case '--dry-run':
        options.execute = false;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  });

  return options;
};

const countBy = <T, K extends string>(
  items: T[],
  getKey: (item: T) => K,
): Record<K, number> =>
  items.reduce<Record<K, number>>(
    (acc, item) => {
      const key = getKey(item);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    },
    {} as Record<K, number>,
  );

const main = async () => {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP_TEXT);
    return;
  }

  const knex = bootstrapKnex({
    pgUrl: getConfig().pgUrl,
    debug: getConfig().debug,
  });

  try {
    const workspaceScopeBindings = (await knex({
      binding: 'principal_role_binding',
    })
      .leftJoin({ role: 'role' }, 'binding.role_id', 'role.id')
      .leftJoin({ workspace: 'workspace' }, 'binding.scope_id', 'workspace.id')
      .where('binding.scope_type', 'workspace')
      .select(
        'binding.id as id',
        'binding.principal_type as principalType',
        'binding.principal_id as principalId',
        'binding.scope_type as scopeType',
        'binding.scope_id as scopeId',
        'role.name as roleName',
        'workspace.id as workspaceId',
      )) as Array<OrphanBindingRow & { workspaceId?: string | null }>;

    const orphanBindings = workspaceScopeBindings.filter(
      (binding) => !binding.workspaceId,
    );

    if (options.execute && orphanBindings.length > 0) {
      await knex.transaction(async (trx: Knex.Transaction) => {
        await trx('principal_role_binding')
          .whereIn(
            'id',
            orphanBindings.map((binding) => binding.id),
          )
          .delete();
      });
    }

    const summary = {
      execute: options.execute,
      scannedWorkspaceBindings: workspaceScopeBindings.length,
      orphanBindingCount: orphanBindings.length,
      orphanBindingsByPrincipalType: countBy(
        orphanBindings,
        (binding) => binding.principalType,
      ),
      orphanBindingsByRole: countBy(orphanBindings, (binding) =>
        String(binding.roleName || 'unknown'),
      ),
      orphanBindingIds: orphanBindings.map((binding) => binding.id),
    };

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await knex.destroy();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
