import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { buildAuthResponseUser } from '@server/api/auth/responseUser';
import { buildSessionCookie } from '@server/api/auth/sessionCookie';
import { resolveBootstrapKnowledgeBaseSelection } from '@server/utils/runtimeSelectorState';
import { KBSnapshot, KnowledgeBase } from '@server/repositories';
import { enforceRateLimit } from '@server/utils/rateLimit';

const getString = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const getBoolean = (value: unknown) =>
  value === true || value === 'true' || value === 1 || value === '1';

const deriveDisplayName = (email: string, providedDisplayName?: string) => {
  const normalizedDisplayName = getString(providedDisplayName);
  if (normalizedDisplayName) {
    return normalizedDisplayName;
  }

  const localPart = email.split('@')[0]?.trim();
  if (!localPart) {
    return 'Workspace Owner';
  }

  const normalized = localPart.replace(/[._-]+/g, ' ').trim();
  if (!normalized) {
    return 'Workspace Owner';
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

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
      components.deployLogRepository,
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
    const workspaceId = getString(req.body?.workspaceId) || undefined;
    const autoBootstrap = getBoolean(req.body?.autoBootstrap);
    const locale = getString(req.body?.locale) || undefined;
    const displayName = deriveDisplayName(email, req.body?.displayName);

    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const rateLimitResult = await enforceRateLimit({
      req,
      res,
      endpoint: 'auth.login',
      email,
      rules: [
        { kind: 'ip', windowMs: 15 * 60 * 1000, max: 15 },
        { kind: 'email', windowMs: 15 * 60 * 1000, max: 8 },
      ],
    });
    if (rateLimitResult.limited) {
      return rateLimitResult.response;
    }

    try {
      const authResult = await components.authService.login({
        email,
        password,
        workspaceId,
      });

      res.setHeader(
        'Set-Cookie',
        buildSessionCookie(authResult.sessionToken, req),
      );
      return res.status(200).json({
        user: buildAuthResponseUser({
          user: authResult.user,
          isPlatformAdmin: Boolean(authResult.actorClaims.isPlatformAdmin),
        }),
        workspace: authResult.workspace,
        membership: authResult.membership,
        actorClaims: authResult.actorClaims,
        isPlatformAdmin: Boolean(authResult.actorClaims.isPlatformAdmin),
        defaultWorkspaceId: authResult.user.defaultWorkspaceId ?? null,
        runtimeSelector: await resolveWorkspaceRuntimeSelector(
          authResult.workspace.id,
        ),
      });
    } catch (loginError: any) {
      if (!autoBootstrap) {
        throw loginError;
      }

      const localIdentity = await components.authIdentityRepository.findOneBy({
        providerType: 'local',
      });

      if (localIdentity) {
        throw loginError;
      }

      const bootstrapResult = await components.authService.bootstrapOwner({
        email,
        password,
        displayName,
        locale,
      });

      res.setHeader(
        'Set-Cookie',
        buildSessionCookie(bootstrapResult.sessionToken, req),
      );
      return res.status(201).json({
        user: buildAuthResponseUser({
          user: bootstrapResult.user,
          isPlatformAdmin: Boolean(bootstrapResult.actorClaims.isPlatformAdmin),
        }),
        workspace: bootstrapResult.workspace,
        membership: bootstrapResult.membership,
        actorClaims: bootstrapResult.actorClaims,
        isPlatformAdmin: Boolean(bootstrapResult.actorClaims.isPlatformAdmin),
        defaultWorkspaceId: bootstrapResult.user.defaultWorkspaceId ?? null,
        runtimeSelector: await resolveWorkspaceRuntimeSelector(
          bootstrapResult.workspace.id,
        ),
        bootstrapped: true,
      });
    }
  } catch (error: any) {
    return res.status(401).json({ error: error.message || 'Login failed' });
  }
}
