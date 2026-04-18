import { Knex } from 'knex';
import crypto from 'crypto';
import { getConfig } from '../src/server/config';
import {
  PLATFORM_ADMIN_ROLE_NAME,
  PLATFORM_SCOPE_ID,
  toStructuredWorkspaceRoleName,
} from '../src/server/authz/roleMapping';
import { PrincipalRoleBindingRepository } from '../src/server/repositories/principalRoleBindingRepository';
import { RoleRepository } from '../src/server/repositories/roleRepository';
import { bootstrapKnex } from '../src/server/utils/knex';

interface CliOptions {
  execute: boolean;
  workspaceId?: string;
  help?: boolean;
}

interface Summary {
  execute: boolean;
  workspaceId?: string;
  scannedWorkspaceMembers: number;
  syncedWorkspaceMembers: number;
  scannedPlatformUsers: number;
  syncedPlatformUsers: number;
  scannedServiceAccounts: number;
  syncedServiceAccounts: number;
  scannedDirectoryGroups: number;
  unresolvedDirectoryGroups: number;
  notes: string[];
}

const HELP_TEXT = `Usage: yarn ts-node scripts/backfill_principal_role_bindings.ts [options]

Options:
  --workspace <id>      Optional. Only repair one workspace.
  --workspace-id <id>   Alias of --workspace.
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
  const options: CliOptions = { execute: false };

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

const normalizeRoleNames = (values: Array<string | null | undefined>) =>
  Array.from(
    new Set(
      values
        .map((value) =>
          String(value || '')
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
    ),
  ).sort();

const runWithOptionalTransaction = async (
  knex: Knex,
  execute: boolean,
  task: (trx?: Knex.Transaction) => Promise<void>,
) => {
  if (!execute) {
    await task(undefined);
    return;
  }

  await knex.transaction(async (trx) => {
    await task(trx);
  });
};

const syncScopedRoleBinding = async ({
  knex,
  roleRepository,
  principalRoleBindingRepository,
  principalType,
  principalId,
  scopeType,
  scopeId,
  roleName,
  execute,
  createdBy,
}: {
  knex: Knex;
  roleRepository: RoleRepository;
  principalRoleBindingRepository: PrincipalRoleBindingRepository;
  principalType: 'user' | 'service_account' | 'group';
  principalId: string;
  scopeType: 'workspace' | 'platform';
  scopeId: string;
  roleName: string | null;
  execute: boolean;
  createdBy?: string | null;
}) => {
  await runWithOptionalTransaction(knex, execute, async (trx) => {
    await principalRoleBindingRepository.deleteByScope(
      {
        principalType,
        principalId,
        scopeType,
        scopeId,
      },
      trx ? { tx: trx } : undefined,
    );

    if (!roleName) {
      return;
    }

    const [role] = await roleRepository.findByNames(
      [roleName],
      trx ? { tx: trx } : undefined,
    );
    if (!role) {
      throw new Error(`Role ${roleName} is not seeded`);
    }

    if (!execute) {
      return;
    }

    await trx!('principal_role_binding').insert({
      id: crypto.randomUUID(),
      principal_type: principalType,
      principal_id: principalId,
      role_id: role.id,
      scope_type: scopeType,
      scope_id: scopeId,
      created_by: createdBy || null,
    });
  });
};

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

  const summary: Summary = {
    execute: options.execute,
    workspaceId: options.workspaceId,
    scannedWorkspaceMembers: 0,
    syncedWorkspaceMembers: 0,
    scannedPlatformUsers: 0,
    syncedPlatformUsers: 0,
    scannedServiceAccounts: 0,
    syncedServiceAccounts: 0,
    scannedDirectoryGroups: 0,
    unresolvedDirectoryGroups: 0,
    notes: [],
  };

  try {
    const workspaceMembers = await knex('workspace_member')
      .modify((query: Knex.QueryBuilder) => {
        if (options.workspaceId) {
          query.where('workspace_id', options.workspaceId);
        }
      })
      .select('id', 'workspace_id', 'user_id', 'role_key', 'status');

    summary.scannedWorkspaceMembers = workspaceMembers.length;

    for (const membership of workspaceMembers) {
      const currentBindings =
        await principalRoleBindingRepository.findResolvedRoleBindings({
          principalType: 'user',
          principalId: membership.user_id,
          scopeType: 'workspace',
          scopeId: membership.workspace_id,
        });
      const currentRoleNames = normalizeRoleNames(
        currentBindings.map((binding) => binding.roleName),
      );

      const roleName =
        membership.status === 'active'
          ? toStructuredWorkspaceRoleName(membership.role_key)
          : null;
      await syncScopedRoleBinding({
        knex,
        roleRepository,
        principalRoleBindingRepository,
        principalType: 'user',
        principalId: membership.user_id,
        scopeType: 'workspace',
        scopeId: membership.workspace_id,
        roleName,
        execute: options.execute,
        createdBy: membership.user_id,
      });

      const nextBindings =
        membership.status === 'active'
          ? normalizeRoleNames([
              toStructuredWorkspaceRoleName(membership.role_key),
            ])
          : [];
      if (JSON.stringify(currentRoleNames) !== JSON.stringify(nextBindings)) {
        summary.syncedWorkspaceMembers += 1;
      }
    }

    const users = await knex('user')
      .modify((query: Knex.QueryBuilder) => {
        if (options.workspaceId) {
          query.whereExists(
            knex('workspace_member')
              .select(1)
              .whereRaw('"workspace_member"."user_id" = "user"."id"')
              .andWhere('workspace_member.workspace_id', options.workspaceId),
          );
        }
      })
      .select('id', 'is_platform_admin');

    summary.scannedPlatformUsers = users.length;

    for (const user of users) {
      const currentBindings =
        await principalRoleBindingRepository.findResolvedRoleBindings({
          principalType: 'user',
          principalId: user.id,
          scopeType: 'platform',
          scopeId: PLATFORM_SCOPE_ID,
        });
      const currentRoleNames = normalizeRoleNames(
        currentBindings.map((binding) => binding.roleName),
      );

      await syncScopedRoleBinding({
        knex,
        roleRepository,
        principalRoleBindingRepository,
        principalType: 'user',
        principalId: user.id,
        scopeType: 'platform',
        scopeId: PLATFORM_SCOPE_ID,
        roleName: Boolean(user.is_platform_admin)
          ? PLATFORM_ADMIN_ROLE_NAME
          : null,
        execute: options.execute,
        createdBy: user.id,
      });

      const nextBindings = Boolean(user.is_platform_admin)
        ? ['platform_admin']
        : [];
      if (JSON.stringify(currentRoleNames) !== JSON.stringify(nextBindings)) {
        summary.syncedPlatformUsers += 1;
      }
    }

    const serviceAccounts = await knex('service_account')
      .modify((query: Knex.QueryBuilder) => {
        if (options.workspaceId) {
          query.where('workspace_id', options.workspaceId);
        }
      })
      .select('id', 'workspace_id', 'role_key', 'status', 'created_by');

    summary.scannedServiceAccounts = serviceAccounts.length;

    for (const serviceAccount of serviceAccounts) {
      const currentBindings =
        await principalRoleBindingRepository.findResolvedRoleBindings({
          principalType: 'service_account',
          principalId: serviceAccount.id,
          scopeType: 'workspace',
          scopeId: serviceAccount.workspace_id,
        });
      const currentRoleNames = normalizeRoleNames(
        currentBindings.map((binding) => binding.roleName),
      );

      await syncScopedRoleBinding({
        knex,
        roleRepository,
        principalRoleBindingRepository,
        principalType: 'service_account',
        principalId: serviceAccount.id,
        scopeType: 'workspace',
        scopeId: serviceAccount.workspace_id,
        roleName:
          serviceAccount.status === 'active'
            ? toStructuredWorkspaceRoleName(serviceAccount.role_key)
            : null,
        execute: options.execute,
        createdBy: serviceAccount.created_by || null,
      });

      const nextBindings =
        serviceAccount.status === 'active'
          ? normalizeRoleNames([
              toStructuredWorkspaceRoleName(serviceAccount.role_key),
            ])
          : [];
      if (JSON.stringify(currentRoleNames) !== JSON.stringify(nextBindings)) {
        summary.syncedServiceAccounts += 1;
      }
    }

    const directoryGroups = await knex('directory_group')
      .modify((query: Knex.QueryBuilder) => {
        if (options.workspaceId) {
          query.where('workspace_id', options.workspaceId);
        }
      })
      .select('id', 'workspace_id', 'display_name', 'source', 'status');

    summary.scannedDirectoryGroups = directoryGroups.length;

    for (const group of directoryGroups) {
      const currentBindings =
        await principalRoleBindingRepository.findResolvedRoleBindings({
          principalType: 'group',
          principalId: group.id,
          scopeType: 'workspace',
          scopeId: group.workspace_id,
        });

      if (currentBindings.length === 0) {
        summary.unresolvedDirectoryGroups += 1;
        summary.notes.push(
          `Directory group ${group.display_name} (${group.id}) has no role binding; cannot auto-recover roleKey because it is not stored on directory_group.`,
        );
      }
    }

    console.log(JSON.stringify(summary, null, 2));
    if (!options.execute) {
      console.log(
        '\nDry-run only. Re-run with --execute to persist the binding repair.',
      );
    }
  } finally {
    await knex.destroy();
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
