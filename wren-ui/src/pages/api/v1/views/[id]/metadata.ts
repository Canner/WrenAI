import type { NextApiRequest, NextApiResponse } from 'next';
import { ModelResolver } from '@server/resolvers/modelResolver';
import { ApiError } from '@/apollo/server/utils/apiUtils';
import { buildResolverContextFromRequest } from '../../resolverContext';
import { sendRestApiError } from '../../restApi';

const modelResolver = new ModelResolver();

const parseViewId = (value: string | string[] | undefined) => {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw new ApiError('View ID is invalid', 400);
  }
  return id;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method !== 'PATCH') {
      res.setHeader('Allow', 'PATCH');
      throw new Error('Method not allowed');
    }

    const ctx = await buildResolverContextFromRequest({ req });
    await modelResolver.updateViewMetadata(
      null,
      {
        where: { id: parseViewId(req.query.id) },
        data: req.body || {},
      },
      ctx,
    );

    return res.status(200).json({ success: true });
  } catch (error) {
    return sendRestApiError(res, error, '更新视图元数据失败，请稍后重试。');
  }
}
