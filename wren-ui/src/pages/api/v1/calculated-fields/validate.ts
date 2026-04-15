import type { NextApiRequest, NextApiResponse } from 'next';
import { ModelResolver } from '@server/resolvers/modelResolver';
import { ApiError } from '@/apollo/server/utils/apiUtils';
import { buildResolverContextFromRequest } from '../resolverContext';
import { sendRestApiError } from '../restApi';

const modelResolver = new ModelResolver();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      throw new Error('Method not allowed');
    }

    const { modelId, columnId, name } = req.body || {};
    if (!Number.isFinite(Number(modelId)) || typeof name !== 'string') {
      throw new ApiError('Calculated field validation payload is invalid', 400);
    }

    const ctx = await buildResolverContextFromRequest({ req });
    const validation = await modelResolver.validateCalculatedField(
      null,
      {
        data: {
          name,
          modelId: Number(modelId),
          ...(columnId != null ? { columnId: Number(columnId) } : {}),
        },
      },
      ctx,
    );

    return res.status(200).json(validation);
  } catch (error) {
    return sendRestApiError(res, error, '校验计算字段失败，请稍后重试。');
  }
}
