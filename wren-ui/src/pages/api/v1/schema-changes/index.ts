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
    const schemaChange = await projectController.getSchemaChange({ ctx });
    return res.status(200).json(schemaChange);
  } catch (error) {
    return sendRestApiError(res, error, '加载结构变更失败，请稍后重试。');
  }
}
