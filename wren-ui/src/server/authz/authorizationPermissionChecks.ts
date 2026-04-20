import type { AuthorizationActor } from './authorizationActor';
import { isAuthorizationBindingOnlyEnabled } from './bindingMode';
import { hasLegacyRolePermission } from './legacyRolePolicy';
import {
  getAuthorizationActionMeta,
  type AuthorizationAction,
} from './permissionRegistry';
import { hasWorkspaceWriteRole } from './rules';
import {
  deny,
  type AuthorizationDecision,
  type AuthorizationResource,
} from './authorizationDecision';

export const actorHasAction = (
  actor: AuthorizationActor,
  action: AuthorizationAction,
) => {
  const meta = getAuthorizationActionMeta(action);
  if (meta.scope === 'workspace' && actor.isPlatformAdmin) {
    return true;
  }

  if (Array.isArray(actor.grantedActions)) {
    return actor.grantedActions.includes(action);
  }

  if (actor.workspaceRoleSource === 'role_binding') {
    return false;
  }

  if (isAuthorizationBindingOnlyEnabled()) {
    return false;
  }

  return actor.workspaceRoleKeys.some((roleKey) =>
    hasLegacyRolePermission(roleKey, action),
  );
};

export const actorHasPlatformAction = (
  actor: AuthorizationActor,
  action: AuthorizationAction,
) => {
  if (Array.isArray(actor.grantedActions)) {
    return actor.grantedActions.includes(action);
  }

  if (actor.platformRoleSource === 'role_binding') {
    return false;
  }

  if (isAuthorizationBindingOnlyEnabled()) {
    return false;
  }

  return actor.isPlatformAdmin;
};

export const ensureWorkspaceBoundary = (
  action: AuthorizationAction,
  actor: AuthorizationActor,
  resource: AuthorizationResource | null,
): AuthorizationDecision | null => {
  if (!resource?.workspaceId || !actor.workspaceId) {
    return null;
  }

  if (resource.workspaceId !== actor.workspaceId) {
    return deny({
      action,
      actor,
      resource,
      reason: 'Resource does not belong to the current workspace',
    });
  }

  return null;
};

export const ensureWorkspaceWriteAccess = (
  action: AuthorizationAction,
  actor: AuthorizationActor,
  resource: AuthorizationResource | null,
  deniedReason: string,
): AuthorizationDecision | null => {
  if (actor.isPlatformAdmin) {
    return null;
  }

  if (Array.isArray(actor.grantedActions)) {
    if (actor.grantedActions.includes(action)) {
      return null;
    }
  } else if (actor.workspaceRoleSource === 'role_binding') {
    return deny({
      action,
      actor,
      resource,
      reason: deniedReason,
    });
  } else if (isAuthorizationBindingOnlyEnabled()) {
    return deny({
      action,
      actor,
      resource,
      reason: deniedReason,
    });
  } else if (
    actor.workspaceRoleKeys.some((roleKey) => hasWorkspaceWriteRole(roleKey))
  ) {
    return null;
  }

  return deny({
    action,
    actor,
    resource,
    reason: deniedReason,
  });
};
