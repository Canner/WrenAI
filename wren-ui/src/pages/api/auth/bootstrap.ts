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
    const displayName = getString(req.body?.displayName);
    const workspaceName = getString(req.body?.workspaceName);
    const workspaceSlug = getString(req.body?.workspaceSlug) || undefined;
    const locale = getString(req.body?.locale) || undefined;

    if (!email || !password || !displayName || !workspaceName) {
      return res.status(400).json({
        error:
          'email, password, displayName, and workspaceName are required',
      });
    }

    const authResult = await components.authService.bootstrapOwner({
      email,
      password,
      displayName,
      workspaceName,
      workspaceSlug,
      locale,
    });

    res.setHeader('Set-Cookie', buildSessionCookie(authResult.sessionToken, req));
    return res.status(201).json({
      user: authResult.user,
      workspace: authResult.workspace,
      membership: authResult.membership,
      actorClaims: authResult.actorClaims,
    });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Bootstrap failed' });
  }
}
