import crypto from 'crypto';
import { NextApiRequest } from 'next';
import { IAuditEventRepository } from '@server/repositories';
import { AuthorizationActor } from './authorizationActor';
import {
  AuthorizationAction,
  getAuthorizationActionMeta,
  isAuthorizationAction,
} from './permissionRegistry';
import {
  AuthorizationContext,
  AuthorizationDecision,
  AuthorizationError,
  AuthorizationResource,
  authorize,
} from './authorize';
import { getLogger } from '@server/utils';

const logger = getLogger('AuthorizationAudit');

const coerceHeader = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] || null : value || null;

const resolveRequestIpAddress = (req: NextApiRequest) => {
  const forwardedFor = coerceHeader(req.headers['x-forwarded-for']);
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || null;
  }

  return (
    coerceHeader(req.headers['x-real-ip']) || req.socket?.remoteAddress || null
  );
};

export const buildAuthorizationContextFromRequest = ({
  req,
  sessionId,
  runtimeScope,
}: {
  req: NextApiRequest;
  sessionId?: string | null;
  runtimeScope?: Record<string, any> | null;
}): AuthorizationContext => ({
  requestId:
    coerceHeader(req.headers['x-request-id']) ||
    coerceHeader(req.headers['x-correlation-id']) ||
    null,
  sessionId: sessionId || null,
  ipAddress: resolveRequestIpAddress(req),
  userAgent: coerceHeader(req.headers['user-agent']),
  runtimeScope: runtimeScope || null,
});

export const recordAuditEvent = async ({
  auditEventRepository,
  actor,
  action,
  resource,
  result,
  reason,
  context,
  beforeJson,
  afterJson,
  payloadJson,
}: {
  auditEventRepository: IAuditEventRepository;
  actor?: AuthorizationActor | null;
  action: AuthorizationAction | string;
  resource?: AuthorizationResource | null;
  result: 'allowed' | 'denied' | 'succeeded' | 'failed';
  reason?: string | null;
  context?: AuthorizationContext;
  beforeJson?: Record<string, any> | null;
  afterJson?: Record<string, any> | null;
  payloadJson?: Record<string, any> | null;
}) => {
  const normalizedAction =
    typeof action === 'string' && isAuthorizationAction(action)
      ? action
      : String(action);
  const actionMeta =
    typeof action === 'string' && isAuthorizationAction(action)
      ? getAuthorizationActionMeta(action)
      : null;

  const scopeType =
    (actionMeta?.scope === 'platform'
      ? 'platform'
      : resource?.workspaceId
        ? 'workspace'
        : actor?.isPlatformAdmin
          ? 'platform'
          : (context?.runtimeScope?.workspace?.id as string | undefined)
            ? 'workspace'
            : null) || null;
  const scopeId =
    (actionMeta?.scope === 'platform' ? 'platform' : null) ||
    resource?.workspaceId ||
    actor?.workspaceId ||
    (context?.runtimeScope?.workspace?.id as string | undefined) ||
    (scopeType === 'platform' ? 'platform' : null);
  const workspaceId =
    actionMeta?.scope === 'platform'
      ? null
      : resource?.workspaceId ||
        actor?.workspaceId ||
        (context?.runtimeScope?.workspace?.id as string | undefined) ||
        null;

  if (!workspaceId && scopeType !== 'platform') {
    logger.warn(
      `Skip audit event because no workspace/platform scope is available (action=${normalizedAction})`,
    );
    return;
  }

  try {
    await auditEventRepository.createOne({
      id: crypto.randomUUID(),
      workspaceId,
      scopeType,
      scopeId: scopeId || null,
      actorType: actor?.principalType || 'system',
      actorId: actor?.principalId || null,
      actorUserId: actor?.principalType === 'user' ? actor.principalId : null,
      action: normalizedAction,
      entityType: resource?.resourceType || 'authorization',
      entityId: resource?.resourceId ? String(resource.resourceId) : 'n/a',
      resourceType: resource?.resourceType || 'authorization',
      resourceId: resource?.resourceId ? String(resource.resourceId) : 'n/a',
      eventType: normalizedAction,
      result,
      reason: reason || null,
      beforeJson: beforeJson || null,
      afterJson: afterJson || null,
      payloadJson:
        payloadJson || reason
          ? {
              ...(payloadJson || {}),
              ...(reason ? { reason } : {}),
            }
          : null,
      requestId: context?.requestId || null,
      sessionId: context?.sessionId || actor?.sessionId || null,
      ipAddress: context?.ipAddress || null,
      userAgent: context?.userAgent || null,
    });
  } catch (error) {
    logger.warn(
      `Failed to persist audit event (action=${normalizedAction}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

export const assertAuthorizedWithAudit = async ({
  auditEventRepository,
  actor,
  action,
  resource,
  context,
}: {
  auditEventRepository: IAuditEventRepository;
  actor: AuthorizationActor | null;
  action: AuthorizationAction;
  resource?: AuthorizationResource | null;
  context?: AuthorizationContext;
}): Promise<AuthorizationDecision> => {
  const decision = authorize({
    actor,
    action,
    resource,
    context,
  });

  if (!decision.allowed) {
    await recordAuditEvent({
      auditEventRepository,
      actor,
      action,
      resource,
      result: 'denied',
      reason: decision.reason,
      context,
    });
    throw new AuthorizationError(
      action,
      decision.reason || 'Permission denied',
      decision.statusCode,
    );
  }

  return decision;
};
