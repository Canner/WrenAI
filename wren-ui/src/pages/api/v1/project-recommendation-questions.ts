import type { NextApiRequest, NextApiResponse } from 'next';
import { AskingResolver } from '@server/resolvers/askingResolver';
import { ProjectResolver } from '@server/resolvers/projectResolver';
import { buildResolverContextFromRequest } from './resolverContext';
import { sendRestApiError } from './restApi';

const projectResolver = new ProjectResolver();
const askingResolver = new AskingResolver();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    const ctx = await buildResolverContextFromRequest({ req });

    if (req.method === 'GET') {
      const result = await projectResolver.getProjectRecommendationQuestions(
        null,
        null,
        ctx,
      );
      return res.status(200).json(result);
    }

    if (req.method === 'POST') {
      await askingResolver.generateProjectRecommendationQuestions(
        null,
        null,
        ctx,
      );
      return res.status(200).json({ success: true });
    }

    res.setHeader('Allow', 'GET, POST');
    throw new Error('Method not allowed');
  } catch (error) {
    return sendRestApiError(res, error, '生成项目推荐问题失败，请稍后重试。');
  }
}
