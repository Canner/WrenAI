import type { NextApiRequest, NextApiResponse } from 'next';
import { ProjectController } from '@server/controllers/projectController';
import { buildApiContextFromRequest } from '@/server/api/apiContext';
import { applyCompatibilityApiHeaders } from '@/server/api/compatibilityApi';
import { sendRestApiError } from '@/server/api/restApi';

const projectController = new ProjectController();
const CANONICAL_ROUTE = '/api/v1/connection/tables';
const DEPRECATION_WARNING =
  'Deprecated API: use /api/v1/connection/tables for connection table lookups.';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  applyCompatibilityApiHeaders(res, {
    successorRoute: CANONICAL_ROUTE,
    warning: DEPRECATION_WARNING,
  });

  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      throw new Error('Method not allowed');
    }

    const ctx = await buildApiContextFromRequest({ req });
    const tables = await projectController.listConnectionTables({ ctx });
    return res.status(200).json(tables);
  } catch (error) {
    return sendRestApiError(res, error, '加载连接表失败，请稍后重试。');
  }
}
