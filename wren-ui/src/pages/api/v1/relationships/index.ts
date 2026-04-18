import type { NextApiRequest, NextApiResponse } from 'next';
import { ModelController } from '@server/controllers/modelController';
import { RelationType } from '@server/types/relationship';
import { ApiError } from '@/server/utils/apiUtils';
import { buildApiContextFromRequest } from '../apiContext';
import { sendRestApiError } from '../restApi';

const modelController = new ModelController();

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

    const ctx = await buildApiContextFromRequest({ req });
    const relation = await modelController.createRelation({
      data: {
        fromModelId: Number(fromModelId),
        fromColumnId: Number(fromColumnId),
        toModelId: Number(toModelId),
        toColumnId: Number(toColumnId),
        type: type as RelationType,
      },
      ctx,
    });

    return res.status(201).json(relation);
  } catch (error) {
    return sendRestApiError(res, error, '创建关系失败，请稍后重试。');
  }
}
