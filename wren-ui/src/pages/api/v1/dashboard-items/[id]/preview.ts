import type { NextApiRequest, NextApiResponse } from 'next';
import { ApiError } from '@/server/utils/apiUtils';
import { buildApiContextFromRequest } from '@/server/api/apiContext';
import { sendRestApiError } from '@/server/api/restApi';
import {
  assertDashboardExecutableRuntimeScope,
  assertDashboardKnowledgeBaseReadAccess,
  buildDashboardPreviewResponse,
  ensureDashboardForWorkspaceScope,
  ensureDashboardItemForScope,
  recordDashboardKnowledgeBaseReadAudit,
} from '@/server/api/dashboardRestShared';

const parseItemId = (value: string | string[] | undefined) => {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number(raw);
  if (!Number.isFinite(id)) {
    throw new ApiError('Dashboard item id is required', 400);
  }
  return id;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      throw new Error('Method not allowed');
    }

    const itemId = parseItemId(req.query.id);
    const ctx = await buildApiContextFromRequest({ req });
    await assertDashboardKnowledgeBaseReadAccess(ctx);
    const item = await ensureDashboardItemForScope(ctx, itemId);
    if (!item.detail.runtimeIdentity) {
      await assertDashboardExecutableRuntimeScope(ctx);
    }
    const dashboard = await ensureDashboardForWorkspaceScope(
      ctx,
      item.dashboardId,
    );
    const preview = await buildDashboardPreviewResponse({
      ctx,
      dashboard,
      item,
      limit: req.body?.limit,
      refresh: req.body?.refresh,
    });

    await recordDashboardKnowledgeBaseReadAudit(ctx, {
      resourceType: 'dashboard_item',
      resourceId: itemId,
      payloadJson: {
        operation: 'preview_item_sql',
      },
    });

    return res.status(200).json(preview);
  } catch (error) {
    return sendRestApiError(res, error, '加载看板图表失败，请稍后重试。');
  }
}
