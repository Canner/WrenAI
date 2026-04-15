import type { NextApiRequest, NextApiResponse } from 'next';
import { LearningResolver } from '@server/resolvers/learningResolver';
import { ApiError } from '@/apollo/server/utils/apiUtils';
import { buildResolverContextFromRequest } from '../resolverContext';
import { sendRestApiError } from '../restApi';

const learningResolver = new LearningResolver();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    const ctx = await buildResolverContextFromRequest({ req });

    if (req.method === 'GET') {
      const result = await learningResolver.getLearningRecord(null, null, ctx);
      return res.status(200).json(result);
    }

    if (req.method === 'POST') {
      const path = String(req.body?.path || '').trim();
      if (!path) {
        throw new ApiError('Learning path is required', 400);
      }

      const result = await learningResolver.saveLearningRecord(
        null,
        { data: { path } },
        ctx,
      );
      return res.status(200).json(result);
    }

    res.setHeader('Allow', 'GET, POST');
    throw new Error('Method not allowed');
  } catch (error) {
    return sendRestApiError(res, error, '加载学习记录失败，请稍后重试。');
  }
}
