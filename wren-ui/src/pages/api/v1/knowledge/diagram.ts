import type { NextApiRequest, NextApiResponse } from 'next';
import { DiagramResolver } from '@server/resolvers/diagramResolver';
import { buildResolverContextFromRequest } from '../resolverContext';
import { sendRestApiError } from '../restApi';

const diagramResolver = new DiagramResolver();

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
    const diagram = await diagramResolver.getDiagram(null, null, ctx);
    return res.status(200).json(diagram);
  } catch (error) {
    return sendRestApiError(res, error, '加载知识库图谱失败，请稍后重试。');
  }
}
