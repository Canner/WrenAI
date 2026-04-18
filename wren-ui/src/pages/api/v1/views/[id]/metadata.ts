import type { NextApiRequest, NextApiResponse } from 'next';
import { ModelController } from '@server/controllers/modelController';
import { ApiError } from '@/server/utils/apiUtils';
import { buildApiContextFromRequest } from '../../apiContext';
import { sendRestApiError } from '../../restApi';

const modelController = new ModelController();

const parseViewId = (value: string | string[] | undefined) => {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw new ApiError('View ID is invalid', 400);
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

    const ctx = await buildApiContextFromRequest({ req });
    await modelController.updateViewMetadata({
      viewId: parseViewId(req.query.id),
      data: req.body || {},
      ctx,
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    return sendRestApiError(res, error, '更新视图元数据失败，请稍后重试。');
  }
}
