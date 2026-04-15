import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { buildSessionCookie } from '../sessionCookie';
import { resolveBootstrapKnowledgeBaseSelection } from '@server/utils/runtimeSelectorState';
import { KBSnapshot, KnowledgeBase } from '@server/repositories';
import {
  buildAuthPathWithError,
  resolvePostAuthRedirectPath,
} from '@/utils/authRedirect';

const getQueryString = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const getBodyString = (value: unknown) =>
  typeof value === 'string' ? value : undefined;

const getOrigin = (req: NextApiRequest) => {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto || 'http';
  const host = req.headers.host || 'localhost:3000';
  return `${proto}://${host}`;
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
    );

  return toRuntimeSelector(workspaceId, knowledgeBase, snapshot);
};

const buildRedirectPath = (runtimeSelector: {
  workspaceId: string;
  knowledgeBaseId?: string | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
}) => {
  const params = new URLSearchParams();
  params.set('workspaceId', runtimeSelector.workspaceId);
  if (runtimeSelector.knowledgeBaseId) {
    params.set('knowledgeBaseId', runtimeSelector.knowledgeBaseId);
  }
  if (runtimeSelector.kbSnapshotId) {
    params.set('kbSnapshotId', runtimeSelector.kbSnapshotId);
  }
  if (runtimeSelector.deployHash) {
    params.set('deployHash', runtimeSelector.deployHash);
  }

  return `/home?${params.toString()}`;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!['GET', 'POST'].includes(String(req.method))) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const state =
      getQueryString(req.query.state) ||
      getQueryString(req.query.RelayState) ||
      getBodyString(req.body?.state) ||
      getBodyString(req.body?.RelayState);
    const code =
      getQueryString(req.query.code) || getBodyString(req.body?.code);
    const samlResponse =
      getQueryString(req.query.SAMLResponse) ||
      getBodyString(req.body?.SAMLResponse);
    const providerError =
      getQueryString(req.query.error) || getBodyString(req.body?.error);
    if (providerError) {
      throw new Error(providerError);
    }
    if (!state || (!code && !samlResponse)) {
      return res
        .status(400)
        .json({ error: 'state and code/SAMLResponse are required' });
    }

    const ssoSession = await components.ssoSessionRepository.findOneBy({
      state,
    });
    const authResult =
      await components.identityProviderService.completeWorkspaceSSO({
        state,
        relayState: state,
        code,
        samlResponse,
        origin: getOrigin(req),
      });
    const runtimeSelector = await resolveWorkspaceRuntimeSelector(
      authResult.workspace.id,
    );

    res.setHeader(
      'Set-Cookie',
      buildSessionCookie(authResult.sessionToken, req),
    );
    const location = resolvePostAuthRedirectPath({
      redirectTo: ssoSession?.redirectTo || null,
      runtimeSelector,
      fallbackPath: buildRedirectPath(runtimeSelector),
    });
    res.writeHead(302, {
      Location: location,
    });
    res.end();
  } catch (error: any) {
    const message = error?.message || 'Enterprise SSO login failed';
    const state = getQueryString(req.query.state);
    const ssoSession = state
      ? await components.ssoSessionRepository
          .findOneBy({ state })
          .catch(() => null)
      : null;
    res.writeHead(302, {
      Location: buildAuthPathWithError({
        redirectTo: ssoSession?.redirectTo || null,
        error: message,
      }),
    });
    res.end();
  }
}
