import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import {
  AUTH_COOKIE_NAME,
  clearAuthCookie,
  getCookie,
} from '@/apollo/server/utils';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') return res.status(405).end();
  const token = getCookie(req, AUTH_COOKIE_NAME);
  if (token) await components.rbacService.logout(token);
  clearAuthCookie(res);
  return res.status(200).json({ ok: true });
}
