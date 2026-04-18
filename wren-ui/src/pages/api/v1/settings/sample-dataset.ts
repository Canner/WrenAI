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
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      throw new Error('Method not allowed');
    }

    const name = String(req.body?.name || '').trim();
    if (!name) {
      throw new ApiError('Sample dataset name is required', 400);
    }

    const ctx = await buildApiContextFromRequest({ req });
    const result = await projectController.startSampleDataset(
      null,
      { data: { name } },
      ctx,
    );

    return res.status(200).json(result);
  } catch (error) {
    return sendRestApiError(res, error, '导入样例数据失败，请稍后重试。');
  }
}
