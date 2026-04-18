import type { NextApiRequest, NextApiResponse } from 'next';
import { ModelController } from '@server/controllers/modelController';
import { buildApiContextFromRequest } from '../apiContext';
import { sendRestApiError } from '../restApi';

const modelController = new ModelController();

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
    const deployResult = await modelController.deploy({ force: false, ctx });

    return res.status(200).json(deployResult);
  } catch (error) {
    return sendRestApiError(res, error, '部署失败，请稍后重试。');
  }
}
