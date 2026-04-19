import type { NextApiRequest, NextApiResponse } from 'next';
import { ModelController } from '@server/controllers/modelController';
import { ApiError } from '@/server/utils/apiUtils';
import { buildApiContextFromRequest } from '@/server/api/apiContext';
import { sendRestApiError } from '@/server/api/restApi';

const modelController = new ModelController();

const parseResponseId = (value: string | string[] | undefined) => {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw new ApiError('Response ID is invalid', 400);
  }
  return id;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      throw new Error('Method not allowed');
    }

    const ctx = await buildApiContextFromRequest({ req });
    const nativeSql = await modelController.getNativeSql({
      responseId: parseResponseId(req.query.id),
      ctx,
    });

    return res.status(200).json(nativeSql);
  } catch (error) {
    return sendRestApiError(res, error, '加载原生 SQL 失败，请稍后重试。');
  }
}
