import type { NextApiRequest, NextApiResponse } from 'next';
import { ProjectResolver } from '@server/resolvers/projectResolver';
import { ApiError } from '@/apollo/server/utils/apiUtils';
import { buildResolverContextFromRequest } from '../resolverContext';
import { sendRestApiError } from '../restApi';

const projectResolver = new ProjectResolver();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    const ctx = await buildResolverContextFromRequest({ req });

    if (req.method === 'PATCH') {
      const language = String(req.body?.language || '').trim();
      if (!language) {
        throw new ApiError('Language is required', 400);
      }

      const success = await projectResolver.updateCurrentProject(
        null,
        { data: { language } },
        ctx,
      );

      return res.status(200).json({ success });
    }

    if (req.method === 'DELETE') {
      const success = await projectResolver.resetCurrentProject(
        null,
        null,
        ctx,
      );
      return res.status(200).json({ success });
    }

    res.setHeader('Allow', 'PATCH, DELETE');
    throw new Error('Method not allowed');
  } catch (error) {
    return sendRestApiError(res, error, '更新知识库设置失败，请稍后重试。');
  }
}
