import type { NextApiRequest, NextApiResponse } from 'next';
import { ModelResolver } from '@server/resolvers/modelResolver';
import { RelationType } from '@server/types/relationship';
import { ApiError } from '@/apollo/server/utils/apiUtils';
import { buildResolverContextFromRequest } from '../resolverContext';
import { sendRestApiError } from '../restApi';

const modelResolver = new ModelResolver();

const parseRelationId = (value: string | string[] | undefined) => {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw new ApiError('Relationship ID is invalid', 400);
  }
  return id;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    const relationId = parseRelationId(req.query.id);
    const ctx = await buildResolverContextFromRequest({ req });

    if (req.method === 'PATCH') {
      const type = req.body?.type;
      if (
        typeof type !== 'string' ||
        !Object.values(RelationType).includes(type as RelationType)
      ) {
        throw new ApiError('Relationship type is required', 400);
      }

      const relation = await modelResolver.updateRelation(
        null,
        { where: { id: relationId }, data: { type: type as RelationType } },
        ctx,
      );
      return res.status(200).json(relation);
    }

    if (req.method === 'DELETE') {
      await modelResolver.deleteRelation(
        null,
        { where: { id: relationId } },
        ctx,
      );
      return res.status(200).json({ success: true });
    }

    res.setHeader('Allow', 'PATCH, DELETE');
    throw new Error('Method not allowed');
  } catch (error) {
    return sendRestApiError(res, error, '更新关系失败，请稍后重试。');
  }
}
