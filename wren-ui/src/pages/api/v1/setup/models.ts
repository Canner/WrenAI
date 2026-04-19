import type { NextApiRequest, NextApiResponse } from 'next';
import { ProjectController } from '@server/controllers/projectController';
import { ApiError } from '@/server/utils/apiUtils';
import { buildApiContextFromRequest } from '@/server/api/apiContext';
import { sendRestApiError } from '@/server/api/restApi';

const projectController = new ProjectController();

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

    const ctx = await buildApiContextFromRequest({ req });
    const result = await projectController.saveTables(
      null,
      { data: { tables } },
      ctx,
    );

    return res.status(200).json(result);
  } catch (error) {
    return sendRestApiError(res, error, '保存模型失败，请稍后重试。');
  }
}
