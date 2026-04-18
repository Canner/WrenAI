import type { NextApiRequest, NextApiResponse } from 'next';
import { handleAskingTaskStream } from '@/server/api/askingTaskStreamApi';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  return handleAskingTaskStream({ req, res, queryId: req.query.queryId });
}
