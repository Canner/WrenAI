import type { NextApiRequest, NextApiResponse } from 'next';
import { ApiError } from '@/apollo/server/utils/apiUtils';
import { buildResolverContextFromRequest } from '../resolverContext';
import { sendRestApiError } from '../restApi';
import {
  assertDashboardExecutableRuntimeScope,
  ensureDashboardItemForScope,
} from '../dashboardRestShared';

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
    const itemId = parseItemId(req.query.id);
    const ctx = await buildResolverContextFromRequest({ req });
    await assertDashboardExecutableRuntimeScope(ctx);
    await ensureDashboardItemForScope(ctx, itemId);

    if (req.method === 'PATCH') {
      const displayName = String(req.body?.displayName || '').trim();
      if (!displayName) {
        throw new ApiError('Display name is required', 400);
      }

      const item = await ctx.dashboardService.updateDashboardItem(itemId, {
        displayName,
      });
      return res.status(200).json(item);
    }

    if (req.method === 'DELETE') {
      const success = await ctx.dashboardService.deleteDashboardItem(itemId);
      return res.status(200).json({ success });
    }

    res.setHeader('Allow', 'PATCH, DELETE');
    throw new Error('Method not allowed');
  } catch (error) {
    return sendRestApiError(res, error, '更新看板图表失败，请稍后重试。');
  }
}
