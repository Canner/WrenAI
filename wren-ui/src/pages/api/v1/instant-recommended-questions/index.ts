import type { NextApiRequest, NextApiResponse } from 'next';
import { AskingController } from '@server/controllers/askingController';
import { buildApiContextFromRequest } from '../apiContext';
import { sendRestApiError } from '../restApi';

const askingController = new AskingController();

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
    const task = await askingController.createInstantRecommendedQuestions(
      null,
      {
        data: {
          previousQuestions: Array.isArray(req.body?.previousQuestions)
            ? req.body.previousQuestions
            : undefined,
        },
      },
      ctx,
    );

    return res.status(201).json(task);
  } catch (error) {
    return sendRestApiError(res, error, '生成推荐问题失败，请稍后重试。');
  }
}
