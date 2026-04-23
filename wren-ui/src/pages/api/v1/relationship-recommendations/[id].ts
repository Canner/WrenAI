import type { NextApiRequest, NextApiResponse } from 'next';
import { ApiError } from '@/server/utils/apiUtils';
import { buildApiContextFromRequest } from '@/server/api/apiContext';
import { sendRestApiError } from '@/server/api/restApi';

const parseTaskId = (value: string | string[] | undefined) => {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || typeof raw !== 'string') {
    throw new ApiError('Task ID is invalid', 400);
  }
  return raw;
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

    const ctx = await buildApiContextFromRequest({ req });
    const result = await ctx.wrenAIAdaptor.getRelationshipRecommendationResult(
      parseTaskId(req.query.id),
    );
    return res.status(200).json({
      id: parseTaskId(req.query.id),
      status: result.status,
      response: result.response,
      error: result.error,
      traceId: result.traceId,
    });
  } catch (error) {
    return sendRestApiError(res, error, '加载推荐关系失败，请稍后重试。');
  }
}
