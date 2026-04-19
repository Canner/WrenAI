import type { NextApiRequest, NextApiResponse } from 'next';
import { AskingController } from '@server/controllers/askingController';
import { ApiError } from '@/server/utils/apiUtils';
import { buildApiContextFromRequest } from '@/server/api/apiContext';
import { sendRestApiError } from '@/server/api/restApi';

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

    const question = String(req.body?.question || '').trim();
    if (!question) {
      throw new ApiError('Question is required', 400);
    }

    const ctx = await buildApiContextFromRequest({ req });
    const task = await askingController.createAskingTask(
      null,
      {
        data: {
          question,
          threadId:
            typeof req.body?.threadId === 'number'
              ? req.body.threadId
              : undefined,
          knowledgeBaseIds: Array.isArray(req.body?.knowledgeBaseIds)
            ? req.body.knowledgeBaseIds
            : undefined,
          selectedSkillIds: Array.isArray(req.body?.selectedSkillIds)
            ? req.body.selectedSkillIds
            : undefined,
        },
      },
      ctx,
    );

    return res.status(201).json(task);
  } catch (error) {
    return sendRestApiError(res, error, '创建问答任务失败，请稍后重试。');
  }
}
