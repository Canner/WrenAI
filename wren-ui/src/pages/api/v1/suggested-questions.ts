import type { NextApiRequest, NextApiResponse } from 'next';
import { AskingResolver } from '@server/resolvers/askingResolver';
import { buildResolverContextFromRequest } from './resolverContext';
import { sendRestApiError } from './restApi';

const askingResolver = new AskingResolver();

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
    const suggestedQuestions = await askingResolver.getSuggestedQuestions(
      null,
      null,
      ctx,
    );

    return res.status(200).json(suggestedQuestions);
  } catch (error) {
    return sendRestApiError(res, error, '加载推荐问题失败，请稍后重试。');
  }
}
