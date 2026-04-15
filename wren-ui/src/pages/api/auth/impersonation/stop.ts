import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { buildSessionCookie } from '../sessionCookie';
import { getSessionTokenFromRequest } from '@server/context/actorClaims';
import {
  buildAuthorizationActorFromValidatedSession,
  buildAuthorizationContextFromRequest,
  recordAuditEvent,
} from '@server/authz';
import { resolveBootstrapKnowledgeBaseSelection } from '@server/utils/runtimeSelectorState';
import { KBSnapshot, KnowledgeBase } from '@server/repositories';

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

    const validatedSession =
      await components.authService.validateSession(sessionToken);
    if (!validatedSession) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!validatedSession.session.impersonatorUserId) {
      return res
        .status(400)
        .json({ error: 'Current session is not impersonated' });
    }

    const actor = buildAuthorizationActorFromValidatedSession(validatedSession);
    const auditContext = buildAuthorizationContextFromRequest({
      req,
      sessionId: actor.sessionId,
    });

    const authResult =
      await components.governanceService.stopImpersonation(validatedSession);
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
      action: 'impersonation.stop',
      resource: {
        resourceType: 'user',
        resourceId: validatedSession.user.id,
        workspaceId: validatedSession.workspace.id,
      },
      result: 'succeeded',
      context: auditContext,
      payloadJson: {
        impersonatorUserId: validatedSession.session.impersonatorUserId,
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
    return res.status(400).json({
      error: error?.message || 'Failed to stop impersonation',
    });
  }
}
