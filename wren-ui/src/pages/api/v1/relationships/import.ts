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
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      throw new Error('Method not allowed');
    }

    const relations = Array.isArray(req.body?.relations)
      ? req.body.relations
      : [];
    if (!Array.isArray(relations)) {
      throw new ApiError('Relations are required', 400);
    }

    const ctx = await buildResolverContextFromRequest({ req });
    const result = await projectResolver.saveRelations(
      null,
      { data: { relations } },
      ctx,
    );

    return res.status(200).json(result);
  } catch (error) {
    return sendRestApiError(res, error, '保存关联关系失败，请稍后重试。');
  }
}
