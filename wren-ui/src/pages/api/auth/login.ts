import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { buildSessionCookie } from './sessionCookie';

const getString = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const email = getString(req.body?.email);
    const password = getString(req.body?.password);
    const workspaceId = getString(req.body?.workspaceId) || undefined;

    if (!email || !password) {
      return res
        .status(400)
        .json({ error: 'email and password are required' });
    }

    const authResult = await components.authService.login({
      email,
      password,
      workspaceId,
    });

    res.setHeader('Set-Cookie', buildSessionCookie(authResult.sessionToken, req));
    return res.status(200).json({
      user: authResult.user,
      workspace: authResult.workspace,
      membership: authResult.membership,
      actorClaims: authResult.actorClaims,
    });
  } catch (error: any) {
    return res.status(401).json({ error: error.message || 'Login failed' });
  }
}
