import type { NextApiRequest, NextApiResponse } from 'next';
import { ApiError } from '@/apollo/server/utils/apiUtils';
import { buildResolverContextFromRequest } from '../resolverContext';
import { sendRestApiError } from '../restApi';
import {
  assertDashboardExecutableRuntimeScope,
  ensureDashboardItemForScope,
} from '../dashboardRestShared';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method !== 'PATCH') {
      res.setHeader('Allow', 'PATCH');
      throw new Error('Method not allowed');
    }

    const layouts = Array.isArray(req.body?.layouts) ? req.body.layouts : [];
    if (layouts.length === 0) {
      throw new ApiError('Layouts are required', 400);
    }

    const ctx = await buildResolverContextFromRequest({ req });
    await assertDashboardExecutableRuntimeScope(ctx);
    await Promise.all(
      layouts.map((layout: { itemId: number }) =>
        ensureDashboardItemForScope(ctx, layout.itemId),
      ),
    );
    const items =
      await ctx.dashboardService.updateDashboardItemLayouts(layouts);
    return res.status(200).json(items);
  } catch (error) {
    return sendRestApiError(res, error, '更新看板布局失败，请稍后重试。');
  }
}
