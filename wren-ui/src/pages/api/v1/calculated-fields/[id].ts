import type { NextApiRequest, NextApiResponse } from 'next';
import { ModelResolver } from '@server/resolvers/modelResolver';
import { ExpressionName } from '@server/models/model';
import { ApiError } from '@/apollo/server/utils/apiUtils';
import { buildResolverContextFromRequest } from '../resolverContext';
import { sendRestApiError } from '../restApi';

const modelResolver = new ModelResolver();

const parseColumnId = (value: string | string[] | undefined) => {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw new ApiError('Calculated field ID is invalid', 400);
  }
  return id;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    const columnId = parseColumnId(req.query.id);
    const ctx = await buildResolverContextFromRequest({ req });

    if (req.method === 'PATCH') {
      const { expression, lineage, name } = req.body || {};
      if (
        typeof expression !== 'string' ||
        !Array.isArray(lineage) ||
        typeof name !== 'string'
      ) {
        throw new ApiError('Calculated field payload is invalid', 400);
      }
      if (
        !Object.values(ExpressionName).includes(expression as ExpressionName)
      ) {
        throw new ApiError('Calculated field expression is invalid', 400);
      }

      const column = await modelResolver.updateCalculatedField(
        null,
        {
          where: { id: columnId },
          data: {
            expression: expression as ExpressionName,
            lineage,
            name,
          },
        },
        ctx,
      );
      return res.status(200).json(column);
    }

    if (req.method === 'DELETE') {
      await modelResolver.deleteCalculatedField(
        null,
        { where: { id: columnId } },
        ctx,
      );
      return res.status(200).json({ success: true });
    }

    res.setHeader('Allow', 'PATCH, DELETE');
    throw new Error('Method not allowed');
  } catch (error) {
    return sendRestApiError(res, error, '更新计算字段失败，请稍后重试。');
  }
}
