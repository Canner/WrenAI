import type { NextApiRequest, NextApiResponse } from 'next';
import { AskingResolver } from '@server/resolvers/askingResolver';
import { ApiError } from '@/apollo/server/utils/apiUtils';
import { buildResolverContextFromRequest } from '../../resolverContext';
import { sendRestApiError } from '../../restApi';

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
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      throw new Error('Method not allowed');
    }

    const ctx = await buildResolverContextFromRequest({ req });
    await askingResolver.cancelAdjustThreadResponseAnswer(
      null,
      { taskId: parseTaskId(req.query.id) },
      ctx,
    );

    return res.status(200).json({ success: true });
  } catch (error) {
    return sendRestApiError(res, error, '停止调整任务失败，请稍后重试。');
  }
}
