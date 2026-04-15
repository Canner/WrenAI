import type { NextApiRequest, NextApiResponse } from 'next';
import { DashboardResolver } from '@server/resolvers/dashboardResolver';
import { ApiError } from '@/apollo/server/utils/apiUtils';
import { buildResolverContextFromRequest } from '../resolverContext';
import { sendRestApiError } from '../restApi';

const dashboardResolver = new DashboardResolver();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    const ctx = await buildResolverContextFromRequest({ req });

    if (req.method === 'GET') {
      const dashboards = await dashboardResolver.getDashboards(null, null, ctx);
      return res.status(200).json(dashboards);
    }

    if (req.method === 'POST') {
      const name = String(req.body?.name || '').trim();
      if (!name) {
        throw new ApiError('Dashboard name is required', 400);
      }

      const dashboard = await dashboardResolver.createDashboard(
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
