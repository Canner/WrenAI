import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { getSessionTokenFromRequest } from '@server/context/actorClaims';
import { clearSessionCookie } from './sessionCookie';

const getQueryString = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const sessionToken = getSessionTokenFromRequest(req);
    if (!sessionToken) {
      return res.status(200).json({ authenticated: false });
    }

    const workspaceId = getQueryString(req.query.workspaceId);
    const validatedSession = await components.authService.validateSession(
      sessionToken,
      workspaceId,
    );

    if (!validatedSession) {
      res.setHeader('Set-Cookie', clearSessionCookie(req));
      return res.status(200).json({ authenticated: false });
    }

    const workspaces = await components.workspaceService.listWorkspacesForUser(
      validatedSession.user.id,
    );

    return res.status(200).json({
      authenticated: true,
      user: validatedSession.user,
      workspace: validatedSession.workspace,
      membership: validatedSession.membership,
      actorClaims: validatedSession.actorClaims,
      workspaces,
      session: {
        id: validatedSession.session.id,
        expiresAt: validatedSession.session.expiresAt,
        lastSeenAt: validatedSession.session.lastSeenAt || null,
      },
    });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Session failed' });
  }
}
