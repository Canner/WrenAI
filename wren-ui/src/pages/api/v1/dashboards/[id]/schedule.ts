import type { NextApiRequest, NextApiResponse } from 'next';
import { ApiError } from '@/apollo/server/utils/apiUtils';
import { buildResolverContextFromRequest } from '../../resolverContext';
import { sendRestApiError } from '../../restApi';
import { updateDashboardScheduleWithSync } from '../../dashboardRestShared';

const parseDashboardId = (value: string | string[] | undefined) => {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number(raw);
  if (!Number.isFinite(id)) {
    throw new ApiError('Dashboard id is required', 400);
  }
  return id;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method !== 'PATCH') {
      res.setHeader('Allow', 'PATCH');
      throw new Error('Method not allowed');
    }

    const dashboardId = parseDashboardId(req.query.id);
    const ctx = await buildResolverContextFromRequest({ req });
    const dashboard = await updateDashboardScheduleWithSync({
      ctx,
      dashboardId,
      data: req.body,
    });
    return res.status(200).json(dashboard);
  } catch (error) {
    return sendRestApiError(res, error, '更新看板调度失败，请稍后重试。');
  }
}
