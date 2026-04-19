import type { NextApiRequest, NextApiResponse } from 'next';
import { LearningController } from '@server/controllers/learningController';
import { ApiError } from '@/server/utils/apiUtils';
import { buildApiContextFromRequest } from '@/server/api/apiContext';
import { sendRestApiError } from '@/server/api/restApi';

const learningController = new LearningController();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    const ctx = await buildApiContextFromRequest({ req });

    if (req.method === 'GET') {
      const result = await learningController.getLearningRecord({ ctx });
      return res.status(200).json(result);
    }

    if (req.method === 'POST') {
      const path = String(req.body?.path || '').trim();
      if (!path) {
        throw new ApiError('Learning path is required', 400);
      }

      const result = await learningController.saveLearningRecord({ path, ctx });
      return res.status(200).json(result);
    }

    res.setHeader('Allow', 'GET, POST');
    throw new Error('Method not allowed');
  } catch (error) {
    return sendRestApiError(res, error, '加载学习记录失败，请稍后重试。');
  }
}
