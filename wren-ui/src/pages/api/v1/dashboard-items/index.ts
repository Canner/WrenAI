import type { NextApiRequest, NextApiResponse } from 'next';
import { DashboardController } from '@server/controllers/dashboardController';
import { DashboardItemType } from '@server/repositories/dashboardItemRepository';
import { ApiError } from '@/server/utils/apiUtils';
import { buildApiContextFromRequest } from '../apiContext';
import { sendRestApiError } from '../restApi';

const dashboardController = new DashboardController();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      throw new Error('Method not allowed');
    }

    const responseId = Number(req.body?.responseId);
    const itemType = req.body?.itemType;
    const dashboardId =
      req.body?.dashboardId == null ? null : Number(req.body.dashboardId);

    if (!Number.isFinite(responseId) || responseId <= 0) {
      throw new ApiError('Response ID is required', 400);
    }
    if (
      typeof itemType !== 'string' ||
      !Object.values(DashboardItemType).includes(itemType as DashboardItemType)
    ) {
      throw new ApiError('Dashboard item type is required', 400);
    }

    const ctx = await buildApiContextFromRequest({ req });
    const item = await dashboardController.createDashboardItem(
      null,
      {
        data: {
          responseId,
          itemType: itemType as DashboardItemType,
          ...(dashboardId != null && Number.isFinite(dashboardId)
            ? { dashboardId }
            : {}),
        },
      },
      ctx,
    );

    return res.status(201).json(item);
  } catch (error) {
    return sendRestApiError(res, error, '固定到看板失败，请稍后重试。');
  }
}
