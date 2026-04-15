import type { NextApiRequest, NextApiResponse } from 'next';
import { ProjectResolver } from '@server/resolvers/projectResolver';
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

    const ctx = await buildResolverContextFromRequest({ req });
    const hasSchemaChange = await projectResolver.triggerDataSourceDetection(
      null,
      null,
      ctx,
    );

    return res.status(200).json(hasSchemaChange);
  } catch (error) {
    return sendRestApiError(res, error, '检测结构变更失败，请稍后重试。');
  }
}
