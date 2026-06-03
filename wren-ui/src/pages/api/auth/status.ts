import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'GET') return res.status(405).end();
  const status = await components.rbacService.getBootstrapStatus();
  return res.status(200).json(status);
}
