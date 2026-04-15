import type { NextApiRequest, NextApiResponse } from 'next';
import { ApiError } from '@/apollo/server/utils/apiUtils';
import { SqlPairResolver } from '@server/resolvers/sqlPairResolver';
import { buildResolverContextFromRequest } from '../../resolverContext';
import { sendRestApiError } from '../../restApi';

const sqlPairResolver = new SqlPairResolver();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      throw new Error('Method not allowed');
    }

    const sql = String(req.body?.sql || req.body?.data?.sql || '').trim();
    if (!sql) {
      throw new ApiError('SQL is required', 400);
    }

    const ctx = await buildResolverContextFromRequest({ req });
    const question = await sqlPairResolver.generateQuestion(
      null,
      { data: { sql } },
      ctx,
    );

    return res.status(200).json({ question });
  } catch (error) {
    return sendRestApiError(res, error, '生成问题失败，请稍后重试。');
  }
}
