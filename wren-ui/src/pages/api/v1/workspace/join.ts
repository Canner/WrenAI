import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { getSessionTokenFromRequest } from '@server/context/actorClaims';
import { canManageWorkspaceJoinFlow } from '@/utils/workspaceGovernance';

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
    const sessionToken = getSessionTokenFromRequest(req);
    if (!sessionToken) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const validatedSession =
      await components.authService.validateSession(sessionToken);
    if (!validatedSession) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const workspaceId = getString(req.body?.workspaceId);
    if (!workspaceId) {
      return res.status(400).json({ error: 'workspaceId is required' });
    }

    const workspace = await components.workspaceRepository.findOneBy({
      id: workspaceId,
    });
    if (!workspace || workspace.status !== 'active') {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    if (!canManageWorkspaceJoinFlow(workspace.kind)) {
      return res.status(403).json({
        error: 'Default workspace does not support join requests',
      });
    }

    const membership = await components.workspaceService.acceptInvitation({
      workspaceId,
      userId: validatedSession.user.id,
    });

    return res.status(200).json({ membership });
  } catch (error: any) {
    return res
      .status(400)
      .json({ error: error?.message || 'Failed to join workspace' });
  }
}
