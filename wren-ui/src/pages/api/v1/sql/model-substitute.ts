import type { NextApiRequest, NextApiResponse } from 'next';
import { SqlPairController } from '@server/controllers/sqlPairController';
import { DialectSQL } from '@server/models/adaptor';
import { ApiError } from '@/server/utils/apiUtils';
import { buildApiContextFromRequest } from '../apiContext';
import { sendRestApiError } from '../restApi';

const sqlPairController = new SqlPairController();

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

    const ctx = await buildApiContextFromRequest({ req });
    const substitutedSql = await sqlPairController.modelSubstitute(
      null,
      { data: { sql: sql as DialectSQL } },
      ctx,
    );

    return res.status(200).json(substitutedSql);
  } catch (error) {
    return sendRestApiError(res, error, 'SQL 转换失败，请稍后重试。');
  }
}
