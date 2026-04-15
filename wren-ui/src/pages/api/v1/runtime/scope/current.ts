import type { NextApiRequest, NextApiResponse } from 'next';
import { RuntimeSelectorResolver } from '@server/resolvers/runtimeSelectorResolver';
import { buildResolverContextFromRequest } from '../../resolverContext';
import { sendRestApiError } from '../../restApi';

const runtimeSelectorResolver = new RuntimeSelectorResolver();

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
    const result = await runtimeSelectorResolver.getRuntimeSelectorState(
      null,
      null,
      ctx,
    );

    return res.status(200).json(result);
  } catch (error) {
    return sendRestApiError(res, error, '加载运行时范围失败，请稍后重试。');
  }
}
