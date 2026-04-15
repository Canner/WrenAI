import type { NextApiRequest, NextApiResponse } from 'next';
import { ModelResolver } from '@server/resolvers/modelResolver';
import { buildResolverContextFromRequest } from '../resolverContext';
import { sendRestApiError } from '../restApi';

const modelResolver = new ModelResolver();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      throw new Error('Method not allowed');
    }

    const ctx = await buildResolverContextFromRequest({ req });
    const modelSync = await modelResolver.checkModelSync(null, null, ctx);
    return res.status(200).json(modelSync);
  } catch (error) {
    return sendRestApiError(res, error, '加载部署状态失败，请稍后重试。');
  }
}
