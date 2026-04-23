import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { recordAuditEvent } from '@server/authz';
import { loadScheduleOverviewPayload } from '@server/api/workspace/schedulesOverviewSupport';
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
      action: 'platform.system_task.read',
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

    const knowledgeBaseId = getQueryString(req.query.knowledgeBaseId);
    const knowledgeBase = knowledgeBaseId
      ? await components.knowledgeBaseRepository.findOneBy({
          id: knowledgeBaseId,
          workspaceId,
        } as any)
      : null;
    if (knowledgeBaseId && !knowledgeBase) {
      throw createHttpError(404, 'Knowledge base not found');
    }

    const payload = await loadScheduleOverviewPayload({
      workspace,
      knowledgeBase,
      kbSnapshot: null,
      jobScope: knowledgeBase ? 'knowledge_base' : 'workspace',
    });

    await recordAuditEvent({
      auditEventRepository: components.auditEventRepository,
      actor: context.actor,
      action: 'platform.system_task.read',
      resource: {
        resourceType: 'schedule_job',
        resourceId: workspaceId,
        workspaceId,
      },
      result: 'allowed',
      context: context.auditContext,
      payloadJson: {
        workspaceId,
        knowledgeBaseId: knowledgeBase?.id || null,
      },
    });

    return res.status(200).json(payload);
  } catch (error: any) {
    return res.status(error?.statusCode || 400).json({
      error: error?.message || 'Failed to load platform system tasks',
    });
  }
}
