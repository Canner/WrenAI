import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import {
  AUTH_COOKIE_NAME,
  getCookie,
  sanitizeAuthSession,
} from '@/apollo/server/utils';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'GET') return res.status(405).end();
  const token = getCookie(req, AUTH_COOKIE_NAME);
  const session = await components.rbacService.getSession(token);
  if (!session) return res.status(401).json({ authenticated: false });
  return res.status(200).json({
    authenticated: true,
    ...sanitizeAuthSession(session),
  });
}
