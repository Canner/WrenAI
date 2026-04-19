import type { NextApiRequest, NextApiResponse } from 'next';
import { DashboardController } from '@server/controllers/dashboardController';
import { ApiError } from '@/server/utils/apiUtils';
import { buildApiContextFromRequest } from '@/server/api/apiContext';
import { sendRestApiError } from '@/server/api/restApi';

const dashboardController = new DashboardController();

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
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      throw new Error('Method not allowed');
    }

    const dashboardId = parseDashboardId(req.query.id);
    const ctx = await buildApiContextFromRequest({ req });
    const dashboard = await dashboardController.getDashboard(
      null,
      { where: { id: dashboardId } },
      ctx,
    );
    return res.status(200).json(dashboard);
  } catch (error) {
    return sendRestApiError(res, error, '加载看板详情失败，请稍后重试。');
  }
}
