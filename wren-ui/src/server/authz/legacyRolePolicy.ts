import { AUTHORIZATION_ACTIONS, AuthorizationAction } from './permissionRegistry';
import { toLegacyWorkspaceRoleKey } from './roleMapping';

const OWNER_ACTIONS: AuthorizationAction[] = [
  'workspace.read',
  'workspace.default.set',
  'workspace.member.invite',
  'workspace.member.approve',
  'workspace.member.reject',
  'workspace.member.status.update',
  'workspace.member.remove',
  'workspace.member.role.update',
  'workspace.schedule.manage',
  'dashboard.schedule.manage',
  'knowledge_base.create',
  'knowledge_base.read',
  'knowledge_base.update',
  'knowledge_base.archive',
  'connector.create',
  'connector.read',
  'connector.update',
  'connector.delete',
  'connector.rotate_secret',
  'skill.create',
  'skill.read',
  'skill.update',
  'skill.delete',
  'secret.reencrypt',
  'service_account.read',
  'service_account.create',
  'service_account.update',
  'service_account.delete',
  'api_token.read',
  'api_token.create',
  'api_token.revoke',
  'identity_provider.read',
  'identity_provider.manage',
  'access_review.read',
  'access_review.manage',
  'group.read',
  'group.manage',
  'audit.read',
  'role.read',
  'role.manage',
];

const ADMIN_ACTIONS: AuthorizationAction[] = [...OWNER_ACTIONS];

const MEMBER_ACTIONS: AuthorizationAction[] = [
  'workspace.read',
  'workspace.default.set',
  'knowledge_base.read',
  'connector.read',
  'skill.read',
  'access_review.read',
];

const PLATFORM_ADMIN_ACTIONS: AuthorizationAction[] = (
  Object.keys(AUTHORIZATION_ACTIONS) as AuthorizationAction[]
).filter((action) => AUTHORIZATION_ACTIONS[action].scope === 'platform');

export const legacyRolePolicyMap: Record<string, AuthorizationAction[]> = {
  owner: OWNER_ACTIONS,
  admin: ADMIN_ACTIONS,
  member: MEMBER_ACTIONS,
  platform_admin: PLATFORM_ADMIN_ACTIONS,
};

export const hasLegacyRolePermission = (
  roleKey: string | null | undefined,
  action: AuthorizationAction,
) => {
  const normalizedRoleKey = toLegacyWorkspaceRoleKey(roleKey);
  if (!normalizedRoleKey) {
    return false;
  }

  return legacyRolePolicyMap[normalizedRoleKey]?.includes(action) || false;
};
