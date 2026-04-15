import type { NextApiRequest, NextApiResponse } from 'next';
import { AskingResolver } from '@server/resolvers/askingResolver';
import { ApiError } from '@/apollo/server/utils/apiUtils';
import { buildResolverContextFromRequest } from '../resolverContext';
import { sendRestApiError } from '../restApi';

const askingResolver = new AskingResolver();

const parseTaskId = (value: string | string[] | undefined) => {
  const taskId = Array.isArray(value) ? value[0] : value;
  if (!taskId) {
    throw new ApiError('Task ID is required', 400);
  }

  return taskId;
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

    const ctx = await buildResolverContextFromRequest({ req });
    const task = await askingResolver.getInstantRecommendedQuestions(
      null,
      { taskId: parseTaskId(req.query.id) },
      ctx,
    );

    return res.status(200).json(task);
  } catch (error) {
    return sendRestApiError(res, error, '加载推荐问题失败，请稍后重试。');
  }
}
