import {
  AuthorizationAction,
  getCustomRoleAssignableActions,
  getWorkspaceAuthorizationActions,
} from './permissionRegistry';
import { Role } from '@server/repositories';
import type { BindingCatalogDeps, RoleCatalogDeps } from './adminCatalogTypes';

const SYSTEM_ROLE_LABELS: Record<string, string> = {
  workspace_owner: '所有者',
  workspace_admin: '管理员',
  workspace_viewer: '查看者',
  platform_admin: '平台管理员',
};

const CUSTOM_ROLE_PREFIX = 'workspace_custom_role';
const CUSTOM_ROLE_NAME_SEPARATOR = ':';

export const normalizeRoleDisplayName = (role: Role) =>
  String(
    role.displayName ||
      SYSTEM_ROLE_LABELS[
        String(role.name || '')
          .trim()
          .toLowerCase()
      ] ||
      role.name,
  );

export const getWorkspaceRoleKey = (role: Role, workspaceId: string) => {
  const normalizedName = String(role.name || '').trim();
  const customPrefix = `${CUSTOM_ROLE_PREFIX}${CUSTOM_ROLE_NAME_SEPARATOR}${workspaceId}${CUSTOM_ROLE_NAME_SEPARATOR}`;
  if (!role.isSystem && normalizedName.startsWith(customPrefix)) {
    return normalizedName.slice(customPrefix.length) || normalizedName;
  }
  return normalizedName;
};

export const isRoleVisibleInWorkspace = (role: Role, workspaceId: string) =>
  role.scopeType === 'workspace' &&
  (!role.scopeId || role.scopeId === '' || role.scopeId === workspaceId);

export const isCustomWorkspaceRole = (role: Role, workspaceId: string) =>
  !role.isSystem &&
  role.scopeType === 'workspace' &&
  role.scopeId === workspaceId;

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);

export const normalizeCustomRoleKey = (value?: string | null) =>
  slugify(String(value || '')) || 'custom_role';

const buildCustomRoleInternalName = (workspaceId: string, roleKey: string) =>
  `${CUSTOM_ROLE_PREFIX}${CUSTOM_ROLE_NAME_SEPARATOR}${workspaceId}${CUSTOM_ROLE_NAME_SEPARATOR}${roleKey}`;

export const buildCustomRoleName = (
  workspaceId: string,
  roleKey: string,
  existingNames: Set<string>,
) => {
  const baseSlug = normalizeCustomRoleKey(roleKey);
  let candidate = buildCustomRoleInternalName(workspaceId, baseSlug);
  let sequence = 2;
  while (existingNames.has(candidate)) {
    candidate = buildCustomRoleInternalName(
      workspaceId,
      `${baseSlug}_${sequence}`,
    );
    sequence += 1;
  }
  return candidate;
};

export const buildPermissionMap = async ({
  permissionRepository,
  rolePermissionRepository,
}: Pick<
  RoleCatalogDeps,
  'permissionRepository' | 'rolePermissionRepository'
>) => {
  const [permissions, rolePermissions] = await Promise.all([
    permissionRepository.findAll(),
    rolePermissionRepository.findAll(),
  ]);
  const permissionNameById = new Map(
    permissions.map((permission) => [permission.id, permission.name]),
  );
  const permissionCatalog = permissions
    .filter((permission) => permission.scopeType === 'workspace')
    .map((permission) => ({
      name: permission.name,
      description: permission.description || '',
      assignable: getCustomRoleAssignableActions().includes(
        permission.name as AuthorizationAction,
      ),
    }));
  const permissionNamesByRoleId = rolePermissions.reduce<
    Record<string, string[]>
  >((acc, rolePermission) => {
    const permissionName = permissionNameById.get(rolePermission.permissionId);
    if (!permissionName) {
      return acc;
    }
    acc[rolePermission.roleId] = acc[rolePermission.roleId] || [];
    acc[rolePermission.roleId].push(permissionName);
    return acc;
  }, {});

  return { permissionCatalog, permissionNamesByRoleId, permissions };
};

export const buildPrincipalLabel = async ({
  principalType,
  principalId,
  userRepository,
  workspaceMemberRepository,
  directoryGroupRepository,
  serviceAccountRepository,
  workspaceId,
}: {
  principalType: string;
  principalId: string;
  workspaceId: string;
} & Pick<
  BindingCatalogDeps,
  | 'userRepository'
  | 'workspaceMemberRepository'
  | 'directoryGroupRepository'
  | 'serviceAccountRepository'
>) => {
  if (principalType === 'user') {
    const [user, membership] = await Promise.all([
      userRepository.findOneBy({ id: principalId }),
      workspaceMemberRepository.findOneBy({
        userId: principalId,
        workspaceId,
      }),
    ]);
    const name = user?.displayName || user?.email || principalId;
    return membership?.roleKey ? `${name} · ${membership.roleKey}` : name;
  }

  if (principalType === 'group') {
    const group = await directoryGroupRepository.findOneBy({ id: principalId });
    return group?.displayName || principalId;
  }

  if (principalType === 'service_account') {
    const serviceAccount = await serviceAccountRepository.findOneBy({
      id: principalId,
    });
    return serviceAccount?.name || principalId;
  }

  return principalId;
};

export const rolePermissionsToScopes = (
  grantedActions: string[],
  workspaceId: string,
) => {
  const scopes = new Set<string>();
  grantedActions.forEach((action) => {
    if (
      action === 'workspace.create' ||
      action === 'break_glass.manage' ||
      action === 'impersonation.start'
    ) {
      scopes.add('platform:*');
    } else {
      scopes.add(`workspace:${workspaceId}`);
    }
  });
  return Array.from(scopes);
};

export const buildActionCatalog = (
  permissions: Array<{ name: string; description?: string | null }>,
) =>
  getWorkspaceAuthorizationActions().map((name) => ({
    name,
    description:
      permissions.find((permission) => permission.name === name)?.description ||
      '',
  }));
