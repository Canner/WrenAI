import type { NextApiRequest, NextApiResponse } from 'next';
import { ModelResolver } from '@server/resolvers/modelResolver';
import { ExpressionName } from '@server/models/model';
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

    const { modelId, expression, lineage, name } = req.body || {};
    if (
      !Number.isFinite(Number(modelId)) ||
      typeof expression !== 'string' ||
      !Array.isArray(lineage) ||
      typeof name !== 'string'
    ) {
      throw new ApiError('Calculated field payload is invalid', 400);
    }
    if (!Object.values(ExpressionName).includes(expression as ExpressionName)) {
      throw new ApiError('Calculated field expression is invalid', 400);
    }

    const ctx = await buildResolverContextFromRequest({ req });
    const column = await modelResolver.createCalculatedField(
      null,
      {
        data: {
          modelId: Number(modelId),
          expression: expression as ExpressionName,
          lineage,
          name,
        },
      },
      ctx,
    );

    return res.status(201).json(column);
  } catch (error) {
    return sendRestApiError(res, error, '创建计算字段失败，请稍后重试。');
  }
}
