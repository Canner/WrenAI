import type { NextApiRequest, NextApiResponse } from 'next';
import { ModelResolver } from '@server/resolvers/modelResolver';
import type { UpdateModelData } from '@server/models/model';
import { ApiError } from '@/apollo/server/utils/apiUtils';
import { buildResolverContextFromRequest } from '../resolverContext';
import { sendRestApiError } from '../restApi';

const modelResolver = new ModelResolver();

const parseModelId = (value: string | string[] | undefined) => {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw new ApiError('Model ID is invalid', 400);
  }
  return id;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    const modelId = parseModelId(req.query.id);
    const ctx = await buildResolverContextFromRequest({ req });

    if (req.method === 'PATCH') {
      const { fields, primaryKey } = req.body || {};
      if (!Array.isArray(fields) || typeof primaryKey !== 'string') {
        throw new ApiError('Model fields are required', 400);
      }
      const data: UpdateModelData = {
        fields: fields as [string],
        primaryKey,
      };

      const model = await modelResolver.updateModel(
        null,
        {
          where: { id: modelId },
          data,
        },
        ctx,
      );
      return res.status(200).json(model);
    }

    if (req.method === 'DELETE') {
      await modelResolver.deleteModel(null, { where: { id: modelId } }, ctx);
      return res.status(200).json({ success: true });
    }

    res.setHeader('Allow', 'PATCH, DELETE');
    throw new Error('Method not allowed');
  } catch (error) {
    return sendRestApiError(res, error, '更新模型失败，请稍后重试。');
  }
}
