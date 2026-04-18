import type { NextApiRequest, NextApiResponse } from 'next';
import { ModelController } from '@server/controllers/modelController';
import { ApiError } from '@/server/utils/apiUtils';
import { buildApiContextFromRequest } from '../apiContext';
import { sendRestApiError } from '../restApi';

const modelController = new ModelController();

const isInternalAiServiceRequest = (req: NextApiRequest) => {
  const header = req.headers['x-wren-ai-service-internal'];
  return Array.isArray(header) ? header.includes('1') : header === '1';
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      throw new Error('Method not allowed');
    }

    if (!isInternalAiServiceRequest(req)) {
      throw new ApiError('Internal AI-service access required', 403);
    }

    const ctx = await buildApiContextFromRequest({ req });
    const deployResult = await modelController.deploy({
      force: req.body?.force === true,
      ctx,
      allowInternalBypass: true,
    });

    return res.status(200).json(deployResult);
  } catch (error) {
    return sendRestApiError(res, error, '内部部署失败，请稍后重试。');
  }
}
