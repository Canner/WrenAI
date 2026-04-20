import {
  getConnectorScopeRestrictionReason,
  isDefaultWorkspace,
  isSystemSampleKnowledgeBase,
} from '@/utils/workspaceGovernance';
import { AuthorizationActor } from './authorizationActor';
import {
  allow,
  AuthorizationError,
  deny,
  type AuthorizationContext,
  type AuthorizationDecision,
  type AuthorizationResource,
} from './authorizationDecision';
import {
  AuthorizationAction,
  getAuthorizationActionMeta,
} from './permissionRegistry';
import {
  actorHasAction,
  actorHasPlatformAction,
  ensureWorkspaceBoundary,
  ensureWorkspaceWriteAccess,
} from './authorizationPermissionChecks';
import {
  canManageWorkspaceMemberRole,
  isProtectedWorkspaceMemberAction,
} from './rules';
export type {
  AuthorizationContext,
  AuthorizationDecision,
  AuthorizationResource,
} from './authorizationDecision';
export { AuthorizationError } from './authorizationDecision';

export const authorize = ({
  actor,
  action,
  resource = null,
}: {
  actor: AuthorizationActor | null;
  action: AuthorizationAction;
  resource?: AuthorizationResource | null;
  context?: AuthorizationContext;
}): AuthorizationDecision => {
  if (!actor) {
    return deny({
      action,
      actor: null,
      resource,
      reason: 'Authentication required',
      statusCode: 401,
    });
  }

  const meta = getAuthorizationActionMeta(action);
  const workspaceBoundaryDecision = ensureWorkspaceBoundary(
    action,
    actor,
    resource,
  );
  if (workspaceBoundaryDecision) {
    return workspaceBoundaryDecision;
  }

  if (meta.scope === 'platform') {
    return actorHasPlatformAction(actor, action)
      ? allow({ action, actor, resource })
      : deny({
          action,
          actor,
          resource,
          reason: `Platform permission required: ${action}`,
        });
  }

  if (action === 'workspace.default.set') {
    if (resource?.ownerUserId && resource.ownerUserId !== actor.principalId) {
      return deny({
        action,
        actor,
        resource,
        reason: 'You can only update your own workspace preference',
      });
    }
    return allow({ action, actor, resource });
  }

  if (
    [
      'workspace.member.invite',
      'workspace.member.approve',
      'workspace.member.reject',
      'workspace.member.status.update',
      'workspace.member.remove',
      'workspace.member.role.update',
    ].includes(action)
  ) {
    const managerDecision = ensureWorkspaceWriteAccess(
      action,
      actor,
      resource,
      'Workspace manager permission required',
    );
    if (managerDecision) {
      return managerDecision;
    }

    if (isDefaultWorkspace(resource?.attributes?.workspaceKind)) {
      return deny({
        action,
        actor,
        resource,
        reason: 'Default workspace does not support manual invitations',
      });
    }

    if (
      isProtectedWorkspaceMemberAction({
        actorUserId: actor.principalId,
        targetUserId: resource?.attributes?.targetUserId,
        action,
      })
    ) {
      return deny({
        action,
        actor,
        resource,
        reason:
          action === 'workspace.member.remove'
            ? 'You cannot remove yourself from the current workspace'
            : action === 'workspace.member.status.update'
              ? 'You cannot change your own member status here'
              : 'You cannot change your own role here',
        statusCode: 400,
      });
    }

    if (
      !actor.isPlatformAdmin &&
      !canManageWorkspaceMemberRole({
        actorRoleKey: actor.workspaceRoleKeys[0],
        targetRoleKey: resource?.attributes?.targetRoleKey,
        nextRoleKey:
          resource?.attributes?.nextRoleKey ||
          resource?.attributes?.targetRoleKey,
      })
    ) {
      return deny({
        action,
        actor,
        resource,
        reason:
          action === 'workspace.member.role.update'
            ? 'You do not have permission to set this role'
            : 'You do not have permission to manage this member',
      });
    }

    return allow({ action, actor, resource });
  }

  if (
    ['workspace.schedule.manage', 'dashboard.schedule.manage'].includes(action)
  ) {
    if (actorHasAction(actor, action)) {
      return allow({ action, actor, resource });
    }

    return deny({
      action,
      actor,
      resource,
      reason: 'Workspace manager permission required',
    });
  }

  if (
    [
      'knowledge_base.create',
      'knowledge_base.update',
      'knowledge_base.archive',
    ].includes(action)
  ) {
    const writeDecision = ensureWorkspaceWriteAccess(
      action,
      actor,
      resource,
      'Knowledge base write permission required',
    );
    if (writeDecision) {
      return writeDecision;
    }

    if (isDefaultWorkspace(resource?.attributes?.workspaceKind)) {
      return deny({
        action,
        actor,
        resource,
        reason: 'Default workspace does not support mutable knowledge bases',
      });
    }

    if (isSystemSampleKnowledgeBase(resource?.attributes?.knowledgeBaseKind)) {
      return deny({
        action,
        actor,
        resource,
        reason: 'System sample knowledge base cannot be modified',
      });
    }

    return allow({ action, actor, resource });
  }

  if (action === 'knowledge_base.read') {
    return actorHasAction(actor, action)
      ? allow({ action, actor, resource })
      : deny({
          action,
          actor,
          resource,
          reason: 'Knowledge base read permission required',
        });
  }

  if (
    [
      'connector.create',
      'connector.update',
      'connector.delete',
      'connector.rotate_secret',
    ].includes(action)
  ) {
    const writeDecision = ensureWorkspaceWriteAccess(
      action,
      actor,
      resource,
      'Connector management permission required',
    );
    if (writeDecision) {
      return writeDecision;
    }

    const restrictionReason = getConnectorScopeRestrictionReason({
      workspaceKind: resource?.attributes?.workspaceKind,
      knowledgeBaseKind: resource?.attributes?.knowledgeBaseKind,
    });
    if (restrictionReason) {
      return deny({
        action,
        actor,
        resource,
        reason: restrictionReason,
      });
    }

    return allow({ action, actor, resource });
  }

  if (action === 'connector.read') {
    return actorHasAction(actor, action)
      ? allow({ action, actor, resource })
      : deny({
          action,
          actor,
          resource,
          reason: 'Connector read permission required',
        });
  }

  if (
    [
      'skill.create',
      'skill.update',
      'skill.delete',
      'secret.reencrypt',
    ].includes(action)
  ) {
    const writeDecision = ensureWorkspaceWriteAccess(
      action,
      actor,
      resource,
      action === 'secret.reencrypt'
        ? 'Secret re-encrypt permission required'
        : 'Skill management permission required',
    );
    if (writeDecision) {
      return writeDecision;
    }
    return allow({ action, actor, resource });
  }

  if (
    [
      'service_account.create',
      'service_account.update',
      'service_account.delete',
      'api_token.create',
      'api_token.revoke',
      'identity_provider.manage',
      'access_review.manage',
      'group.manage',
    ].includes(action)
  ) {
    const writeDecision = ensureWorkspaceWriteAccess(
      action,
      actor,
      resource,
      action.startsWith('service_account')
        ? 'Service account management permission required'
        : action.startsWith('api_token')
          ? 'API token management permission required'
          : action.startsWith('identity_provider')
            ? 'Identity provider management permission required'
            : action.startsWith('group')
              ? 'Directory group management permission required'
              : 'Access review management permission required',
    );
    if (writeDecision) {
      return writeDecision;
    }

    if (isDefaultWorkspace(resource?.attributes?.workspaceKind)) {
      return deny({
        action,
        actor,
        resource,
        reason: 'Default workspace does not support this governance action',
      });
    }

    return allow({ action, actor, resource });
  }

  if (
    [
      'service_account.read',
      'api_token.read',
      'identity_provider.read',
      'access_review.read',
      'group.read',
      'audit.read',
      'role.read',
    ].includes(action)
  ) {
    return actorHasAction(actor, action)
      ? allow({ action, actor, resource })
      : deny({
          action,
          actor,
          resource,
          reason:
            action === 'identity_provider.read'
              ? 'Identity provider read permission required'
              : action === 'access_review.read'
                ? 'Access review read permission required'
                : action === 'group.read'
                  ? 'Directory group read permission required'
                  : action === 'audit.read'
                    ? 'Audit read permission required'
                    : action === 'role.read'
                      ? 'Role read permission required'
                      : 'Automation governance read permission required',
        });
  }

  if (action === 'role.manage') {
    return actorHasAction(actor, action)
      ? allow({ action, actor, resource })
      : deny({
          action,
          actor,
          resource,
          reason: 'Role manage permission required',
        });
  }

  if (action === 'skill.read') {
    return actorHasAction(actor, action)
      ? allow({ action, actor, resource })
      : deny({
          action,
          actor,
          resource,
          reason: 'Skill read permission required',
        });
  }

  if (action === 'workspace.read') {
    return actorHasAction(actor, action)
      ? allow({ action, actor, resource })
      : deny({
          action,
          actor,
          resource,
          reason: 'Workspace read permission required',
        });
  }

  return deny({
    action,
    actor,
    resource,
    reason: 'Permission denied',
  });
};

export const assertAuthorized = (params: {
  actor: AuthorizationActor | null;
  action: AuthorizationAction;
  resource?: AuthorizationResource | null;
  context?: AuthorizationContext;
}) => {
  const decision = authorize(params);
  if (!decision.allowed) {
    throw new AuthorizationError(
      decision.action,
      decision.reason || 'Permission denied',
      decision.statusCode,
    );
  }

  return decision;
};
