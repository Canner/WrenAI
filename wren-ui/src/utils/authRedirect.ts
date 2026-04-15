import { Path } from '@/utils/enum';

export type RuntimeSelectorLike = {
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
};

const LOCAL_BASE_URL = 'http://local.wrenai';

export const sanitizeLocalRedirectPath = (
  value: string | null | undefined,
): string | null => {
  const candidate = String(value || '').trim();
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) {
    return null;
  }

  try {
    const url = new URL(candidate, LOCAL_BASE_URL);
    if (
      url.origin !== LOCAL_BASE_URL ||
      url.pathname === Path.Auth ||
      url.pathname === Path.Register
    ) {
      return null;
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
};

export const applyRuntimeSelectorToRedirectPath = (
  redirectPath: string,
  runtimeSelector?: RuntimeSelectorLike | null,
): string => {
  const url = new URL(redirectPath, LOCAL_BASE_URL);

  if (runtimeSelector?.workspaceId) {
    url.searchParams.set('workspaceId', runtimeSelector.workspaceId);
  }
  if (runtimeSelector?.knowledgeBaseId) {
    url.searchParams.set('knowledgeBaseId', runtimeSelector.knowledgeBaseId);
  } else {
    url.searchParams.delete('knowledgeBaseId');
  }
  if (runtimeSelector?.kbSnapshotId) {
    url.searchParams.set('kbSnapshotId', runtimeSelector.kbSnapshotId);
  } else {
    url.searchParams.delete('kbSnapshotId');
  }
  if (runtimeSelector?.deployHash) {
    url.searchParams.set('deployHash', runtimeSelector.deployHash);
  } else {
    url.searchParams.delete('deployHash');
  }

  return `${url.pathname}${url.search}${url.hash}`;
};

export const resolvePostAuthRedirectPath = ({
  redirectTo,
  runtimeSelector,
  fallbackPath,
}: {
  redirectTo?: string | null;
  runtimeSelector?: RuntimeSelectorLike | null;
  fallbackPath: string;
}) => {
  const safeRedirect = sanitizeLocalRedirectPath(redirectTo);
  if (!safeRedirect) {
    return fallbackPath;
  }

  return applyRuntimeSelectorToRedirectPath(safeRedirect, runtimeSelector);
};

export const buildAuthPathWithRedirect = (
  redirectTo?: string | null,
): string => {
  const safeRedirect = sanitizeLocalRedirectPath(redirectTo);
  if (!safeRedirect) {
    return Path.Auth;
  }

  const url = new URL(Path.Auth, LOCAL_BASE_URL);
  url.searchParams.set('redirectTo', safeRedirect);
  return `${url.pathname}${url.search}`;
};

export const buildAuthPathWithError = ({
  redirectTo,
  error,
}: {
  redirectTo?: string | null;
  error?: string | null;
}) => {
  const authPath = buildAuthPathWithRedirect(redirectTo);
  const url = new URL(authPath, LOCAL_BASE_URL);
  if (error) {
    url.searchParams.set('error', error);
  }
  return `${url.pathname}${url.search}`;
};
