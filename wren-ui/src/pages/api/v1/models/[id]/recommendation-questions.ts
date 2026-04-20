import type { NextApiRequest, NextApiResponse } from 'next';
import { ModelController } from '@server/controllers/modelController';
import { ApiError } from '@/server/utils/apiUtils';
import { buildApiContextFromRequest } from '@/server/api/apiContext';
import { sendRestApiError } from '@/server/api/restApi';

const modelController = new ModelController();

const parseModelId = (value: string | string[] | undefined) => {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw new ApiError('Model ID is invalid', 400);
  }
  return id;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    const modelId = parseModelId(req.query.id);
    const ctx = await buildApiContextFromRequest({ req });

    if (req.method === 'POST') {
      const recommendation =
        await modelController.generateModelRecommendationQuestions({
          modelId,
          ctx,
        });
      return res.status(200).json(recommendation);
    }

    if (req.method === 'GET') {
      const recommendation =
        await modelController.getModelRecommendationQuestions({
          modelId,
          ctx,
        });
      return res.status(200).json(recommendation);
    }

    res.setHeader('Allow', 'GET, POST');
    throw new Error('Method not allowed');
  } catch (error) {
    return sendRestApiError(res, error, '加载模型建议问题失败，请稍后重试。');
  }
}
