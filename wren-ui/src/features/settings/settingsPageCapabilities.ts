import type { AuthSessionPayload } from '@/hooks/useAuthSession';

type PlatformManagementCapabilityInput = {
  platformRoleKeys?: string[] | null;
  actorIsPlatformAdmin?: boolean | null;
  sessionIsPlatformAdmin?: boolean | null;
};

export type PlatformCapabilityAction =
  | 'platform.user.read'
  | 'platform.user.create'
  | 'platform.user.update'
  | 'platform.user.role.assign'
  | 'platform.user.workspace.assign'
  | 'platform.role.read'
  | 'platform.role.create'
  | 'platform.role.update'
  | 'platform.role.delete'
  | 'platform.workspace.read'
  | 'platform.workspace.member.manage'
  | 'platform.audit.read'
  | 'platform.diagnostics.read'
  | 'platform.system_task.read'
  | 'platform.system_task.manage'
  | 'workspace.create';

export const canShowPlatformManagement = ({
  platformRoleKeys,
  actorIsPlatformAdmin,
  sessionIsPlatformAdmin,
}: PlatformManagementCapabilityInput) =>
  Boolean(
    (platformRoleKeys?.length || 0) > 0 ||
      actorIsPlatformAdmin ||
      sessionIsPlatformAdmin,
  );

export const resolvePlatformManagementFromAuthSession = (
  authSession?: AuthSessionPayload | null,
) =>
  canShowPlatformManagement({
    platformRoleKeys: authSession?.authorization?.actor?.platformRoleKeys,
    actorIsPlatformAdmin: authSession?.authorization?.actor?.isPlatformAdmin,
    sessionIsPlatformAdmin: authSession?.isPlatformAdmin,
  });

export const resolvePlatformActionFromAuthSession = (
  authSession: AuthSessionPayload | null | undefined,
  action: PlatformCapabilityAction,
) => {
  if (!authSession?.authenticated) {
    return false;
  }

  if (
    authSession?.authorization?.actor?.isPlatformAdmin ||
    authSession?.isPlatformAdmin
  ) {
    return true;
  }

  return Boolean(
    authSession?.authorization?.actor?.grantedActions?.includes(action) ||
      authSession?.authorization?.actions?.[action],
  );
};

export const resolvePlatformConsoleCapabilities = (
  authSession?: AuthSessionPayload | null,
) => ({
  canReadUsers: resolvePlatformActionFromAuthSession(
    authSession,
    'platform.user.read',
  ),
  canCreateUsers: resolvePlatformActionFromAuthSession(
    authSession,
    'platform.user.create',
  ),
  canUpdateUsers: resolvePlatformActionFromAuthSession(
    authSession,
    'platform.user.update',
  ),
  canAssignPlatformRoles: resolvePlatformActionFromAuthSession(
    authSession,
    'platform.user.role.assign',
  ),
  canAssignUserWorkspaces: resolvePlatformActionFromAuthSession(
    authSession,
    'platform.user.workspace.assign',
  ),
  canReadRoles: resolvePlatformActionFromAuthSession(
    authSession,
    'platform.role.read',
  ),
  canCreateRoles: resolvePlatformActionFromAuthSession(
    authSession,
    'platform.role.create',
  ),
  canUpdateRoles: resolvePlatformActionFromAuthSession(
    authSession,
    'platform.role.update',
  ),
  canDeleteRoles: resolvePlatformActionFromAuthSession(
    authSession,
    'platform.role.delete',
  ),
  canReadWorkspaces: resolvePlatformActionFromAuthSession(
    authSession,
    'platform.workspace.read',
  ),
  canCreateWorkspace: resolvePlatformActionFromAuthSession(
    authSession,
    'workspace.create',
  ),
  canManageWorkspaceMembers: resolvePlatformActionFromAuthSession(
    authSession,
    'platform.workspace.member.manage',
  ),
  canReadAudit: resolvePlatformActionFromAuthSession(
    authSession,
    'platform.audit.read',
  ),
  canReadDiagnostics: resolvePlatformActionFromAuthSession(
    authSession,
    'platform.diagnostics.read',
  ),
  canReadSystemTasks: resolvePlatformActionFromAuthSession(
    authSession,
    'platform.system_task.read',
  ),
  canManageSystemTasks: resolvePlatformActionFromAuthSession(
    authSession,
    'platform.system_task.manage',
  ),
});
