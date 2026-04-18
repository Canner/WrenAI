import type { NextApiRequest, NextApiResponse } from 'next';
import { ApiError } from '@/server/utils/apiUtils';
import { SqlPairController } from '@server/controllers/sqlPairController';
import { buildApiContextFromRequest } from '../../apiContext';
import { sendRestApiError } from '../../restApi';

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

    const sql = String(req.body?.sql || req.body?.data?.sql || '').trim();
    if (!sql) {
      throw new ApiError('SQL is required', 400);
    }

    const ctx = await buildApiContextFromRequest({ req });
    const question = await sqlPairController.generateQuestion(
      null,
      { data: { sql } },
      ctx,
    );

    return res.status(200).json({ question });
  } catch (error) {
    return sendRestApiError(res, error, '生成问题失败，请稍后重试。');
  }
}
