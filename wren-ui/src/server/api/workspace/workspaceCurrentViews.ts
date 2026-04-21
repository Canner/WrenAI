import {
  WORKSPACE_KINDS,
  getWorkspaceRoleLabel,
  normalizeWorkspaceRoleKeyForDisplay,
} from '@/utils/workspaceGovernance';
import { toLegacyWorkspaceRoleKey } from '@server/authz';

export type BindingSourceDetail = {
  kind:
    | 'direct_binding'
    | 'group_binding'
    | 'platform_binding'
    | 'service_account_binding'
    | 'token_binding';
  label: string;
};

const ROLE_LABELS: Record<string, string> = {
  owner: '所有者',
  viewer: '查看者',
  workspace_owner: '所有者',
  workspace_viewer: '查看者',
  platform_admin: '平台管理员',
};

export const sortByName = <T extends { name?: string | null }>(items: T[]) =>
  [...items].sort((left, right) =>
    String(left.name || '').localeCompare(String(right.name || '')),
  );

export const sortUsers = <
  T extends { displayName?: string | null; email?: string | null },
>(
  items: T[],
) =>
  [...items].sort((left, right) => {
    const leftName = left.displayName || left.email || '';
    const rightName = right.displayName || right.email || '';
    return leftName.localeCompare(rightName);
  });

export const sortMembers = <
  T extends {
    roleKey?: string | null;
    user?: { displayName?: string | null; email?: string | null } | null;
  },
>(
  items: T[],
) =>
  [...items].sort((left, right) => {
    if (
      normalizeWorkspaceRoleKeyForDisplay(left.roleKey) === 'owner' &&
      normalizeWorkspaceRoleKeyForDisplay(right.roleKey) !== 'owner'
    ) {
      return -1;
    }
    if (
      normalizeWorkspaceRoleKeyForDisplay(left.roleKey) !== 'owner' &&
      normalizeWorkspaceRoleKeyForDisplay(right.roleKey) === 'owner'
    ) {
      return 1;
    }

    const leftName = left.user?.displayName || left.user?.email || '';
    const rightName = right.user?.displayName || right.user?.email || '';
    return leftName.localeCompare(rightName);
  });

export const toWorkspaceView = (workspace: any) => ({
  id: workspace.id,
  name: workspace.name,
  slug: workspace.slug || null,
  status: workspace.status || 'active',
  kind: workspace.kind || WORKSPACE_KINDS.REGULAR,
});

export const formatRoleLabel = (roleName?: string | null) => {
  const normalizedRoleKey = normalizeWorkspaceRoleKeyForDisplay(roleName);
  if (normalizedRoleKey && ROLE_LABELS[normalizedRoleKey]) {
    return ROLE_LABELS[normalizedRoleKey];
  }
  const legacyRole = toLegacyWorkspaceRoleKey(roleName);
  if (legacyRole && ROLE_LABELS[legacyRole]) {
    return ROLE_LABELS[legacyRole];
  }
  return getWorkspaceRoleLabel(roleName);
};

export const compactBindingRoles = (
  roleNames: Array<string | null | undefined>,
) =>
  Array.from(
    new Set(
      roleNames
        .map((roleName) => String(formatRoleLabel(roleName)).trim())
        .filter(Boolean),
    ),
  );

export const toBindingSummaryLabel = (
  prefix: string,
  roleNames: Array<string | null | undefined>,
) => {
  const labels = compactBindingRoles(roleNames);
  return labels.length > 0 ? `${prefix} · ${labels.join(' / ')}` : prefix;
};

export const toOwnerCandidateView = (user: any, isPlatformAdmin: boolean) => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName ?? null,
  status: user.status || 'active',
  isPlatformAdmin,
});

export const toServiceAccountView = (
  serviceAccount: any,
  tokens: Array<any> = [],
) => ({
  id: serviceAccount.id,
  workspaceId: serviceAccount.workspaceId,
  name: serviceAccount.name,
  description: serviceAccount.description || null,
  roleKey: serviceAccount.roleKey,
  status: serviceAccount.status,
  createdBy: serviceAccount.createdBy || null,
  lastUsedAt: serviceAccount.lastUsedAt || null,
  createdAt: serviceAccount.createdAt || null,
  updatedAt: serviceAccount.updatedAt || null,
  tokenCount: tokens.length,
  activeTokenCount: tokens.filter((token) => !token.revokedAt).length,
});

export const toApiTokenView = (token: any) => ({
  id: token.id,
  workspaceId: token.workspaceId,
  serviceAccountId: token.serviceAccountId || null,
  name: token.name,
  prefix: token.prefix,
  scopeType: token.scopeType,
  scopeId: token.scopeId,
  status: token.status,
  expiresAt: token.expiresAt || null,
  revokedAt: token.revokedAt || null,
  lastUsedAt: token.lastUsedAt || null,
  createdBy: token.createdBy || null,
  createdAt: token.createdAt || null,
  updatedAt: token.updatedAt || null,
});

export const toDirectoryGroupView = (group: any) => ({
  id: group.id,
  workspaceId: group.workspaceId,
  displayName: group.displayName,
  source: group.source,
  status: group.status,
  roleKeys: group.roleKeys || [],
  memberIds: (group.members || []).map((member: any) => member.userId),
  memberCount: Array.isArray(group.members) ? group.members.length : 0,
  createdAt: group.createdAt || null,
  updatedAt: group.updatedAt || null,
});

export const toBreakGlassGrantView = (grant: any) => ({
  id: grant.id,
  workspaceId: grant.workspaceId,
  userId: grant.userId,
  roleKey: grant.roleKey,
  status: grant.status,
  reason: grant.reason,
  expiresAt: grant.expiresAt,
  revokedAt: grant.revokedAt || null,
  createdBy: grant.createdBy || null,
  user: grant.user || null,
  createdAt: grant.createdAt || null,
  updatedAt: grant.updatedAt || null,
});

const statusPriority: Record<string, number> = {
  pending: 0,
  invited: 1,
  rejected: 2,
  inactive: 3,
  active: 4,
};

export const sortApplications = <
  T extends { status?: string | null; updatedAt?: string | Date | null },
>(
  items: T[],
) =>
  [...items].sort((left, right) => {
    const leftPriority =
      statusPriority[String(left.status || '').toLowerCase()] ?? 99;
    const rightPriority =
      statusPriority[String(right.status || '').toLowerCase()] ?? 99;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    return (
      new Date(right.updatedAt || 0).getTime() -
      new Date(left.updatedAt || 0).getTime()
    );
  });
