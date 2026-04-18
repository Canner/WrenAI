import type { NextApiRequest, NextApiResponse } from 'next';
import { ProjectController } from '@server/controllers/projectController';
import { buildApiContextFromRequest } from '../apiContext';
import { sendRestApiError } from '../restApi';

const projectController = new ProjectController();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      throw new Error('Method not allowed');
    }

    const ctx = await buildApiContextFromRequest({ req });
    const tables = await projectController.listConnectionTables({ ctx });
    return res.status(200).json(tables);
  } catch (error) {
    return sendRestApiError(res, error, '加载连接表失败，请稍后重试。');
  }
}
