import type { NextApiRequest, NextApiResponse } from 'next';
import { DashboardController } from '@server/controllers/dashboardController';
import { ApiError } from '@/server/utils/apiUtils';
import { buildApiContextFromRequest } from '../apiContext';
import { sendRestApiError } from '../restApi';

const dashboardController = new DashboardController();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    const ctx = await buildApiContextFromRequest({ req });

    if (req.method === 'GET') {
      const dashboards = await dashboardController.getDashboards(
        null,
        null,
        ctx,
      );
      return res.status(200).json(dashboards);
    }

    if (req.method === 'POST') {
      const name = String(req.body?.name || '').trim();
      if (!name) {
        throw new ApiError('Dashboard name is required', 400);
      }

      const dashboard = await dashboardController.createDashboard(
        null,
        { data: { name } },
        ctx,
      );
      return res.status(201).json(dashboard);
    }

    res.setHeader('Allow', 'GET, POST');
    throw new Error('Method not allowed');
  } catch (error) {
    return sendRestApiError(res, error, '加载看板失败，请稍后重试。');
  }
}
