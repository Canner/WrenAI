import type { NextApiRequest, NextApiResponse } from 'next';
import { AskingController } from '@server/controllers/askingController';
import { ApiError } from '@/server/utils/apiUtils';
import { buildApiContextFromRequest } from '@/server/api/apiContext';
import { sendRestApiError } from '@/server/api/restApi';

const askingController = new AskingController();

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
    const previewData = await askingController.previewData(
      null,
      { where: { responseId: parseResponseId(req.query.id) } },
      ctx,
    );

    return res.status(200).json(previewData);
  } catch (error) {
    return sendRestApiError(res, error, '加载预览数据失败，请稍后重试。');
  }
}
