import { RuntimeScope } from '@server/context/runtimeScope';
import { ValidateSessionResult } from '@server/services/authService';

export type AuthorizationPrincipalType =
  | 'user'
  | 'group'
  | 'service_account'
  | 'system'
  | 'scheduled_job';

export interface AuthorizationActor {
  principalType: AuthorizationPrincipalType;
  principalId: string;
  workspaceId?: string | null;
  workspaceMemberId?: string | null;
  workspaceRoleKeys: string[];
  permissionScopes: string[];
  isPlatformAdmin: boolean;
  platformRoleKeys: string[];
  grantedActions?: string[];
  workspaceRoleSource?: 'legacy' | 'role_binding';
  platformRoleSource?: 'legacy' | 'role_binding';
  sessionId?: string | null;
}

export const buildAuthorizationActorFromValidatedSession = (
  validatedSession: ValidateSessionResult,
): AuthorizationActor => ({
  principalType: 'user',
  principalId: validatedSession.user.id,
  workspaceId: validatedSession.workspace.id,
  workspaceMemberId: validatedSession.membership.id,
  workspaceRoleKeys: validatedSession.actorClaims.roleKeys || [],
  permissionScopes: validatedSession.actorClaims.permissionScopes || [],
  isPlatformAdmin: Boolean(validatedSession.actorClaims.isPlatformAdmin),
  platformRoleKeys: validatedSession.actorClaims.platformRoleKeys || [],
  grantedActions: validatedSession.actorClaims.grantedActions,
  workspaceRoleSource: validatedSession.actorClaims.workspaceRoleSource,
  platformRoleSource: validatedSession.actorClaims.platformRoleSource,
  sessionId: validatedSession.session.id,
});

export const buildAuthorizationActorFromRuntimeScope = (
  runtimeScope?: RuntimeScope | null,
): AuthorizationActor | null => {
  if (!runtimeScope?.userId || !runtimeScope.actorClaims) {
    return null;
  }

  return {
    principalType: 'user',
    principalId: runtimeScope.userId,
    workspaceId:
      runtimeScope.workspace?.id || runtimeScope.actorClaims.workspaceId,
    workspaceMemberId: runtimeScope.actorClaims.workspaceMemberId,
    workspaceRoleKeys: runtimeScope.actorClaims.roleKeys || [],
    permissionScopes: runtimeScope.actorClaims.permissionScopes || [],
    isPlatformAdmin: Boolean(runtimeScope.actorClaims.isPlatformAdmin),
    platformRoleKeys: runtimeScope.actorClaims.platformRoleKeys || [],
    grantedActions: runtimeScope.actorClaims.grantedActions,
    workspaceRoleSource: runtimeScope.actorClaims.workspaceRoleSource,
    platformRoleSource: runtimeScope.actorClaims.platformRoleSource,
    sessionId: null,
  };
};

export const buildScheduledJobActor = ({
  workspaceId,
  principalId,
}: {
  workspaceId?: string | null;
  principalId: string;
}): AuthorizationActor => ({
  principalType: 'scheduled_job',
  principalId,
  workspaceId: workspaceId || null,
  workspaceMemberId: null,
  workspaceRoleKeys: [],
  permissionScopes: [],
  isPlatformAdmin: false,
  platformRoleKeys: [],
  grantedActions: [],
  sessionId: null,
});

export const serializeAuthorizationActor = (
  actor?: AuthorizationActor | null,
) =>
  actor
    ? {
        principalType: actor.principalType,
        principalId: actor.principalId,
        workspaceId: actor.workspaceId || null,
        workspaceMemberId: actor.workspaceMemberId || null,
        workspaceRoleKeys: actor.workspaceRoleKeys,
        permissionScopes: actor.permissionScopes,
        isPlatformAdmin: actor.isPlatformAdmin,
        platformRoleKeys: actor.platformRoleKeys,
        grantedActions: actor.grantedActions,
        workspaceRoleSource: actor.workspaceRoleSource,
        platformRoleSource: actor.platformRoleSource,
      }
    : null;
