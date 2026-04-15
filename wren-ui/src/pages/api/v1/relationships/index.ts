import type { NextApiRequest, NextApiResponse } from 'next';
import { ModelResolver } from '@server/resolvers/modelResolver';
import { RelationType } from '@server/types/relationship';
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

    const { fromModelId, fromColumnId, toModelId, toColumnId, type } =
      req.body || {};
    if (
      !Number.isFinite(Number(fromModelId)) ||
      !Number.isFinite(Number(fromColumnId)) ||
      !Number.isFinite(Number(toModelId)) ||
      !Number.isFinite(Number(toColumnId)) ||
      typeof type !== 'string' ||
      !Object.values(RelationType).includes(type as RelationType)
    ) {
      throw new ApiError('Relationship payload is invalid', 400);
    }

    const ctx = await buildResolverContextFromRequest({ req });
    const relation = await modelResolver.createRelation(
      null,
      {
        data: {
          fromModelId: Number(fromModelId),
          fromColumnId: Number(fromColumnId),
          toModelId: Number(toModelId),
          toColumnId: Number(toColumnId),
          type: type as RelationType,
        },
      },
      ctx,
    );

    return res.status(201).json(relation);
  } catch (error) {
    return sendRestApiError(res, error, '创建关系失败，请稍后重试。');
  }
}
