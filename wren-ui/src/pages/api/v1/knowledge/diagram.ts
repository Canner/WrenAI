import type { NextApiRequest, NextApiResponse } from 'next';
import { DiagramController } from '@server/controllers/diagramController';
import { buildApiContextFromRequest } from '@/server/api/apiContext';
import { sendRestApiError } from '@/server/api/restApi';

const diagramController = new DiagramController();

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
    const diagram = await diagramController.getDiagram({ ctx });
    return res.status(200).json(diagram);
  } catch (error) {
    return sendRestApiError(res, error, '加载知识库图谱失败，请稍后重试。');
  }
}
