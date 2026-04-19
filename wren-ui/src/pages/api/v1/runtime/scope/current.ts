import type { NextApiRequest, NextApiResponse } from 'next';
import { RuntimeSelectorController } from '@server/controllers/runtimeSelectorController';
import { buildApiContextFromRequest } from '@/server/api/apiContext';
import { sendRestApiError } from '@/server/api/restApi';

const runtimeSelectorController = new RuntimeSelectorController();

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
    const result = await runtimeSelectorController.getRuntimeSelectorState({
      ctx,
    });

    return res.status(200).json(result);
  } catch (error) {
    return sendRestApiError(res, error, '加载运行时范围失败，请稍后重试。');
  }
}
