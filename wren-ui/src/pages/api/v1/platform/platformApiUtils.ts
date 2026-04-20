import type { NextApiRequest } from 'next';
import { components } from '@/common';
import {
  WORKSPACE_KINDS,
  getWorkspaceRoleLabel,
  isWorkspaceOwnerEquivalentRole,
  normalizeWorkspaceRoleKeyForDisplay,
} from '@/utils/workspaceGovernance';
import { getSessionTokenFromRequest } from '@server/context/actorClaims';
import {
  PLATFORM_ADMIN_ROLE_NAME,
  PLATFORM_SCOPE_ID,
  assertAuthorizedWithAudit,
  authorize,
  buildAuthorizationActorFromValidatedSession,
  buildAuthorizationContextFromRequest,
  ensureAuthorizationCatalogSeeded,
  legacyRolePolicyMap,
  toLegacyWorkspaceRoleKey,
  type AuthorizationAction,
  type AuthorizationResource,
  type AuthorizationActor,
} from '@server/authz';

export const getQueryString = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export const getString = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

export const createHttpError = (statusCode: number, message: string) => {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = statusCode;
  return error;
};

export const requireValidatedPlatformSession = async (req: NextApiRequest) => {
  const sessionToken = getSessionTokenFromRequest(req);
  if (!sessionToken) {
    throw createHttpError(401, 'Authentication required');
  }

  const workspaceId = getQueryString(req.query.workspaceId);
  const validatedSession = await components.authService.validateSession(
    sessionToken,
    workspaceId,
  );
  if (!validatedSession) {
    throw createHttpError(401, 'Authentication required');
  }

  const actor = buildAuthorizationActorFromValidatedSession(validatedSession);
  const auditContext = buildAuthorizationContextFromRequest({
    req,
    sessionId: actor.sessionId,
  });

  return {
    sessionToken,
    validatedSession,
    actor,
    auditContext,
  };
};

export const isPlatformAdminActor = ({
  actor,
  validatedSession,
}: {
  actor: AuthorizationActor;
  validatedSession: Awaited<
    ReturnType<typeof components.authService.validateSession>
  >;
}) =>
  Boolean(
    actor.isPlatformAdmin ||
    actor.platformRoleKeys.includes('platform_admin') ||
    validatedSession?.user?.isPlatformAdmin,
  );

export const requirePlatformAdminContext = async (req: NextApiRequest) => {
  const context = await requireValidatedPlatformSession(req);
  if (
    !isPlatformAdminActor({
      actor: context.actor,
      validatedSession: context.validatedSession,
    })
  ) {
    throw createHttpError(403, 'Platform admin permission required');
  }

  return context;
};

export const assertPlatformActionForContext = async ({
  context,
  action,
  resource,
}: {
  context: Awaited<ReturnType<typeof requireValidatedPlatformSession>>;
  action: AuthorizationAction;
  resource?: AuthorizationResource | null;
}) => {
  const resolvedResource =
    resource ||
    ({
      resourceType: 'platform',
      resourceId: action,
      workspaceId:
        context.actor.workspaceId || context.validatedSession.workspace.id,
    } satisfies AuthorizationResource);

  await assertAuthorizedWithAudit({
    auditEventRepository: components.auditEventRepository,
    actor: context.actor,
    action,
    resource: resolvedResource,
    context: context.auditContext,
  });

  return context;
};

export const requirePlatformActionContext = async ({
  req,
  action,
  resource,
}: {
  req: NextApiRequest;
  action: AuthorizationAction;
  resource?: AuthorizationResource | null;
}) => {
  const context = await requireValidatedPlatformSession(req);
  await assertPlatformActionForContext({
    context,
    action,
    resource,
  });
  return context;
};

export const hasPlatformAction = ({
  actor,
  action,
  workspaceId,
}: {
  actor: AuthorizationActor;
  action: AuthorizationAction;
  workspaceId?: string | null;
}) =>
  authorize({
    actor,
    action,
    resource: {
      resourceType: 'platform',
      resourceId: action,
      workspaceId: workspaceId || actor.workspaceId || null,
    },
  }).allowed;

export const buildWorkspaceScopedActor = ({
  validatedSession,
  workspaceId,
  membership,
}: {
  validatedSession: NonNullable<
    Awaited<ReturnType<typeof components.authService.validateSession>>
  >;
  workspaceId: string;
  membership?: {
    id: string;
    roleKey: string;
  } | null;
}): AuthorizationActor => {
  const actor = buildAuthorizationActorFromValidatedSession(validatedSession);
  const targetRoleKey = membership
    ? toLegacyWorkspaceRoleKey(membership.roleKey)
    : null;

  return {
    ...actor,
    workspaceId,
    workspaceMemberId: membership?.id || null,
    workspaceRoleKeys: targetRoleKey ? [targetRoleKey] : [],
    grantedActions:
      actor.isPlatformAdmin || !targetRoleKey
        ? actor.grantedActions
        : legacyRolePolicyMap[targetRoleKey],
    workspaceRoleSource: membership ? 'legacy' : actor.workspaceRoleSource,
  };
};

export const requireWorkspaceScopedContext = async ({
  req,
  workspaceId,
  platformAction,
}: {
  req: NextApiRequest;
  workspaceId: string;
  platformAction?: AuthorizationAction;
}) => {
  const context = await requireValidatedPlatformSession(req);
  const workspace = await components.workspaceRepository.findOneBy({
    id: workspaceId,
  });
  if (!workspace) {
    throw createHttpError(404, 'Workspace not found');
  }

  if (
    isPlatformAdminActor({
      actor: context.actor,
      validatedSession: context.validatedSession,
    })
  ) {
    return {
      ...context,
      workspace,
      membership: null,
      hasPlatformAccess: true,
      scopedActor: buildWorkspaceScopedActor({
        validatedSession: context.validatedSession,
        workspaceId,
      }),
    };
  }

  const platformAccess = platformAction
    ? hasPlatformAction({
        actor: context.actor,
        action: platformAction,
        workspaceId,
      })
    : false;

  if (platformAccess) {
    return {
      ...context,
      workspace,
      membership: null,
      hasPlatformAccess: true,
      scopedActor: buildWorkspaceScopedActor({
        validatedSession: context.validatedSession,
        workspaceId,
      }),
    };
  }

  const membership = await components.workspaceMemberRepository.findOneBy({
    workspaceId,
    userId: context.validatedSession.user.id,
    status: 'active',
  });
  if (!membership) {
    throw createHttpError(403, 'Workspace access denied');
  }

  return {
    ...context,
    workspace,
    membership,
    hasPlatformAccess: false,
    scopedActor: buildWorkspaceScopedActor({
      validatedSession: context.validatedSession,
      workspaceId,
      membership,
    }),
  };
};

export const serializeWorkspaceRoleKey = (roleKey?: string | null) =>
  normalizeWorkspaceRoleKeyForDisplay(roleKey) || 'viewer';

export const serializeWorkspace = (workspace: any) => ({
  id: workspace.id,
  name: workspace.name,
  slug: workspace.slug || null,
  status: workspace.status || 'active',
  kind: workspace.kind || WORKSPACE_KINDS.REGULAR,
  createdBy: workspace.createdBy || null,
});

export const serializeMembership = ({
  membership,
  user,
  workspace,
}: {
  membership: any;
  user?: any;
  workspace?: any;
}) => ({
  id: membership.id,
  userId: membership.userId,
  workspaceId: membership.workspaceId,
  roleKey: serializeWorkspaceRoleKey(membership.roleKey),
  roleLabel: getWorkspaceRoleLabel(membership.roleKey),
  rawRoleKey: membership.roleKey,
  status: membership.status,
  createdAt: membership.createdAt || null,
  updatedAt: membership.updatedAt || null,
  user: user
    ? {
        id: user.id,
        email: user.email,
        displayName: user.displayName || null,
        phone: user.phone || user.mobile || user.phoneNumber || null,
        status: user.status || 'active',
      }
    : null,
  workspace: workspace ? serializeWorkspace(workspace) : null,
});

export const sortMemberships = <
  T extends {
    roleKey?: string | null;
    user?: { displayName?: string | null; email?: string | null } | null;
  },
>(
  items: T[],
) =>
  [...items].sort((left, right) => {
    const leftRole = serializeWorkspaceRoleKey(left.roleKey);
    const rightRole = serializeWorkspaceRoleKey(right.roleKey);
    if (leftRole === 'owner' && rightRole !== 'owner') {
      return -1;
    }
    if (leftRole !== 'owner' && rightRole === 'owner') {
      return 1;
    }

    const leftName = left.user?.displayName || left.user?.email || '';
    const rightName = right.user?.displayName || right.user?.email || '';
    return leftName.localeCompare(rightName);
  });

export const sortWorkspacesByName = <T extends { name?: string | null }>(
  items: T[],
) =>
  [...items].sort((left, right) =>
    String(left.name || '').localeCompare(String(right.name || '')),
  );

export type PlatformRoleOption = {
  id: string;
  name: string;
  displayName: string;
  description?: string | null;
  isSystem: boolean;
  isActive: boolean;
};

export const listPlatformRoleAssignments = async () => {
  await ensureAuthorizationCatalogSeeded({
    roleRepository: components.roleRepository,
    permissionRepository: components.permissionRepository,
    rolePermissionRepository: components.rolePermissionRepository,
  });

  const [roles, bindings] = await Promise.all([
    components.roleRepository.findAll({
      order: 'is_system desc, created_at asc',
    }),
    components.principalRoleBindingRepository.findAllBy({
      scopeType: 'platform',
      scopeId: PLATFORM_SCOPE_ID,
    }),
  ]);

  const platformRoleCatalog: PlatformRoleOption[] = roles
    .filter(
      (role) =>
        role.scopeType === 'platform' &&
        String(role.scopeId || '') === PLATFORM_SCOPE_ID,
    )
    .map((role) => ({
      id: role.id,
      name: role.name,
      displayName: role.displayName || role.name,
      description: role.description || null,
      isSystem: Boolean(role.isSystem),
      isActive: role.isActive !== false,
    }))
    .sort((left, right) => {
      if (left.isSystem !== right.isSystem) {
        return left.isSystem ? -1 : 1;
      }
      return left.displayName.localeCompare(right.displayName);
    });

  const roleById = new Map(platformRoleCatalog.map((role) => [role.id, role]));
  const platformRolesByUserId = bindings.reduce<
    Map<string, PlatformRoleOption[]>
  >((acc, binding) => {
    if (binding.principalType !== 'user') {
      return acc;
    }
    const role = roleById.get(binding.roleId);
    if (!role) {
      return acc;
    }
    const nextRoles = acc.get(binding.principalId) || [];
    nextRoles.push(role);
    acc.set(binding.principalId, nextRoles);
    return acc;
  }, new Map());

  return {
    platformRoleCatalog,
    platformRolesByUserId,
    platformAdminRole:
      platformRoleCatalog.find(
        (role) => role.name === PLATFORM_ADMIN_ROLE_NAME,
      ) || null,
  };
};

export const canManageWorkspaceMemberships = (roleKey?: string | null) =>
  isWorkspaceOwnerEquivalentRole(roleKey);

export const buildPlatformUserRecord = ({
  user,
  memberships,
  workspaceById,
  platformRoles = [],
  platformAdminFallbackRole = null,
}: {
  user: any;
  memberships: any[];
  workspaceById: Map<string, any>;
  platformRoles?: PlatformRoleOption[];
  platformAdminFallbackRole?: PlatformRoleOption | null;
}) => {
  const workspaceMemberships = memberships
    .map((membership) =>
      serializeMembership({
        membership,
        workspace: workspaceById.get(membership.workspaceId) || null,
      }),
    )
    .sort((left, right) => {
      if (
        user.defaultWorkspaceId &&
        left.workspaceId === user.defaultWorkspaceId &&
        right.workspaceId !== user.defaultWorkspaceId
      ) {
        return -1;
      }
      if (
        user.defaultWorkspaceId &&
        left.workspaceId !== user.defaultWorkspaceId &&
        right.workspaceId === user.defaultWorkspaceId
      ) {
        return 1;
      }
      return String(left.workspace?.name || '').localeCompare(
        String(right.workspace?.name || ''),
      );
    });

  const defaultWorkspace = user.defaultWorkspaceId
    ? workspaceById.get(user.defaultWorkspaceId)
    : null;

  const assignedPlatformRoles =
    platformRoles.length > 0
      ? platformRoles
      : Boolean(user.isPlatformAdmin) && platformAdminFallbackRole
        ? [platformAdminFallbackRole]
        : [];
  const isPlatformAdmin =
    assignedPlatformRoles.some(
      (role) => role.name === PLATFORM_ADMIN_ROLE_NAME,
    ) || Boolean(user.isPlatformAdmin);

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName || null,
    phone: user.phone || user.mobile || user.phoneNumber || null,
    status: user.status || 'active',
    isPlatformAdmin,
    platformRoleIds: assignedPlatformRoles.map((role) => role.id),
    platformRoles: assignedPlatformRoles.map((role) => role.name),
    platformRoleLabels: assignedPlatformRoles.map((role) => role.displayName),
    defaultWorkspaceId: user.defaultWorkspaceId || null,
    defaultWorkspaceName: defaultWorkspace?.name || null,
    workspaceCount: workspaceMemberships.filter(
      (membership) => membership.status !== 'inactive',
    ).length,
    workspaces: workspaceMemberships,
  };
};
