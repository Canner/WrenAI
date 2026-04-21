import type { NextApiRequest } from 'next';
import type { IAuditEventRepository } from '@server/repositories';
import {
  assertAuthorizedWithAudit,
  AuthorizationActor,
  buildAuthorizationContextFromRequest,
  recordAuditEvent,
} from '@server/authz';
import type { ScimContext } from '@server/services/scimService';

type ScimAuditAction = 'identity_provider.read' | 'identity_provider.manage';

export const buildScimAuthorizationActor = (
  context: ScimContext,
): AuthorizationActor => ({
  principalType: 'system',
  principalId: `scim:${context.provider.id}`,
  workspaceId: context.workspace.id,
  workspaceMemberId: null,
  workspaceRoleKeys: [],
  permissionScopes: [`workspace:${context.workspace.id}`],
  isPlatformAdmin: false,
  platformRoleKeys: [],
  grantedActions: ['identity_provider.read', 'identity_provider.manage'],
  workspaceRoleSource: 'role_binding',
  platformRoleSource: 'legacy',
  sessionId: null,
});

export const getScimAuditAction = (req: NextApiRequest): ScimAuditAction =>
  req.method === 'GET' ? 'identity_provider.read' : 'identity_provider.manage';

export const buildScimAuditMetadata = ({
  req,
  context,
}: {
  req: NextApiRequest;
  context: ScimContext;
}) => ({
  actor: buildScimAuthorizationActor(context),
  auditContext: buildAuthorizationContextFromRequest({
    req,
    runtimeScope: {
      workspace: {
        id: context.workspace.id,
      },
    },
  }),
});

export const authorizeScimRequest = async ({
  auditEventRepository,
  req,
  context,
  resourceType,
  resourceId,
}: {
  auditEventRepository: IAuditEventRepository;
  req: NextApiRequest;
  context: ScimContext;
  resourceType: string;
  resourceId?: string | number | null;
}) => {
  const { actor, auditContext } = buildScimAuditMetadata({ req, context });
  const action = getScimAuditAction(req);
  await assertAuthorizedWithAudit({
    auditEventRepository,
    actor,
    action,
    resource: {
      resourceType,
      resourceId: resourceId || context.provider.id,
      workspaceId: context.workspace.id,
    },
    context: auditContext,
  });

  return { actor, auditContext, action };
};

export const recordScimReadAudit = async ({
  auditEventRepository,
  req,
  context,
  resourceType,
  resourceId,
  payloadJson,
}: {
  auditEventRepository: IAuditEventRepository;
  req: NextApiRequest;
  context: ScimContext;
  resourceType: string;
  resourceId?: string | number | null;
  payloadJson?: Record<string, any> | null;
}) => {
  const { actor, auditContext } = buildScimAuditMetadata({ req, context });
  await recordAuditEvent({
    auditEventRepository,
    actor,
    action: 'identity_provider.read',
    resource: {
      resourceType,
      resourceId: resourceId || context.provider.id,
      workspaceId: context.workspace.id,
    },
    result: 'allowed',
    context: auditContext,
    payloadJson: payloadJson || undefined,
  });
};

export const recordScimWriteAudit = async ({
  auditEventRepository,
  req,
  context,
  resourceType,
  resourceId,
  result,
  reason,
  afterJson,
  payloadJson,
}: {
  auditEventRepository: IAuditEventRepository;
  req: NextApiRequest;
  context: ScimContext;
  resourceType: string;
  resourceId?: string | number | null;
  result: 'succeeded' | 'failed';
  reason?: string | null;
  afterJson?: Record<string, any> | null;
  payloadJson?: Record<string, any> | null;
}) => {
  const { actor, auditContext } = buildScimAuditMetadata({ req, context });
  await recordAuditEvent({
    auditEventRepository,
    actor,
    action: 'identity_provider.manage',
    resource: {
      resourceType,
      resourceId: resourceId || context.provider.id,
      workspaceId: context.workspace.id,
    },
    result,
    reason: reason || null,
    context: auditContext,
    afterJson: afterJson || undefined,
    payloadJson: payloadJson || undefined,
  });
};
