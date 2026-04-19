import type { NextApiRequest, NextApiResponse } from 'next';
import { ProjectController } from '@server/controllers/projectController';
import { ApiError } from '@/server/utils/apiUtils';
import { buildApiContextFromRequest } from '@/server/api/apiContext';
import { sendRestApiError } from '@/server/api/restApi';

const projectController = new ProjectController();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method !== 'PATCH' && req.method !== 'POST') {
      res.setHeader('Allow', 'PATCH, POST');
      throw new Error('Method not allowed');
    }

    const ctx = await buildApiContextFromRequest({ req });
    const properties = req.body?.properties || req.body?.data?.properties;
    const type = req.body?.type || req.body?.data?.type;

    if (!properties || typeof properties !== 'object') {
      throw new ApiError('知识库连接配置不能为空', 400);
    }

    const connection =
      req.method === 'POST'
        ? await projectController.saveConnection(
            null,
            { data: { type, properties } },
            ctx,
          )
        : await projectController.updateConnection(
            null,
            { data: { type, properties } },
            ctx,
          );

    return res.status(req.method === 'POST' ? 201 : 200).json(connection);
  } catch (error) {
    return sendRestApiError(res, error, '保存知识库连接失败，请稍后重试。');
  }
}
