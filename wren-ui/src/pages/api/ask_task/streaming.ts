import type { NextApiRequest, NextApiResponse } from 'next';
import { handleAskingTaskStream } from '@/server/api/askingTaskStreamApi';
import { applyCompatibilityApiHeaders } from '@/server/api/compatibilityApi';

const SUCCESSOR_ROUTE = '/api/v1/asking-tasks/[id]/stream';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  applyCompatibilityApiHeaders(res, {
    successorRoute: SUCCESSOR_ROUTE,
  });

  return handleAskingTaskStream({ req, res, queryId: req.query.queryId });
}
