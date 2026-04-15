import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { getSessionTokenFromRequest } from '@server/context/actorClaims';
import { enforceRateLimit } from '@server/utils/rateLimit';

const getString = (value: unknown) => (typeof value === 'string' ? value : '');

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
    if (!sessionToken) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const validatedSession =
      await components.authService.validateSession(sessionToken);
    if (!validatedSession) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const currentPassword = getString(req.body?.currentPassword);
    const nextPassword = getString(req.body?.nextPassword);
    if (!currentPassword || !nextPassword) {
      return res.status(400).json({
        error: 'currentPassword and nextPassword are required',
      });
    }

    const rateLimitResult = await enforceRateLimit({
      req,
      res,
      endpoint: 'auth.password',
      email: validatedSession.user.email,
      rules: [
        { kind: 'ip', windowMs: 15 * 60 * 1000, max: 12 },
        { kind: 'email', windowMs: 15 * 60 * 1000, max: 8 },
      ],
    });
    if (rateLimitResult.limited) {
      return rateLimitResult.response;
    }

    await components.authService.changeLocalPassword({
      userId: validatedSession.user.id,
      currentPassword,
      nextPassword,
    });

    return res.status(200).json({ ok: true });
  } catch (error: any) {
    return res.status(400).json({
      error: error?.message || 'Failed to change password',
    });
  }
}
