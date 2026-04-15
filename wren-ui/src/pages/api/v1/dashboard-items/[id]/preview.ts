import type { NextApiRequest, NextApiResponse } from 'next';
import { ApiError } from '@/apollo/server/utils/apiUtils';
import { buildResolverContextFromRequest } from '../../resolverContext';
import { sendRestApiError } from '../../restApi';
import {
  assertDashboardExecutableRuntimeScope,
  assertDashboardKnowledgeBaseReadAccess,
  buildDashboardPreviewResponse,
  ensureDashboardForScope,
  ensureDashboardItemForScope,
  recordDashboardKnowledgeBaseReadAudit,
} from '../../dashboardRestShared';

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
    const ctx = await buildResolverContextFromRequest({ req });
    await assertDashboardKnowledgeBaseReadAccess(ctx);
    await assertDashboardExecutableRuntimeScope(ctx);
    const item = await ensureDashboardItemForScope(ctx, itemId);
    const dashboard = await ensureDashboardForScope(ctx, item.dashboardId);
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
