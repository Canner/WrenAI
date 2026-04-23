import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  buildAuthorizationContextFromRequest,
} from '@server/authz';
import { loadScheduleOverviewPayload } from '@server/api/workspace/schedulesOverviewSupport';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const runtimeScope =
      await components.runtimeScopeResolver.resolveRequestScope(req);
    const workspace = runtimeScope.workspace;
    if (!workspace) {
      throw new Error('Workspace scope is required');
    }

    const actor = buildAuthorizationActorFromRuntimeScope(runtimeScope);
    await assertAuthorizedWithAudit({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'workspace.schedule.manage',
      resource: {
        resourceType: 'workspace',
        resourceId: workspace.id,
        workspaceId: workspace.id,
      },
      context: buildAuthorizationContextFromRequest({
        req,
        sessionId: actor?.sessionId,
        runtimeScope,
      }),
    });

    const payload = await loadScheduleOverviewPayload({
      workspace,
      knowledgeBase: runtimeScope.knowledgeBase || null,
      kbSnapshot: runtimeScope.kbSnapshot || null,
      jobScope: 'workspace',
    });

    return res.status(200).json(payload);
  } catch (error: any) {
    return res.status(error?.statusCode || 400).json({
      error: error?.message || 'Failed to load workspace schedules',
    });
  }
}
