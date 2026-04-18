import type { NextApiRequest, NextApiResponse } from 'next';
import { ProjectController } from '@server/controllers/projectController';
import { ApiError } from '@/server/utils/apiUtils';
import { buildApiContextFromRequest } from '../apiContext';
import { sendRestApiError } from '../restApi';

const projectController = new ProjectController();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    const ctx = await buildApiContextFromRequest({ req });

    if (req.method === 'PATCH') {
      const language = String(req.body?.language || '').trim();
      if (!language) {
        throw new ApiError('Language is required', 400);
      }

      const success = await projectController.updateCurrentProject({
        language,
        ctx,
      });

      return res.status(200).json({ success });
    }

    if (req.method === 'DELETE') {
      const success = await projectController.resetCurrentProject({ ctx });
      return res.status(200).json({ success });
    }

    res.setHeader('Allow', 'PATCH, DELETE');
    throw new Error('Method not allowed');
  } catch (error) {
    return sendRestApiError(res, error, '更新知识库设置失败，请稍后重试。');
  }
}
