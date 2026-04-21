import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { buildAuthResponseUser } from '@server/api/auth/responseUser';
import { buildSessionCookie } from '@server/api/auth/sessionCookie';
import { resolveBootstrapKnowledgeBaseSelection } from '@server/utils/runtimeSelectorState';
import { KBSnapshot, KnowledgeBase } from '@server/repositories';
import { enforceRateLimit } from '@server/utils/rateLimit';

const getString = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const toRuntimeSelector = (
  workspaceId: string,
  knowledgeBase: KnowledgeBase | null,
  snapshot: KBSnapshot | null,
) => ({
  workspaceId,
  knowledgeBaseId: knowledgeBase?.id || null,
  kbSnapshotId: snapshot?.id || null,
  deployHash: snapshot?.deployHash || null,
});

const resolveWorkspaceRuntimeSelector = async (workspaceId: string) => {
  const knowledgeBases = await components.knowledgeBaseRepository.findAllBy({
    workspaceId,
  });
  const { knowledgeBase, snapshot } =
    await resolveBootstrapKnowledgeBaseSelection(
      knowledgeBases,
      components.kbSnapshotRepository,
    );

  return toRuntimeSelector(workspaceId, knowledgeBase, snapshot);
};

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
    const locale = getString(req.body?.locale) || undefined;

    if (!email || !password || !displayName) {
      return res.status(400).json({
        error: 'email, password, and displayName are required',
      });
    }

    const rateLimitResult = await enforceRateLimit({
      req,
      res,
      endpoint: 'auth.register',
      email,
      rules: [{ kind: 'ip', windowMs: 60 * 60 * 1000, max: 6 }],
    });
    if (rateLimitResult.limited) {
      return rateLimitResult.response;
    }

    const authResult = await components.authService.registerLocalUser({
      email,
      password,
      displayName,
      locale,
    });

    res.setHeader(
      'Set-Cookie',
      buildSessionCookie(authResult.sessionToken, req),
    );
    return res.status(201).json({
      user: buildAuthResponseUser({
        user: authResult.user,
        isPlatformAdmin: Boolean(authResult.actorClaims.isPlatformAdmin),
      }),
      workspace: authResult.workspace,
      membership: authResult.membership,
      actorClaims: authResult.actorClaims,
      runtimeSelector: await resolveWorkspaceRuntimeSelector(
        authResult.workspace.id,
      ),
    });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Register failed' });
  }
}
