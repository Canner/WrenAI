import crypto from 'crypto';
import { Knex } from 'knex';
import {
  IPrincipalRoleBindingRepository,
  IRoleRepository,
  User,
  WorkspaceMember,
} from '@server/repositories';
import {
  PLATFORM_ADMIN_ROLE_NAME,
  PLATFORM_SCOPE_ID,
  toStructuredWorkspaceRoleName,
} from './roleMapping';

interface BindingSyncDeps {
  roleRepository: IRoleRepository;
  principalRoleBindingRepository: IPrincipalRoleBindingRepository;
}

interface BindingSyncOptions extends BindingSyncDeps {
  tx?: Knex.Transaction;
  createdBy?: string | null;
}

const createScopedRoleBinding = async ({
  principalRoleBindingRepository,
  roleRepository,
  principalType,
  principalId,
  roleName,
  scopeType,
  scopeId,
  tx,
  createdBy,
}: BindingSyncOptions & {
  principalType: 'user' | 'service_account' | 'group';
  principalId: string;
  roleName: string;
  scopeType: string;
  scopeId: string;
}) => {
  const [role] = await roleRepository.findByNames(
    [roleName],
    tx ? { tx } : undefined,
  );
  if (!role) {
    throw new Error(`Role ${roleName} is not seeded`);
  }

  await principalRoleBindingRepository.createOne(
    {
      id: crypto.randomUUID(),
      principalType,
      principalId,
      roleId: role.id,
      scopeType,
      scopeId,
      createdBy: createdBy || null,
    },
    tx ? { tx } : undefined,
  );
};

export const syncWorkspaceMemberRoleBinding = async ({
  membership,
  roleRepository,
  principalRoleBindingRepository,
  tx,
  createdBy,
}: BindingSyncOptions & {
  membership: WorkspaceMember;
}) => {
  const scope = {
    principalType: 'user',
    principalId: membership.userId,
    scopeType: 'workspace',
    scopeId: membership.workspaceId,
  };

  await principalRoleBindingRepository.deleteByScope(
    scope,
    tx ? { tx } : undefined,
  );
  if (membership.status !== 'active') {
    return;
  }

  const structuredRoleName = toStructuredWorkspaceRoleName(membership.roleKey);
  if (!structuredRoleName) {
    throw new Error(
      `Workspace member role ${membership.roleKey} cannot be mapped`,
    );
  }

  await createScopedRoleBinding({
    roleRepository,
    principalRoleBindingRepository,
    principalType: 'user',
    principalId: membership.userId,
    roleName: structuredRoleName,
    scopeType: 'workspace',
    scopeId: membership.workspaceId,
    tx,
    createdBy,
  });
};

export const removeWorkspacePrincipalRoleBindings = async ({
  workspaceId,
  principalId,
  principalType = 'user',
  principalRoleBindingRepository,
  tx,
}: Pick<BindingSyncOptions, 'principalRoleBindingRepository' | 'tx'> & {
  workspaceId: string;
  principalId: string;
  principalType?: 'user' | 'service_account' | 'group';
}) => {
  await principalRoleBindingRepository.deleteByScope(
    {
      principalType,
      principalId,
      scopeType: 'workspace',
      scopeId: workspaceId,
    },
    tx ? { tx } : undefined,
  );
};

export const syncPlatformAdminRoleBinding = async ({
  user,
  roleRepository,
  principalRoleBindingRepository,
  tx,
  createdBy,
}: BindingSyncOptions & {
  user: Pick<User, 'id' | 'isPlatformAdmin'>;
}) => {
  const scope = {
    principalType: 'user',
    principalId: user.id,
    scopeType: 'platform',
    scopeId: PLATFORM_SCOPE_ID,
  };

  await principalRoleBindingRepository.deleteByScope(
    scope,
    tx ? { tx } : undefined,
  );
  if (!user.isPlatformAdmin) {
    return;
  }

  await createScopedRoleBinding({
    roleRepository,
    principalRoleBindingRepository,
    principalType: 'user',
    principalId: user.id,
    roleName: PLATFORM_ADMIN_ROLE_NAME,
    scopeType: 'platform',
    scopeId: PLATFORM_SCOPE_ID,
    tx,
    createdBy,
  });
};

export const syncWorkspaceScopedRoleBinding = async ({
  principalType,
  principalId,
  workspaceId,
  roleKey,
  isActive = true,
  roleRepository,
  principalRoleBindingRepository,
  tx,
  createdBy,
}: BindingSyncOptions & {
  principalType: 'user' | 'service_account' | 'group';
  principalId: string;
  workspaceId: string;
  roleKey: string;
  isActive?: boolean;
}) => {
  await removeWorkspacePrincipalRoleBindings({
    workspaceId,
    principalId,
    principalType,
    principalRoleBindingRepository,
    tx,
  });
  if (!isActive) {
    return;
  }

  const structuredRoleName = toStructuredWorkspaceRoleName(roleKey);
  if (!structuredRoleName) {
    throw new Error(`Workspace role ${roleKey} cannot be mapped`);
  }

  await createScopedRoleBinding({
    roleRepository,
    principalRoleBindingRepository,
    principalType,
    principalId,
    roleName: structuredRoleName,
    scopeType: 'workspace',
    scopeId: workspaceId,
    tx,
    createdBy,
  });
};
