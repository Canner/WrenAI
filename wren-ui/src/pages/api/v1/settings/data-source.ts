import type { NextApiRequest, NextApiResponse } from 'next';
import { ProjectResolver } from '@server/resolvers/projectResolver';
import { ApiError } from '@/apollo/server/utils/apiUtils';
import { buildResolverContextFromRequest } from '../resolverContext';
import { sendRestApiError } from '../restApi';

const projectResolver = new ProjectResolver();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method !== 'PATCH' && req.method !== 'POST') {
      res.setHeader('Allow', 'PATCH, POST');
      throw new Error('Method not allowed');
    }

    const ctx = await buildResolverContextFromRequest({ req });
    const properties = req.body?.properties || req.body?.data?.properties;
    const type = req.body?.type || req.body?.data?.type;

    if (!properties || typeof properties !== 'object') {
      throw new ApiError('Data source properties are required', 400);
    }

    const dataSource =
      req.method === 'POST'
        ? await projectResolver.saveDataSource(
            null,
            { data: { type, properties } },
            ctx,
          )
        : await projectResolver.updateDataSource(
            null,
            { data: { type, properties } },
            ctx,
          );

    return res.status(req.method === 'POST' ? 201 : 200).json(dataSource);
  } catch (error) {
    return sendRestApiError(res, error, '保存数据源失败，请稍后重试。');
  }
}
