import type { NextApiRequest, NextApiResponse } from 'next';
import { AskingResolver } from '@server/resolvers/askingResolver';
import { ApiError } from '@/apollo/server/utils/apiUtils';
import { buildResolverContextFromRequest } from '../../resolverContext';
import { sendRestApiError } from '../../restApi';

const askingResolver = new AskingResolver();

const parseResponseId = (value: string | string[] | undefined) => {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw new ApiError('Response ID is invalid', 400);
  }
  return id;
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
    await askingResolver.rerunAdjustThreadResponseAnswer(
      null,
      { responseId: parseResponseId(req.query.id) },
      ctx,
    );

    return res.status(200).json({ success: true });
  } catch (error) {
    return sendRestApiError(res, error, '重试调整任务失败，请稍后重试。');
  }
}
