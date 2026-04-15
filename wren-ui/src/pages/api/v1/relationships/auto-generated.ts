import type { NextApiRequest, NextApiResponse } from 'next';
import { ProjectResolver } from '@server/resolvers/projectResolver';
import { buildResolverContextFromRequest } from '../resolverContext';
import { sendRestApiError } from '../restApi';

const projectResolver = new ProjectResolver();

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
    const relations = await projectResolver.autoGenerateRelation(
      null,
      null,
      ctx,
    );
    return res.status(200).json(relations);
  } catch (error) {
    return sendRestApiError(res, error, '加载推荐关系失败，请稍后重试。');
  }
}
