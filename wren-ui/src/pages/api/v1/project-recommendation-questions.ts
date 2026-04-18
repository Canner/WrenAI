import type { NextApiRequest, NextApiResponse } from 'next';
import { AskingController } from '@server/controllers/askingController';
import { ProjectController } from '@server/controllers/projectController';
import { buildApiContextFromRequest } from './apiContext';
import { sendRestApiError } from './restApi';

const projectController = new ProjectController();
const askingController = new AskingController();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    const ctx = await buildApiContextFromRequest({ req });

    if (req.method === 'GET') {
      const result = await projectController.getProjectRecommendationQuestions(
        null,
        null,
        ctx,
      );
      return res.status(200).json(result);
    }

    if (req.method === 'POST') {
      await askingController.generateProjectRecommendationQuestions(
        null,
        null,
        ctx,
      );
      return res.status(200).json({ success: true });
    }

    res.setHeader('Allow', 'GET, POST');
    throw new Error('Method not allowed');
  } catch (error) {
    return sendRestApiError(res, error, '生成项目推荐问题失败，请稍后重试。');
  }
}
