import type { NextApiRequest, NextApiResponse } from 'next';
import { handleThreadResponseStream } from '@/server/api/threadResponseStreamApi';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  return handleThreadResponseStream({ req, res, responseId: req.query.id });
}
