import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { getSessionTokenFromRequest } from '@server/context/actorClaims';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromValidatedSession,
  buildAuthorizationContextFromRequest,
  recordAuditEvent,
} from '@server/authz';

const getQueryString = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const getString = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'PATCH') {
    res.setHeader('Allow', 'PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const sessionToken = getSessionTokenFromRequest(req);
    if (!sessionToken) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const workspaceId = getQueryString(req.query.workspaceId);
    const accessReviewId = getQueryString(req.query.id);
    if (!accessReviewId) {
      return res.status(400).json({ error: 'access review id is required' });
    }

    const validatedSession = await components.authService.validateSession(
      sessionToken,
      workspaceId,
    );
    if (!validatedSession) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const actor = buildAuthorizationActorFromValidatedSession(validatedSession);
    const auditContext = buildAuthorizationContextFromRequest({
      req,
      sessionId: actor.sessionId,
    });

    await assertAuthorizedWithAudit({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'access_review.manage',
      resource: {
        resourceType: 'access_review',
        resourceId: accessReviewId,
        workspaceId: validatedSession.workspace.id,
        attributes: {
          workspaceKind: validatedSession.workspace.kind || null,
        },
      },
      context: auditContext,
    });

    const itemId = getString(req.body?.itemId);
    const decision = getString(req.body?.decision) as 'keep' | 'remove';
    if (!itemId || !['keep', 'remove'].includes(decision)) {
      return res
        .status(400)
        .json({ error: 'itemId and decision are required' });
    }

    const accessReview =
      await components.governanceService.reviewAccessReviewItem({
        validatedSession,
        accessReviewId,
        itemId,
        decision,
        notes: getString(req.body?.notes) || null,
      });

    await recordAuditEvent({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'access_review.manage',
      resource: {
        resourceType: 'access_review_item',
        resourceId: itemId,
        workspaceId: validatedSession.workspace.id,
      },
      result: 'succeeded',
      context: auditContext,
      payloadJson: {
        accessReviewId,
        decision,
      },
      afterJson: accessReview as any,
    });

    return res.status(200).json({ accessReview });
  } catch (error: any) {
    const message = error?.message || 'Failed to update access review';
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
