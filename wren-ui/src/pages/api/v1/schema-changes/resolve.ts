import type { NextApiRequest, NextApiResponse } from 'next';
import { ProjectController } from '@server/controllers/projectController';
import { SchemaChangeType } from '@server/managers/connectionSchemaDetector';
import { ApiError } from '@/server/utils/apiUtils';
import { buildApiContextFromRequest } from '@/server/api/apiContext';
import { sendRestApiError } from '@/server/api/restApi';

const projectController = new ProjectController();

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

    const ctx = await buildApiContextFromRequest({ req });
    await projectController.resolveSchemaChange(
      null,
      { where: { type: type as SchemaChangeType } },
      ctx,
    );

    return res.status(200).json({ success: true });
  } catch (error) {
    return sendRestApiError(res, error, '修复结构变更失败，请稍后重试。');
  }
}
