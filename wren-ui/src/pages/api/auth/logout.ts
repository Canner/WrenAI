import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { getSessionTokenFromRequest } from '@server/context/actorClaims';
import { clearSessionCookie } from './sessionCookie';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const sessionToken = getSessionTokenFromRequest(req);
    if (sessionToken) {
      await components.authService.logout(sessionToken);
    }

    res.setHeader('Set-Cookie', clearSessionCookie(req));
    return res.status(200).json({ ok: true });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Logout failed' });
  }
}
