import { Knex } from 'knex';
import { getConfig } from '../src/server/config';
import { syncWorkspaceMemberRoleBinding } from '../src/server/authz/bindingSync';
import { PrincipalRoleBindingRepository } from '../src/server/repositories/principalRoleBindingRepository';
import { RoleRepository } from '../src/server/repositories/roleRepository';
import { bootstrapKnex } from '../src/server/utils/knex';

interface CliOptions {
  execute: boolean;
  workspaceId?: string;
  useViewerKey: boolean;
  help?: boolean;
}

interface WorkspaceMemberRow {
  id: string;
  workspaceId: string;
  userId: string;
  roleKey: string;
  status: string;
}

const HELP_TEXT = `Usage: yarn migrate:workspace-roles-owner-viewer [options]

Options:
  --workspace <id>      Optional. Only migrate one workspace.
  --workspace-id <id>   Alias of --workspace.
  --use-viewer-key      Persist member/viewer rows as viewer instead of legacy member.
  --execute             Persist changes. Default is dry-run.
  --dry-run             Preview only. This is the default.
  --help                Show this message.
`;

const readValue = (args: string[], index: number, flag: string) => {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
};

const parseCliArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = {
    execute: false,
    useViewerKey: false,
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
      case '--use-viewer-key':
        options.useViewerKey = true;
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

const normalizeStoredRoleKey = (
  roleKey: string,
  useViewerKey: boolean,
): string => {
  const normalized = String(roleKey || '')
    .trim()
    .toLowerCase();
  if (normalized === 'admin') {
    return 'owner';
  }
  if (normalized === 'viewer') {
    return useViewerKey ? 'viewer' : 'member';
  }
  if (normalized === 'member') {
    return useViewerKey ? 'viewer' : 'member';
  }
  return normalized || 'member';
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
  const roleRepository = new RoleRepository(knex);
  const principalRoleBindingRepository = new PrincipalRoleBindingRepository(
    knex,
  );

  try {
    const workspaceMembers = (await knex('workspace_member')
      .modify((query: Knex.QueryBuilder) => {
        if (options.workspaceId) {
          query.where('workspace_id', options.workspaceId);
        }
      })
      .select(
        'id as id',
        'workspace_id as workspaceId',
        'user_id as userId',
        'role_key as roleKey',
        'status as status',
      )) as WorkspaceMemberRow[];

    const migrationPlan = workspaceMembers.map((membership) => {
      const nextRoleKey = normalizeStoredRoleKey(
        membership.roleKey,
        options.useViewerKey,
      );
      return {
        ...membership,
        nextRoleKey,
        changed: nextRoleKey !== membership.roleKey,
      };
    });

    if (options.execute) {
      await knex.transaction(async (trx: Knex.Transaction) => {
        for (const membership of migrationPlan) {
          if (membership.changed) {
            await trx('workspace_member')
              .where({ id: membership.id })
              .update({ role_key: membership.nextRoleKey });
          }

          await syncWorkspaceMemberRoleBinding({
            membership: {
              id: membership.id,
              workspaceId: membership.workspaceId,
              userId: membership.userId,
              roleKey: membership.nextRoleKey,
              status: membership.status,
            } as any,
            roleRepository,
            principalRoleBindingRepository,
            tx: trx,
            createdBy: membership.userId,
          });
        }
      });
    }

    const summary = {
      execute: options.execute,
      workspaceId: options.workspaceId || null,
      useViewerKey: options.useViewerKey,
      scannedWorkspaceMembers: workspaceMembers.length,
      changedWorkspaceMembers: migrationPlan.filter((item) => item.changed)
        .length,
      changeBreakdown: {
        adminToOwner: migrationPlan.filter(
          (item) => item.roleKey === 'admin' && item.nextRoleKey === 'owner',
        ).length,
        memberToViewer: migrationPlan.filter(
          (item) => item.roleKey === 'member' && item.nextRoleKey === 'viewer',
        ).length,
        viewerToMemberCompatibility: migrationPlan.filter(
          (item) => item.roleKey === 'viewer' && item.nextRoleKey === 'member',
        ).length,
      },
      resultingRoleDistribution: countBy(
        migrationPlan,
        (item) => item.nextRoleKey,
      ),
      syncedWorkspaceBindings: migrationPlan.length,
      plannedChanges: migrationPlan
        .filter((item) => item.changed)
        .map((item) => ({
          id: item.id,
          workspaceId: item.workspaceId,
          userId: item.userId,
          from: item.roleKey,
          to: item.nextRoleKey,
          status: item.status,
        })),
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
