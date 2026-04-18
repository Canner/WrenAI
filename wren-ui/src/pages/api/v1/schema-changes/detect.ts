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
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      throw new Error('Method not allowed');
    }

    const ctx = await buildApiContextFromRequest({ req });
    const hasSchemaChange = await projectController.triggerConnectionDetection(
      null,
      null,
      ctx,
    );

    return res.status(200).json(hasSchemaChange);
  } catch (error) {
    return sendRestApiError(res, error, '检测结构变更失败，请稍后重试。');
  }
}
