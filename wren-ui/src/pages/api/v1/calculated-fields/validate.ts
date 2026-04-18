import type { NextApiRequest, NextApiResponse } from 'next';
import { ModelController } from '@server/controllers/modelController';
import { ApiError } from '@/server/utils/apiUtils';
import { buildApiContextFromRequest } from '../apiContext';
import { sendRestApiError } from '../restApi';

const modelController = new ModelController();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      throw new Error('Method not allowed');
    }

    const { modelId, columnId, name } = req.body || {};
    if (!Number.isFinite(Number(modelId)) || typeof name !== 'string') {
      throw new ApiError('Calculated field validation payload is invalid', 400);
    }

    const ctx = await buildApiContextFromRequest({ req });
    const validation = await modelController.validateCalculatedField({
      name,
      modelId: Number(modelId),
      ...(columnId != null ? { columnId: Number(columnId) } : {}),
      ctx,
    });

    return res.status(200).json(validation);
  } catch (error) {
    return sendRestApiError(res, error, '校验计算字段失败，请稍后重试。');
  }
}
