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
    const dashboardId = parseDashboardId(req.query.id);
    const ctx = await buildApiContextFromRequest({ req });

    if (req.method === 'GET') {
      const dashboard = await dashboardController.getDashboard(
        null,
        { where: { id: dashboardId } },
        ctx,
      );
      return res.status(200).json(dashboard);
    }

    if (req.method === 'PATCH') {
      const name =
        req.body?.name === undefined ? undefined : String(req.body.name);
      const isDefault =
        typeof req.body?.isDefault === 'boolean'
          ? req.body.isDefault
          : undefined;

      const dashboard = await dashboardController.updateDashboard(
        null,
        {
          where: { id: dashboardId },
          data: {
            ...(name !== undefined ? { name } : {}),
            ...(isDefault !== undefined ? { isDefault } : {}),
          },
        },
        ctx,
      );
      return res.status(200).json(dashboard);
    }

    if (req.method === 'DELETE') {
      const dashboard = await dashboardController.deleteDashboard(
        null,
        { where: { id: dashboardId } },
        ctx,
      );
      return res.status(200).json(dashboard);
    }

    res.setHeader('Allow', 'GET, PATCH, DELETE');
    throw new Error('Method not allowed');
  } catch (error) {
    return sendRestApiError(
      res,
      error,
      req.method === 'DELETE'
        ? '删除看板失败，请稍后重试。'
        : req.method === 'PATCH'
          ? '更新看板失败，请稍后重试。'
          : '加载看板详情失败，请稍后重试。',
    );
  }
}
