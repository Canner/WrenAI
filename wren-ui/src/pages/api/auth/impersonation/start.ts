import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { buildSessionCookie } from '@server/api/auth/sessionCookie';
import { getSessionTokenFromRequest } from '@server/context/actorClaims';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromValidatedSession,
  buildAuthorizationContextFromRequest,
  recordAuditEvent,
} from '@server/authz';
import { resolveBootstrapKnowledgeBaseSelection } from '@server/utils/runtimeSelectorState';
import { KBSnapshot, KnowledgeBase } from '@server/repositories';

const getString = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const toRuntimeSelector = (
  workspaceId: string,
  knowledgeBase: KnowledgeBase | null,
  snapshot: KBSnapshot | null,
) => ({
  workspaceId,
  knowledgeBaseId: knowledgeBase?.id || null,
  kbSnapshotId: snapshot?.id || null,
  deployHash: snapshot?.deployHash || null,
});

const resolveWorkspaceRuntimeSelector = async (workspaceId: string) => {
  const knowledgeBases = await components.knowledgeBaseRepository.findAllBy({
    workspaceId,
  });
  const { knowledgeBase, snapshot } =
    await resolveBootstrapKnowledgeBaseSelection(
      knowledgeBases,
      components.kbSnapshotRepository,
    );

  return toRuntimeSelector(workspaceId, knowledgeBase, snapshot);
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const sessionToken = getSessionTokenFromRequest(req);
    if (!sessionToken) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const workspaceId = getString(req.body?.workspaceId) || undefined;
    const validatedSession = await components.authService.validateSession(
      sessionToken,
      workspaceId,
    );
    if (!validatedSession) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const targetUserId = getString(req.body?.targetUserId);
    const targetWorkspaceId =
      getString(req.body?.targetWorkspaceId) || undefined;
    const reason = getString(req.body?.reason);
    if (!targetUserId || !reason) {
      return res
        .status(400)
        .json({ error: 'targetUserId and reason are required' });
    }

    const actor = buildAuthorizationActorFromValidatedSession(validatedSession);
    const auditContext = buildAuthorizationContextFromRequest({
      req,
      sessionId: actor.sessionId,
    });
    await assertAuthorizedWithAudit({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'impersonation.start',
      resource: {
        resourceType: 'user',
        resourceId: targetUserId,
      },
      context: auditContext,
    });

    const authResult = await components.governanceService.startImpersonation({
      validatedSession,
      targetUserId,
      workspaceId: targetWorkspaceId,
      reason,
    });
    const runtimeSelector = await resolveWorkspaceRuntimeSelector(
      authResult.workspace.id,
    );

    res.setHeader(
      'Set-Cookie',
      buildSessionCookie(authResult.sessionToken, req),
    );

    await recordAuditEvent({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'impersonation.start',
      resource: {
        resourceType: 'user',
        resourceId: targetUserId,
        workspaceId: authResult.workspace.id,
      },
      result: 'succeeded',
      context: auditContext,
      payloadJson: {
        targetWorkspaceId: authResult.workspace.id,
        reason,
      },
    });

    return res.status(200).json({
      ok: true,
      workspace: authResult.workspace,
      membership: authResult.membership,
      user: authResult.user,
      runtimeSelector,
    });
  } catch (error: any) {
    const message = error?.message || 'Failed to start impersonation';
    const statusCode =
      error?.statusCode ||
      (/permission required/i.test(message)
        ? 403
        : /not found/i.test(message)
          ? 404
          : 400);
    return res.status(statusCode).json({ error: message });
  }
}
