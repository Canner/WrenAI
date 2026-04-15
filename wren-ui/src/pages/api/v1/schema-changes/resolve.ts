import type { NextApiRequest, NextApiResponse } from 'next';
import { ProjectResolver } from '@server/resolvers/projectResolver';
import { SchemaChangeType } from '@server/managers/dataSourceSchemaDetector';
import { ApiError } from '@/apollo/server/utils/apiUtils';
import { buildResolverContextFromRequest } from '../resolverContext';
import { sendRestApiError } from '../restApi';

const projectResolver = new ProjectResolver();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      throw new Error('Method not allowed');
    }

    const type = req.body?.type;
    if (
      typeof type !== 'string' ||
      !Object.values(SchemaChangeType).includes(type as SchemaChangeType)
    ) {
      throw new ApiError('Schema change type is required', 400);
    }

    const ctx = await buildResolverContextFromRequest({ req });
    await projectResolver.resolveSchemaChange(
      null,
      { where: { type: type as SchemaChangeType } },
      ctx,
    );

    return res.status(200).json({ success: true });
  } catch (error) {
    return sendRestApiError(res, error, '修复结构变更失败，请稍后重试。');
  }
}
