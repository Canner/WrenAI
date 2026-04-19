import type { NextApiRequest, NextApiResponse } from 'next';
import { ProjectController } from '@server/controllers/projectController';
import { buildApiContextFromRequest } from '@/server/api/apiContext';
import { sendRestApiError } from '@/server/api/restApi';

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
    const result = await projectController.getOnboardingStatus({ ctx });
    return res.status(200).json(result);
  } catch (error) {
    return sendRestApiError(res, error, '加载引导状态失败，请稍后重试。');
  }
}
