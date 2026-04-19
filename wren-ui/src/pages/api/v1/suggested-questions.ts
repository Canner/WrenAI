import type { NextApiRequest, NextApiResponse } from 'next';
import { AskingController } from '@server/controllers/askingController';
import { buildApiContextFromRequest } from '@/server/api/apiContext';
import { sendRestApiError } from '@/server/api/restApi';

const askingController = new AskingController();

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
    const suggestedQuestions = await askingController.getSuggestedQuestions(
      null,
      null,
      ctx,
    );

    return res.status(200).json(suggestedQuestions);
  } catch (error) {
    return sendRestApiError(res, error, '加载推荐问题失败，请稍后重试。');
  }
}
