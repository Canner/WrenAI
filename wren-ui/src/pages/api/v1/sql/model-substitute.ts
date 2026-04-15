import type { NextApiRequest, NextApiResponse } from 'next';
import { SqlPairResolver } from '@server/resolvers/sqlPairResolver';
import { DialectSQL } from '@server/models/adaptor';
import { ApiError } from '@/apollo/server/utils/apiUtils';
import { buildResolverContextFromRequest } from '../resolverContext';
import { sendRestApiError } from '../restApi';

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

    const sql = String(req.body?.sql || '').trim();
    if (!sql) {
      throw new ApiError('SQL is required', 400);
    }

    const ctx = await buildResolverContextFromRequest({ req });
    const substitutedSql = await sqlPairResolver.modelSubstitute(
      null,
      { data: { sql: sql as DialectSQL } },
      ctx,
    );

    return res.status(200).json(substitutedSql);
  } catch (error) {
    return sendRestApiError(res, error, 'SQL 转换失败，请稍后重试。');
  }
}
