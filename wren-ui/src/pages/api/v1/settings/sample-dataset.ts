import type { NextApiRequest, NextApiResponse } from 'next';
import { ProjectResolver } from '@server/resolvers/projectResolver';
import { ApiError } from '@/apollo/server/utils/apiUtils';
import { buildResolverContextFromRequest } from '../resolverContext';
import { sendRestApiError } from '../restApi';

const projectResolver = new ProjectResolver();

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

    const ctx = await buildResolverContextFromRequest({ req });
    const result = await projectResolver.startSampleDataset(
      null,
      { data: { name } },
      ctx,
    );

    return res.status(200).json(result);
  } catch (error) {
    return sendRestApiError(res, error, '导入样例数据失败，请稍后重试。');
  }
}
