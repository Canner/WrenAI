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

    const tables = Array.isArray(req.body?.tables) ? req.body.tables : [];
    if (tables.length === 0) {
      throw new ApiError('Tables are required', 400);
    }

    const ctx = await buildResolverContextFromRequest({ req });
    const result = await projectResolver.saveTables(
      null,
      { data: { tables } },
      ctx,
    );

    return res.status(200).json(result);
  } catch (error) {
    return sendRestApiError(res, error, '保存模型失败，请稍后重试。');
  }
}
