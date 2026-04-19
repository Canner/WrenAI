import type { NextApiRequest, NextApiResponse } from 'next';
import { ModelController } from '@server/controllers/modelController';
import { buildApiContextFromRequest } from '@/server/api/apiContext';
import { sendRestApiError } from '@/server/api/restApi';

const modelController = new ModelController();

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
    const modelSync = await modelController.checkModelSync({ ctx });
    return res.status(200).json(modelSync);
  } catch (error) {
    return sendRestApiError(res, error, '加载部署状态失败，请稍后重试。');
  }
}
