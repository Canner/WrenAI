import crypto from 'crypto';
import {
  removeWorkspacePrincipalRoleBindings,
  syncWorkspaceScopedRoleBinding,
} from '@server/authz';
import { DirectoryGroup, DirectoryGroupMember } from '@server/repositories';
import {
  DirectoryGroupWithMembers,
  GovernanceServiceDependencies,
} from './governanceServiceTypes';
import {
  requireGovernanceWorkspace,
  requireWorkspace,
} from './governanceServiceSupport';

export const listDirectoryGroups = async (
  workspaceId: string,
  deps: GovernanceServiceDependencies,
): Promise<DirectoryGroupWithMembers[]> => {
  await requireWorkspace(workspaceId, deps);
  const [groups, members] = await Promise.all([
    requireDirectoryGroupRepository(deps).findAllBy(
      { workspaceId },
      { order: 'created_at desc' },
    ),
    requireDirectoryGroupMemberRepository(deps).findAllBy(
      { workspaceId },
      { order: 'created_at asc' },
    ),
  ]);

  const membersByGroupId = members.reduce<
    Record<string, DirectoryGroupMember[]>
  >((acc, item) => {
    acc[item.directoryGroupId] = acc[item.directoryGroupId] || [];
    acc[item.directoryGroupId].push(item);
    return acc;
  }, {});
  const roleKeysByGroupId = await listDirectoryGroupRoleKeys(groups, deps);

  return groups.map((group) => ({
    ...group,
    members: membersByGroupId[group.id] || [],
    roleKeys: roleKeysByGroupId[group.id] || [],
  }));
};

export const createDirectoryGroup = async (
  input: {
    workspaceId: string;
    displayName: string;
    roleKey: string;
    memberIds?: string[];
    source?: string;
    createdBy?: string | null;
    identityProviderConfigId?: string | null;
    externalId?: string | null;
    metadata?: Record<string, any> | null;
  },
  deps: GovernanceServiceDependencies,
): Promise<DirectoryGroupWithMembers> => {
  await requireGovernanceWorkspace(input.workspaceId, deps);
  const repository = requireDirectoryGroupRepository(deps);
  const tx = await repository.transaction();
  try {
    const group = await repository.createOne(
      {
        id: crypto.randomUUID(),
        workspaceId: input.workspaceId,
        identityProviderConfigId: input.identityProviderConfigId || null,
        externalId: input.externalId || null,
        displayName: input.displayName.trim(),
        source: input.source || 'manual',
        status: 'active',
        metadata: input.metadata || null,
        createdBy: input.createdBy || null,
      },
      { tx },
    );

    await syncDirectoryGroupRoleBinding({
      group,
      roleKey: input.roleKey,
      tx,
      createdBy: input.createdBy || null,
      deps,
    });
    await syncDirectoryGroupMembers({
      group,
      memberIds: input.memberIds || [],
      source: input.source || 'manual',
      tx,
      deps,
    });

    await repository.commit(tx);
    return await getDirectoryGroupWithMembers(
      group.id,
      input.workspaceId,
      deps,
    );
  } catch (error) {
    await repository.rollback(tx);
    throw error;
  }
};

export const updateDirectoryGroup = async (
  input: {
    workspaceId: string;
    id: string;
    displayName?: string;
    roleKey?: string | null;
    memberIds?: string[];
    status?: string;
    metadata?: Record<string, any> | null;
  },
  deps: GovernanceServiceDependencies,
): Promise<DirectoryGroupWithMembers> => {
  await requireGovernanceWorkspace(input.workspaceId, deps);
  const repository = requireDirectoryGroupRepository(deps);
  const tx = await repository.transaction();
  try {
    const existing = await requireDirectoryGroup(
      input.workspaceId,
      input.id,
      deps,
      tx,
    );
    const updated = await repository.updateOne(
      existing.id,
      {
        displayName: input.displayName?.trim() || existing.displayName,
        status: input.status || existing.status,
        metadata:
          input.metadata === undefined
            ? existing.metadata || null
            : input.metadata,
      },
      { tx },
    );

    if (input.roleKey !== undefined) {
      await syncDirectoryGroupRoleBinding({
        group: updated,
        roleKey: input.roleKey,
        tx,
        deps,
      });
    }
    if (input.memberIds) {
      await syncDirectoryGroupMembers({
        group: updated,
        memberIds: input.memberIds,
        source: updated.source || 'manual',
        tx,
        deps,
      });
    }

    await repository.commit(tx);
    return await getDirectoryGroupWithMembers(
      updated.id,
      input.workspaceId,
      deps,
    );
  } catch (error) {
    await repository.rollback(tx);
    throw error;
  }
};

export const deleteDirectoryGroup = async (
  workspaceId: string,
  id: string,
  deps: GovernanceServiceDependencies,
): Promise<void> => {
  await requireGovernanceWorkspace(workspaceId, deps);
  const repository = requireDirectoryGroupRepository(deps);
  const existing = await requireDirectoryGroup(workspaceId, id, deps);
  await requireDirectoryGroupMemberRepository(deps).deleteByGroupId(
    existing.id,
  );
  await removeDirectoryGroupRoleBindings(
    existing.id,
    existing.workspaceId,
    deps,
  );
  await repository.deleteOne(existing.id);
};

export const upsertIdentityDirectoryGroup = async (
  input: {
    workspaceId: string;
    identityProviderConfigId?: string | null;
    externalId?: string | null;
    displayName: string;
    roleKey?: string | null;
    memberIds?: string[];
    source: string;
    metadata?: Record<string, any> | null;
  },
  deps: GovernanceServiceDependencies,
): Promise<DirectoryGroupWithMembers> => {
  await requireGovernanceWorkspace(input.workspaceId, deps);
  const repository = requireDirectoryGroupRepository(deps);
  const tx = await repository.transaction();
  try {
    let group =
      (input.externalId
        ? await repository.findOneBy(
            {
              workspaceId: input.workspaceId,
              identityProviderConfigId: input.identityProviderConfigId || null,
              externalId: input.externalId,
            },
            { tx },
          )
        : null) ||
      (await repository.findOneBy(
        {
          workspaceId: input.workspaceId,
          displayName: input.displayName.trim(),
        },
        { tx },
      ));

    if (!group) {
      group = await repository.createOne(
        {
          id: crypto.randomUUID(),
          workspaceId: input.workspaceId,
          identityProviderConfigId: input.identityProviderConfigId || null,
          externalId: input.externalId || null,
          displayName: input.displayName.trim(),
          source: input.source,
          status: 'active',
          metadata: input.metadata || null,
        },
        { tx },
      );
    } else {
      group = await repository.updateOne(
        group.id,
        {
          identityProviderConfigId:
            input.identityProviderConfigId ||
            group.identityProviderConfigId ||
            null,
          externalId: input.externalId || group.externalId || null,
          displayName: input.displayName.trim(),
          source: input.source,
          status: 'active',
          metadata:
            input.metadata === undefined
              ? group.metadata || null
              : input.metadata,
        },
        { tx },
      );
    }

    await syncDirectoryGroupRoleBinding({
      group,
      roleKey: input.roleKey,
      tx,
      deps,
    });
    await syncDirectoryGroupMembers({
      group,
      memberIds: input.memberIds || [],
      source: input.source,
      tx,
      deps,
    });

    await repository.commit(tx);
    return await getDirectoryGroupWithMembers(
      group.id,
      input.workspaceId,
      deps,
    );
  } catch (error) {
    await repository.rollback(tx);
    throw error;
  }
};

const getDirectoryGroupWithMembers = async (
  id: string,
  workspaceId: string,
  deps: GovernanceServiceDependencies,
) => {
  const groups = await listDirectoryGroups(workspaceId, deps);
  const group = groups.find((item) => item.id === id);
  if (!group) {
    throw new Error('Directory group not found');
  }
  return group;
};

const listDirectoryGroupRoleKeys = async (
  groups: DirectoryGroup[],
  deps: GovernanceServiceDependencies,
) => {
  if (!deps.principalRoleBindingRepository) {
    return {} as Record<string, string[]>;
  }

  const entries = await Promise.all(
    groups.map(async (group) => {
      const bindings =
        await deps.principalRoleBindingRepository!.findResolvedRoleBindings({
          principalType: 'group',
          principalId: group.id,
          scopeType: 'workspace',
          scopeId: group.workspaceId,
        });
      return [
        group.id,
        Array.from(
          new Set(
            bindings
              .map((binding) =>
                String(binding.roleName || '')
                  .trim()
                  .toLowerCase(),
              )
              .filter(Boolean),
          ),
        ),
      ] as const;
    }),
  );

  return Object.fromEntries(entries);
};

const syncDirectoryGroupRoleBinding = async ({
  group,
  roleKey,
  tx,
  createdBy,
  deps,
}: {
  group: DirectoryGroup;
  roleKey?: string | null;
  tx: any;
  createdBy?: string | null;
  deps: GovernanceServiceDependencies;
}) => {
  if (!deps.roleRepository || !deps.principalRoleBindingRepository) {
    return;
  }

  if (!roleKey) {
    await removeDirectoryGroupRoleBindings(
      group.id,
      group.workspaceId,
      deps,
      tx,
    );
    return;
  }

  await syncWorkspaceScopedRoleBinding({
    principalType: 'group' as 'user' | 'service_account',
    principalId: group.id,
    workspaceId: group.workspaceId,
    roleKey,
    roleRepository: deps.roleRepository,
    principalRoleBindingRepository: deps.principalRoleBindingRepository,
    tx,
    createdBy: createdBy || null,
  });
};

const removeDirectoryGroupRoleBindings = async (
  directoryGroupId: string,
  workspaceId: string,
  deps: GovernanceServiceDependencies,
  tx?: any,
) => {
  if (!deps.principalRoleBindingRepository) {
    return;
  }

  await removeWorkspacePrincipalRoleBindings({
    workspaceId,
    principalId: directoryGroupId,
    principalType: 'group' as 'user' | 'service_account',
    principalRoleBindingRepository: deps.principalRoleBindingRepository,
    tx,
  });
};

const syncDirectoryGroupMembers = async ({
  group,
  memberIds,
  source,
  tx,
  deps,
}: {
  group: DirectoryGroup;
  memberIds: string[];
  source: string;
  tx: any;
  deps: GovernanceServiceDependencies;
}) => {
  const memberRepository = requireDirectoryGroupMemberRepository(deps);
  const normalizedIds = Array.from(
    new Set(
      (memberIds || [])
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    ),
  );

  const memberships = await Promise.all(
    normalizedIds.map((userId) =>
      deps.workspaceService.getMembership(group.workspaceId, userId),
    ),
  );
  const invalidUserId = memberships.findIndex((membership) => !membership);
  if (invalidUserId >= 0) {
    throw new Error('Directory group members must belong to the workspace');
  }

  await memberRepository.deleteByGroupId(group.id, { tx });
  if (normalizedIds.length === 0) {
    return;
  }

  await memberRepository.createMany(
    normalizedIds.map((userId) => ({
      id: crypto.randomUUID(),
      directoryGroupId: group.id,
      workspaceId: group.workspaceId,
      userId,
      source,
    })),
    { tx },
  );
};

const requireDirectoryGroup = async (
  workspaceId: string,
  id: string,
  deps: GovernanceServiceDependencies,
  tx?: any,
) => {
  const group = await requireDirectoryGroupRepository(deps).findOneBy(
    { id },
    tx ? { tx } : undefined,
  );
  if (!group || group.workspaceId !== workspaceId) {
    throw new Error('Directory group not found');
  }
  return group;
};

const requireDirectoryGroupRepository = (
  deps: GovernanceServiceDependencies,
) => {
  if (!deps.directoryGroupRepository) {
    throw new Error('Directory group repository is not configured');
  }
  return deps.directoryGroupRepository;
};

const requireDirectoryGroupMemberRepository = (
  deps: GovernanceServiceDependencies,
) => {
  if (!deps.directoryGroupMemberRepository) {
    throw new Error('Directory group member repository is not configured');
  }
  return deps.directoryGroupMemberRepository;
};
