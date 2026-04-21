import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { recordAuditEvent, searchWorkspaceAuditEvents } from '@server/authz';
import {
  createHttpError,
  getQueryString,
  requirePlatformActionContext,
} from '@server/api/platform/platformApiUtils';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const context = await requirePlatformActionContext({
      req,
      action: 'platform.audit.read',
    });
    const workspaceId =
      getQueryString(req.query.workspaceId) ||
      context.validatedSession.workspace.id;
    const workspace = await components.workspaceRepository.findOneBy({
      id: workspaceId,
    });
    if (!workspace) {
      throw createHttpError(404, 'Workspace not found');
    }

    const events = await searchWorkspaceAuditEvents({
      workspaceId,
      preset: getQueryString(req.query.preset) || null,
      action: getQueryString(req.query.action) || undefined,
      actorType: getQueryString(req.query.actorType) || undefined,
      actorId: getQueryString(req.query.actorId) || undefined,
      resourceType: getQueryString(req.query.resourceType) || undefined,
      resourceId: getQueryString(req.query.resourceId) || undefined,
      result: getQueryString(req.query.result) || undefined,
      query: getQueryString(req.query.query) || undefined,
      limit: Number.parseInt(getQueryString(req.query.limit) || '50', 10),
      auditEventRepository: components.auditEventRepository,
    });

    await recordAuditEvent({
      auditEventRepository: components.auditEventRepository,
      actor: context.actor,
      action: 'platform.audit.read',
      resource: {
        resourceType: 'audit_event',
        resourceId: workspaceId,
        workspaceId,
      },
      result: 'allowed',
      context: context.auditContext,
      payloadJson: {
        workspaceId,
        preset: getQueryString(req.query.preset) || null,
      },
    });

    return res.status(200).json({
      workspace: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug || null,
      },
      events,
    });
  } catch (error: any) {
    const message = error?.message || 'Failed to query platform audit events';
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
