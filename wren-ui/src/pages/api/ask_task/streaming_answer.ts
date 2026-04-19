import type { NextApiRequest, NextApiResponse } from 'next';
import { handleThreadResponseStream } from '@/server/api/threadResponseStreamApi';
import { applyCompatibilityApiHeaders } from '@/server/api/compatibilityApi';

const SUCCESSOR_ROUTE = '/api/v1/thread-responses/[id]/stream-answer';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  applyCompatibilityApiHeaders(res, {
    successorRoute: SUCCESSOR_ROUTE,
  });

  return handleThreadResponseStream({
    req,
    res,
    responseId: req.query.responseId,
  });
}
